import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { GeneratedAsset } from '@cf/domain';
import {
  BackendUnavailableError, BudgetExceededError, createLogger, sha256, withTimeout, config,
} from '@cf/common';
import { StorageService } from '@cf/storage';
import type { Capability, GenRequest, GenResult, JobCtx } from './contracts';
import { isEmbeddingBackend } from './contracts';
import { ModelRegistry } from './registry.service';
import { CostGuardService } from './cost-guard.service';

/**
 * §4.5 생성 실행기.
 * 어댑터 체인을 순서대로 시도하고(=Fallback), 예산을 사전 검사하고, 비용을 기록한다.
 * 이 서비스 밖의 어떤 코드도 특정 벤더 이름을 알지 못한다.
 */
@Injectable()
export class GenerationService {
  private readonly log = createLogger('generation');

  constructor(
    private readonly registry: ModelRegistry,
    private readonly costGuard: CostGuardService,
    private readonly storage: StorageService,
    private readonly ds: DataSource,
  ) {}

  /** §9.4 중복 호출 방지 해시 */
  static cacheKey(capability: string, req: GenRequest, modelVersion = ''): string {
    return sha256(
      [capability, modelVersion, req.prompt, req.sourceAssetKey ?? '', req.aspect, String(req.seed ?? '')].join('|'),
    );
  }

  private timeoutFor(capability: Capability): number {
    return capability === 'video' ? config.adapters.videoTimeoutMs : config.adapters.imageTimeoutMs;
  }

  /**
   * 동일 프롬프트·동일 원본 재요청은 기존 generated_assets 를 재사용하고 비용을 0으로 기록한다.
   * 캐시 히트는 meta.cacheHit 로 표시되어 비용 화면에서 구분된다.
   */
  private async lookupCache(cacheKey: string): Promise<GeneratedAsset | null> {
    return this.ds.getRepository(GeneratedAsset).findOne({
      where: { cacheKey },
      order: { createdAt: 'DESC' },
    });
  }

  async generate(capability: Capability, req: GenRequest, ctx: JobCtx): Promise<GenResult> {
    const cacheKey = GenerationService.cacheKey(capability, req);
    const cached = await this.lookupCache(cacheKey);
    if (cached && (await this.storage.exists(cached.storageKey))) {
      this.log.info('generation cache hit', {
        taskId: ctx.taskId, contentId: ctx.contentId ?? undefined, provider: cached.provider, costKrw: 0,
      });
      return {
        storageKey: cached.storageKey,
        provider: cached.provider,
        modelVersion: cached.modelVersion ?? undefined,
        costKrw: 0,
        latencyMs: 0,
        meta: { ...cached.meta, cacheHit: true, cacheKey },
      };
    }

    const chain = await this.registry.resolve(capability, ctx.maxCostKrw);
    let lastError: unknown;

    for (const backend of chain) {
      if (!(await this.costGuard.canSpend(ctx.agentId, backend.unitCostKrw))) {
        throw new BudgetExceededError(ctx.agentId ?? undefined, { provider: backend.name });
      }
      const started = Date.now();
      try {
        const res = await withTimeout(backend.generate(req), this.timeoutFor(capability), `${backend.name}.generate`);
        await this.costGuard.record(ctx, res.costKrw, res.provider);
        this.log.info('generation completed', {
          taskId: ctx.taskId, contentId: ctx.contentId ?? undefined, sceneId: ctx.sceneId ?? undefined,
          provider: res.provider, durationMs: Date.now() - started, costKrw: res.costKrw,
        });
        return { ...res, meta: { ...res.meta, cacheKey } };
      } catch (err) {
        lastError = err;
        this.log.warn('backend failed, falling back', {
          provider: backend.name, taskId: ctx.taskId, durationMs: Date.now() - started, err,
        });
      }
    }
    throw new BackendUnavailableError(capability, { cause: lastError });
  }

  /** 임베딩은 파일이 아니라 벡터를 돌려주므로 별도 경로를 쓴다. */
  async embed(storageKey: string, ctx: JobCtx): Promise<number[]> {
    const chain = await this.registry.resolve('embedding');
    let lastError: unknown;
    for (const backend of chain) {
      if (!isEmbeddingBackend(backend)) continue;
      try {
        const vec = await withTimeout(backend.embed(storageKey), 30_000, `${backend.name}.embed`);
        await this.costGuard.record(ctx, backend.unitCostKrw, backend.name, 'embedding');
        return vec;
      } catch (err) {
        lastError = err;
        this.log.warn('embedding backend failed, falling back', { provider: backend.name, err });
      }
    }
    throw new BackendUnavailableError('embedding', { cause: lastError });
  }
}
