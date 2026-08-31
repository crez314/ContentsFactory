import { StorageService } from '@cf/storage';
import { TransientError, config, createLogger } from '@cf/common';
import type { Capability, GenRequest, GenResult, GenerationBackend } from '../contracts';

export interface HttpBackendConfig {
  name: string;
  capability: Capability;
  unitCostKrw: number;
  baseUrl: string;
  apiKeyEnv?: string;
  /** 비동기 Job 방식 모델이면 폴링 설정을 채운다 (§8.1). */
  polling?: { intervalMs: number; maxWaitMs: number };
  modelVersion?: string;
}

/**
 * 실제 벤더 어댑터의 뼈대.
 * §8.1 요구사항 — 비동기 Job 방식 모델은 어댑터 내부에서 폴링을 흡수하고
 * 호출자에게는 동기 인터페이스로 노출한다.
 *
 * 벤더가 확정되면 buildRequest / parseResult 만 그 벤더 형식에 맞게 채운다.
 * ADAPTERS=http 로 전환하면 register-backends 가 이 클래스를 등록한다.
 */
export class HttpGenerationBackend implements GenerationBackend {
  private readonly log = createLogger('http-backend');
  readonly name: string;
  readonly capability: Capability;
  readonly unitCostKrw: number;

  constructor(
    private readonly cfg: HttpBackendConfig,
    private readonly storage: StorageService,
  ) {
    this.name = cfg.name;
    this.capability = cfg.capability;
    this.unitCostKrw = cfg.unitCostKrw;
  }

  private get apiKey(): string {
    const key = this.cfg.apiKeyEnv ? process.env[this.cfg.apiKeyEnv] : undefined;
    if (!key) throw new TransientError(`${this.name}: missing credential (${this.cfg.apiKeyEnv})`);
    return key;
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.cfg.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
        headers: { authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(req: GenRequest): Promise<GenResult> {
    const started = Date.now();
    const timeout = this.capability === 'video' ? config.adapters.videoTimeoutMs : config.adapters.imageTimeoutMs;

    const submit = await fetch(`${this.cfg.baseUrl}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(this.buildRequest(req)),
      signal: AbortSignal.timeout(timeout),
    });
    if (!submit.ok) throw new TransientError(`${this.name}: submit failed ${submit.status}`);
    let body = (await submit.json()) as Record<string, unknown>;

    if (this.cfg.polling && body.jobId) {
      body = await this.poll(String(body.jobId));
    }

    const url = String(body.outputUrl ?? '');
    if (!url) throw new TransientError(`${this.name}: response has no outputUrl`);
    const file = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(timeout) })).arrayBuffer());
    await this.storage.put(req.outputKey, file, String(body.contentType ?? 'application/octet-stream'));

    return {
      storageKey: req.outputKey,
      provider: this.name,
      modelVersion: this.cfg.modelVersion ?? String(body.modelVersion ?? ''),
      // §8.1 응답에 costKrw 를 반드시 채운다. 벤더가 주지 않으면 단가표를 쓴다.
      costKrw: typeof body.costKrw === 'number' ? body.costKrw : this.unitCostKrw,
      latencyMs: Date.now() - started,
      meta: { bytes: file.length },
    };
  }

  private async poll(jobId: string): Promise<Record<string, unknown>> {
    const { intervalMs, maxWaitMs } = this.cfg.polling!;
    const deadline = Date.now() + maxWaitMs;
    for (;;) {
      await new Promise((r) => setTimeout(r, intervalMs));
      const res = await fetch(`${this.cfg.baseUrl}/jobs/${jobId}`, {
        headers: { authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json()) as Record<string, unknown>;
      if (body.status === 'succeeded') return body;
      if (body.status === 'failed') throw new TransientError(`${this.name}: job ${jobId} failed`);
      if (Date.now() > deadline) throw new TransientError(`${this.name}: job ${jobId} polling timed out`);
      this.log.debug('polling generation job', { provider: this.name, jobId });
    }
  }

  /** 벤더 요청 형식으로의 변환 지점. 벤더 확정 시 여기만 고친다. */
  protected buildRequest(req: GenRequest): Record<string, unknown> {
    return {
      prompt: req.prompt,
      aspect_ratio: req.aspect,
      duration_seconds: req.durationSec,
      reference_images: req.identityRefKeys,
      source_image: req.sourceAssetKey,
      seed: req.seed,
    };
  }
}
