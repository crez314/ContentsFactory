import { createHash, createHmac, randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Artist, AssetLicense, AssetUsage, Content, Order } from '@cf/domain';
import { AppError, config, createLogger, isLocalLike } from '@cf/common';
import { StorageService } from '@cf/storage';
import { phashFromPng, probeMedia, runFfmpeg } from '@cf/model-abstraction';

export interface ProvenanceMarks {
  manifestId: string;
  manifestKey: string;
  watermarkId: string;
  phash: string | null;
  frameSignature: { algo: string; frames: Array<{ atMs: number; phash: string }> } | null;
}

/**
 * §4.8.1 정품 표식 및 계보 기록.
 *
 * 플랫폼이 실존 인물의 AI 합성을 자동 탐지해 차단하면서, 권리자가 합법적으로 만든 콘텐츠도
 * 같은 탐지 대상이 되었다. 플랫폼은 우리 내부 생성 이력을 알 수 없으므로
 * 정품과 무단 생성물을 구별할 근거가 없다. 그 근거를 게시 직전에 남긴다.
 *
 * 표식은 세 겹이며 앞의 것이 소실되면 뒤의 것으로 대체한다.
 *   1) C2PA 매니페스트  — 플랫폼 업로드 과정에서 자주 제거됨
 *   2) 강인 워터마크    — 재인코딩·크롭 이후에도 잔존
 *   3) 지각 해시        — 최후 대조 수단
 *
 * V1 범위는 생성과 저장까지다. 외부 유통물 스캔과 정품 소명 자동화는 V2 다.
 * 다만 계보는 사후 소급 생성이 불가능하므로 첫 게시부터 남긴다.
 */
@Injectable()
export class ProvenanceService {
  private readonly log = createLogger('provenance');

  constructor(
    private readonly ds: DataSource,
    private readonly storage: StorageService,
  ) {}

  /**
   * 게시 대상 산출물에 표식을 만들어 저장한다.
   * 실패하면 던진다 — 표식 없는 게시물은 이후 소명이 불가능하기 때문이다.
   */
  async sign(args: { contentId: string; storageKey: string; channelId: string }): Promise<ProvenanceMarks> {
    try {
      const content = await this.ds.getRepository(Content).findOneOrFail({ where: { id: args.contentId } });
      const order = await this.ds.getRepository(Order).findOneOrFail({ where: { id: content.orderId } });
      const artist = await this.ds.getRepository(Artist).findOneOrFail({ where: { id: order.artistId } });

      // 사용된 원본 자산과 그 라이선스 근거를 매니페스트에 박아둔다.
      const usages = await this.ds.getRepository(AssetUsage).find({ where: { contentId: args.contentId } });
      if (!usages.length) {
        throw new AppError('PROVENANCE_SIGNING_FAILED', {
          message: '계보 기록이 없어 정품 표식을 만들 수 없습니다.',
          details: [{ contentId: args.contentId }],
        });
      }
      const assetIds = [...new Set(usages.map((u) => u.assetId))];
      const licenses = await this.ds.getRepository(AssetLicense).find({
        where: assetIds.map((assetId) => ({ assetId })),
      });

      const bytes = await this.storage.get(args.storageKey);
      const sha256 = createHash('sha256').update(bytes).digest('hex');

      const manifestId = `c2pa:${randomUUID()}`;
      const watermarkId = this.watermarkId(sha256, args.contentId);
      const { phash, frameSignature } = await this.perceptualMarks(args.storageKey, content.outputType);

      const manifest = {
        // C2PA 스펙 전체를 구현하지는 않는다. 소명에 필요한 사실관계를 담은 서명 문서다.
        // 실제 c2pa 라이브러리를 붙일 때 이 구조를 claim 으로 옮기면 된다.
        format: 'crez-provenance/1',
        manifestId,
        createdAt: new Date().toISOString(),
        rightsHolder: { artistId: artist.id, artistCode: artist.code, artistName: artist.name },
        content: { contentId: content.id, orderId: order.id, outputType: content.outputType, sha256 },
        sourceAssets: assetIds,
        licenseEvidence: licenses.map((l) => ({
          assetId: l.assetId,
          contractRef: l.contractRef,
          derivativeLevel: l.derivativeLevel,
          validFrom: l.validFrom,
          validUntil: l.validUntil,
          allowedChannels: l.allowedChannels,
          allowedRegions: l.allowedRegions,
        })),
        pipeline: { version: 'v1.1', generator: 'crez-content-factory' },
        marks: { watermarkId, phash, phashAlgo: config.provenance.phashAlgo, frameSignature },
        targetChannelId: args.channelId,
      };

      const signature = this.signManifest(JSON.stringify(manifest));
      const manifestKey = `provenance/${args.contentId}/${manifestId.replace(/[^\w]/g, '_')}.json`;
      await this.storage.put(
        manifestKey,
        Buffer.from(JSON.stringify({ manifest, signature }, null, 2)),
        'application/json',
      );

      this.log.info('provenance marks created', {
        contentId: args.contentId, manifestId, phash, sourceAssets: assetIds.length,
      });
      return { manifestId, manifestKey, watermarkId, phash, frameSignature };
    } catch (err) {
      if (err instanceof AppError && err.code === 'PROVENANCE_SIGNING_FAILED') throw err;
      this.log.error('provenance signing failed', { contentId: args.contentId, err });
      throw new AppError('PROVENANCE_SIGNING_FAILED', {
        details: [{ contentId: args.contentId }],
        cause: err,
      });
    }
  }

  /**
   * 강인 워터마크 식별자.
   *
   * 실제 워터마킹은 픽셀·주파수 영역에 신호를 심는 전용 라이브러리가 필요하다.
   * V1 은 식별자를 결정적으로 생성해 매니페스트와 DB 에 남기는 데까지 한다.
   * 라이브러리를 붙일 때 이 메서드가 실제 임베딩을 수행하도록 바꾸면 되고,
   * 식별자 체계와 저장 위치는 그대로 쓸 수 있다.
   */
  private watermarkId(sha256: string, contentId: string): string {
    return `wm_${createHash('sha1').update(`${contentId}|${sha256}`).digest('hex').slice(0, 24)}`;
  }

  /** 서명 키는 Secrets Manager 에서 온다. local 만 평문 키를 허용한다 (§9.2). */
  private signManifest(payload: string): { alg: string; keyRef: string; value: string } {
    if (!isLocalLike() && config.provenance.localSigningKey.startsWith('local-dev')) {
      throw new AppError('PROVENANCE_SIGNING_FAILED', { message: '서명 키가 주입되지 않았습니다.' });
    }
    return {
      alg: 'HMAC-SHA256',
      keyRef: config.provenance.signingKeyRef,
      value: createHmac('sha256', config.provenance.localSigningKey).update(payload).digest('hex'),
    };
  }

  /**
   * 지각 해시. 이미지는 파일에서 바로, 영상은 균등 간격 프레임을 뽑아 계산한다.
   * 영상의 대표 phash 는 첫 프레임 것을 쓰고, 나머지는 frame_signature 로 남긴다.
   */
  private async perceptualMarks(
    storageKey: string,
    outputType: string,
  ): Promise<{ phash: string | null; frameSignature: ProvenanceMarks['frameSignature'] }> {
    if (outputType !== 'VIDEO') {
      const buf = await this.storage.get(storageKey);
      return { phash: phashFromPng(buf), frameSignature: null };
    }

    const videoPath = await this.storage.materialize(storageKey);
    const probe = await probeMedia(videoPath);
    const count = Math.max(1, config.provenance.frameSignatureCount);
    const frames: Array<{ atMs: number; phash: string }> = [];

    for (let i = 0; i < count; i++) {
      // 처음과 끝은 페이드가 걸릴 수 있어 안쪽 구간에서 균등하게 뽑는다.
      const atMs = Math.round((probe.durationMs * (i + 1)) / (count + 1));
      const frameKey = `provenance/frames/${storageKey.replace(/[^\w]/g, '_')}.${i}.png`;
      await this.storage.put(frameKey, Buffer.alloc(0), 'image/png');
      const framePath = await this.storage.materialize(frameKey);

      await runFfmpeg([
        '-y', '-ss', (atMs / 1000).toFixed(3), '-i', videoPath,
        // pix_fmt 를 고정해 알파·16bit 변형이 섞이지 않게 한다.
        '-frames:v', '1', '-vf', 'scale=256:-2', '-pix_fmt', 'rgb24',
        '-f', 'image2', '-c:v', 'png', framePath,
      ], 60_000);

      const hash = phashFromPng(await this.storage.get(frameKey));
      if (hash) frames.push({ atMs, phash: hash });
    }

    if (!frames.length) {
      throw new AppError('PROVENANCE_SIGNING_FAILED', {
        message: '영상에서 프레임 시그니처를 추출하지 못했습니다.',
        details: [{ storageKey }],
      });
    }
    return {
      phash: frames[0].phash,
      frameSignature: { algo: config.provenance.phashAlgo, frames },
    };
  }
}
