import { createHash } from 'crypto';
import { sleep, config, TransientError, createLogger } from '@cf/common';
import { StorageService } from '@cf/storage';
import type { Platform } from '@cf/domain';
import type { ChannelAdapter, UploadRequest, UploadResult } from './channel-adapter';

/**
 * 로컬·테스트용 채널 어댑터.
 * 실제 업로드 대신 스토리지에 게시 매니페스트를 남기고 외부 ID·URL 을 흉내낸다.
 * 플랫폼 계정 없이도 승인→게시→공개전환 흐름 전체를 검증할 수 있다.
 */
export class MockChannelAdapter implements ChannelAdapter {
  private readonly log = createLogger('mock-channel');

  constructor(
    readonly platform: Platform,
    private readonly storage: StorageService,
    readonly supportsPrivateUpload = true,
  ) {}

  async upload(req: UploadRequest): Promise<UploadResult> {
    await sleep(config.adapters.mockLatencyMs);
    if (config.adapters.mockFailureRate > 0 && Math.random() < config.adapters.mockFailureRate) {
      throw new TransientError(`${this.platform}: injected upload failure`);
    }

    const head = await this.storage.head(req.storageKey);
    if (!head || head.size === 0) {
      throw new TransientError(`${this.platform}: upload source is empty (${req.storageKey})`);
    }

    const externalId = createHash('sha1')
      .update(`${this.platform}|${req.storageKey}|${req.title}`)
      .digest('hex')
      .slice(0, 16);

    const manifestKey = `publications/${this.platform.toLowerCase()}/${externalId}.json`;
    await this.storage.put(
      manifestKey,
      Buffer.from(JSON.stringify({
        platform: this.platform,
        externalId,
        title: req.title,
        description: req.description,
        hashtags: req.hashtags,
        visibility: req.visibility,
        sourceKey: req.storageKey,
        subtitleKey: req.subtitleKey ?? null,
        durationMs: req.durationMs,
        bytes: head.size,
        uploadedAt: new Date().toISOString(),
      }, null, 2)),
      'application/json',
    );

    this.log.info('mock upload completed', {
      provider: `${this.platform.toLowerCase()}-mock`, bytes: head.size, externalId,
    });
    return {
      id: externalId,
      url: `https://mock.${this.platform.toLowerCase()}.local/watch/${externalId}`,
      raw: { manifestKey },
    };
  }
}
