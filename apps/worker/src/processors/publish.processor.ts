import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Channel, Content, GeneratedAsset, Publication, type Platform } from '@cf/domain';
import { AppError, createLogger, serializeError } from '@cf/common';
import { StorageService } from '@cf/storage';
import { PublishResult, type JobEnvelope } from '@cf/queue';
import { ChannelOptimizerService } from '../publish/channel-optimizer.service';
import { CredentialsService } from '../publish/credentials.service';
import { MockChannelAdapter } from '../publish/mock-channel.adapter';
import type { ChannelAdapter } from '../publish/channel-adapter';
import type { TaskProcessor } from './processor.registry';

/**
 * §4.8 Publish Module.
 * 1 자격증명 조회 → 2 채널 규격 변환 → 3 비공개 업로드 → 4 외부 ID·URL 저장
 * 5 공개 전환은 운영자가 백오피스에서 수행한다 (여기서는 하지 않는다).
 */
@Injectable()
export class PublishProcessor implements TaskProcessor {
  private readonly log = createLogger('publish');
  private readonly adapters = new Map<Platform, ChannelAdapter>();

  constructor(
    private readonly ds: DataSource,
    private readonly storage: StorageService,
    private readonly optimizer: ChannelOptimizerService,
    private readonly credentials: CredentialsService,
  ) {
    // 실제 플랫폼 연동이 준비되면 여기서 어댑터만 교체한다 (§8.2).
    for (const p of ['YOUTUBE', 'TIKTOK', 'INSTAGRAM', 'X'] as Platform[]) {
      // 인스타그램은 비공개 업로드를 지원하지 않는 것으로 두어, 지원 여부 검사가 실제로 작동하는지 확인한다.
      this.adapters.set(p, new MockChannelAdapter(p, storage, p !== 'INSTAGRAM'));
    }
  }

  async process(envelope: JobEnvelope): Promise<PublishResult> {
    const contentId = envelope.contentId!;
    const channelId = String((envelope.payload as { channelId?: string })?.channelId ?? '');

    const content = await this.ds.getRepository(Content).findOne({ where: { id: contentId } });
    if (!content) throw new AppError('CONTENT_NOT_FOUND');
    if (!content.finalKey) throw new AppError('CONTENT_INVALID_STATE', { message: '게시할 산출물이 없습니다.' });

    const channel = await this.ds.getRepository(Channel).findOne({ where: { id: channelId } });
    if (!channel) throw new AppError('NOT_FOUND', { message: '채널을 찾을 수 없습니다.' });
    if (channel.status !== 'ACTIVE') {
      throw new AppError('CHANNEL_INACTIVE', { details: [{ channelId, status: channel.status }] });
    }

    const pubRepo = this.ds.getRepository(Publication);

    // §3.5 중복 게시는 (content_id, channel_id) 유니크 제약에 의존한다.
    const existing = await pubRepo.findOne({ where: { contentId, channelId } });
    if (existing && ['UPLOADED', 'PUBLISHED'].includes(existing.status)) {
      this.log.info('already published, skipping', { contentId, channelId, externalId: existing.externalId });
      return {
        contentId,
        publications: [{
          channelId,
          externalId: existing.externalId ?? '',
          externalUrl: existing.externalUrl ?? '',
          visibility: existing.visibility,
        }],
      };
    }

    await this.ds.getRepository(Content).update(contentId, { status: 'PUBLISHING' });
    const pub = existing ?? pubRepo.create({ contentId, channelId, status: 'PENDING', visibility: 'PRIVATE' });
    pub.status = 'UPLOADING';
    await pubRepo.save(pub);

    try {
      const adapter = this.adapters.get(channel.platform);
      if (!adapter) throw new AppError('PLATFORM_UPLOAD_FAILED', { message: `어댑터가 없습니다: ${channel.platform}` });

      // 1) 자격증명
      await this.credentials.resolve(channel.credentialRef);

      // 2) 채널 규격 변환
      const optimized = await this.optimizer.forChannel(content, channel);

      // 3) 업로드 — V1 은 PRIVATE 고정.
      // 비공개 업로드를 지원하지 않는 플랫폼은 UNLISTED 로 내려간다. PUBLIC 으로는 절대 올리지 않는다.
      const visibility = adapter.supportsPrivateUpload ? 'PRIVATE' : 'UNLISTED';
      if (visibility !== 'PRIVATE') {
        this.log.warn('platform does not support private upload; falling back to unlisted', {
          provider: channel.platform, contentId,
        });
      }

      const subtitle = await this.ds.getRepository(GeneratedAsset).findOne({
        where: { contentId, kind: 'SUBTITLE' }, order: { createdAt: 'DESC' },
      });

      const uploaded = await adapter.upload({
        filePath: await this.storage.materialize(optimized.storageKey),
        storageKey: optimized.storageKey,
        title: optimized.title,
        description: optimized.description,
        hashtags: optimized.hashtags,
        visibility,
        credentialRef: channel.credentialRef,
        durationMs: optimized.durationMs,
        subtitleKey: subtitle?.storageKey ?? null,
      });

      // 4) 외부 ID·URL 저장
      pub.externalId = uploaded.id;
      pub.externalUrl = uploaded.url;
      pub.visibility = visibility;
      pub.status = 'UPLOADED';
      pub.error = null;
      await pubRepo.save(pub);

      // 업로드까지가 파이프라인의 끝이다. PUBLISHED 는 사람이 공개 전환할 때 붙는다.
      await this.ds.getRepository(Content).update(contentId, { status: 'PUBLISHED' });

      const result: PublishResult = {
        contentId,
        publications: [{ channelId, externalId: uploaded.id, externalUrl: uploaded.url, visibility }],
      };
      PublishResult.parse(result);
      this.log.info('publish completed', {
        contentId, provider: channel.platform, externalId: uploaded.id, visibility,
      });
      return result;
    } catch (err) {
      pub.status = 'FAILED';
      pub.error = serializeError(err);
      await pubRepo.save(pub);
      await this.ds.getRepository(Content).update(contentId, { status: 'APPROVED' }); // 재시도 가능한 상태로 되돌린다
      throw err;
    }
  }
}
