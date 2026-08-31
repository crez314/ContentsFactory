import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Artist } from '@cf/domain';
import { IdentityRejectedError, config, createLogger } from '@cf/common';
import { GenerationService, cosineAll, topKMean, type GenRequest, type GenResult, type JobCtx } from '@cf/model-abstraction';

/**
 * §4.5 Identity 검증.
 * 생성물 임베딩과 아티스트 기준 임베딩의 상위 3개 평균 유사도를 본다.
 * 임계값 미달이면 guidance 를 올려 재생성하고, 경계값은 마지막 시도에서만 수용한다.
 */
@Injectable()
export class IdentityService {
  private readonly log = createLogger('identity');
  private readonly THRESHOLD = config.ops.identityThreshold;
  private readonly MARGIN = config.ops.identityMargin;
  private readonly MAX_RETRY = config.ops.maxGenerationRetry;

  constructor(
    private readonly ds: DataSource,
    private readonly generation: GenerationService,
  ) {}

  /** 아티스트 기준 자산의 임베딩 세트. 매 호출마다 뽑되 키 수가 적어 부담이 없다. */
  async identityVectors(artistId: string, ctx: JobCtx): Promise<number[][]> {
    const artist = await this.ds.getRepository(Artist).findOne({ where: { id: artistId } });
    const keys = artist?.identityRef?.refKeys ?? [];
    if (!keys.length) return [];
    return Promise.all(keys.map((k) => this.generation.embed(k, ctx)));
  }

  async verifyAndRegenerate(
    capability: 'image' | 'video',
    initial: GenRequest,
    ctx: JobCtx & { artistId: string },
  ): Promise<GenResult & { identityScore: number | null; identityFlag?: string }> {
    const refs = await this.identityVectors(ctx.artistId, ctx);

    // 기준 세트가 없으면 검증을 건너뛴다. 오더를 막지 않되 점수는 남기지 않는다.
    if (!refs.length) {
      const res = await this.generation.generate(capability, initial, ctx);
      this.log.warn('no identity reference set; skipping verification', { artistId: ctx.artistId });
      return { ...res, identityScore: null, identityFlag: 'no_reference' };
    }

    let req = initial;
    let guidance = 1.0;

    for (let attempt = 1; attempt <= this.MAX_RETRY; attempt++) {
      const res = await this.generation.generate(capability, req, ctx);
      const vec = await this.generation.embed(res.storageKey, ctx);
      const score = topKMean(cosineAll(refs, vec), 3);

      if (score >= this.THRESHOLD + this.MARGIN) {
        return { ...res, identityScore: score, meta: { ...res.meta, identityScore: score } };
      }
      if (score >= this.THRESHOLD && attempt === this.MAX_RETRY) {
        this.log.warn('identity borderline accepted', { contentId: ctx.contentId ?? undefined, score, attempt });
        return {
          ...res,
          identityScore: score,
          identityFlag: 'borderline_accepted',
          meta: { ...res.meta, identityScore: score, identityFlag: 'borderline_accepted' },
        };
      }

      guidance = Math.min(guidance + 0.25, 2.0);
      req = {
        ...req,
        seed: null,
        identityRefKeys: req.identityRefKeys?.slice(0, 4),
        prompt: `${initial.prompt} [identity_guidance=${guidance.toFixed(2)}]`,
        // 재시도마다 다른 산출물이 나오도록 키를 분리한다. 캐시 히트로 같은 결과가 돌아오면 의미가 없다.
        outputKey: `${initial.outputKey}.r${attempt + 1}`,
      };
      this.log.info('identity below threshold, regenerating', {
        contentId: ctx.contentId ?? undefined, score, attempt, guidance,
      });
    }

    throw new IdentityRejectedError(ctx.contentId ?? undefined, {
      threshold: this.THRESHOLD, attempts: this.MAX_RETRY,
    });
  }
}
