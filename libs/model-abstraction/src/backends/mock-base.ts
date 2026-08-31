import { config, sleep, TransientError } from '@cf/common';

export interface MockBackendOptions {
  name?: string;
  unitCostKrw?: number;
  failureRate?: number;
  latencyMs?: number;
  healthy?: boolean;
}

/**
 * §12 Mock 어댑터 공통부.
 * MOCK_FAILURE_RATE 로 장애를 주입할 수 있어 §3.4 재시도·Fallback 경로를
 * 실제 모델 없이 로컬에서 재현할 수 있다.
 */
export abstract class MockBackendBase {
  protected constructor(
    readonly name: string,
    readonly unitCostKrw: number,
    private readonly opts: MockBackendOptions = {},
  ) {}

  async healthy(): Promise<boolean> {
    return this.opts.healthy ?? true;
  }

  protected get failureRate(): number {
    return this.opts.failureRate ?? config.adapters.mockFailureRate;
  }

  protected get latencyMs(): number {
    return this.opts.latencyMs ?? config.adapters.mockLatencyMs;
  }

  protected async simulate(): Promise<void> {
    await sleep(this.latencyMs);
    if (this.failureRate > 0 && Math.random() < this.failureRate) {
      throw new TransientError(`${this.name}: injected failure (MOCK_FAILURE_RATE)`);
    }
  }
}

export function aspectToSize(aspect: string, longEdge = 1080): { width: number; height: number } {
  const [w, h] = aspect.split(':').map(Number);
  if (!w || !h) return { width: longEdge, height: longEdge };
  return w >= h
    ? { width: longEdge, height: Math.round((longEdge * h) / w) }
    : { width: Math.round((longEdge * w) / h), height: longEdge };
}
