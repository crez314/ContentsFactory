import { Injectable } from '@nestjs/common';
import { BackendUnavailableError, config, createLogger, withTimeout } from '@cf/common';
import type { Capability, GenerationBackend } from './contracts';

interface Entry { priority: number; backend: GenerationBackend }
interface HealthCache { at: number; ok: boolean }

/**
 * §4.5 어댑터 레지스트리.
 * 우선순위·단가·가용성 조건을 만족하는 백엔드 "체인"을 반환한다.
 * 호출자는 체인 순서대로 시도하며, 이것이 Fallback 의 실체다.
 */
@Injectable()
export class ModelRegistry {
  private readonly log = createLogger('model-registry');
  private readonly backends = new Map<Capability, Entry[]>();
  private readonly health = new Map<string, HealthCache>();

  register(backend: GenerationBackend, priority = 100): void {
    const list = this.backends.get(backend.capability) ?? [];
    list.push({ priority, backend });
    list.sort((a, b) => a.priority - b.priority);
    this.backends.set(backend.capability, list);
    this.log.info('backend registered', {
      provider: backend.name, capability: backend.capability, priority, unitCostKrw: backend.unitCostKrw,
    });
  }

  clear(): void {
    this.backends.clear();
    this.health.clear();
  }

  list(capability?: Capability): GenerationBackend[] {
    if (capability) return (this.backends.get(capability) ?? []).map((e) => e.backend);
    return [...this.backends.values()].flat().map((e) => e.backend);
  }

  /** §8.1 healthy() 는 5초 내 응답, 결과는 30초 캐시한다. */
  private async isHealthy(backend: GenerationBackend): Promise<boolean> {
    const cached = this.health.get(backend.name);
    if (cached && Date.now() - cached.at < config.adapters.healthCacheMs) return cached.ok;
    let ok = false;
    try {
      ok = await withTimeout(backend.healthy(), 5000, `${backend.name}.healthy`);
    } catch (err) {
      this.log.warn('health check failed', { provider: backend.name, err });
      ok = false;
    }
    this.health.set(backend.name, { at: Date.now(), ok });
    return ok;
  }

  async resolve(capability: Capability, maxCostKrw?: number): Promise<GenerationBackend[]> {
    const chain: GenerationBackend[] = [];
    for (const { backend } of this.backends.get(capability) ?? []) {
      if (maxCostKrw != null && backend.unitCostKrw > maxCostKrw) continue;
      if (!(await this.isHealthy(backend))) continue;
      chain.push(backend);
    }
    if (!chain.length) throw new BackendUnavailableError(capability);
    return chain;
  }

  /** 대시보드 시스템 상태 패널용 (§7.2) */
  async healthReport(): Promise<Array<{ name: string; capability: Capability; healthy: boolean; unitCostKrw: number }>> {
    const out = [];
    for (const backend of this.list()) {
      out.push({
        name: backend.name,
        capability: backend.capability,
        healthy: await this.isHealthy(backend),
        unitCostKrw: backend.unitCostKrw,
      });
    }
    return out;
  }
}
