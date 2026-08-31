import { StorageService } from '@cf/storage';
import type { Capability, GenRequest, GenResult, GenerationBackend } from '../contracts';
import { syntheticImage } from '../media/png';
import { MockBackendBase, aspectToSize } from './mock-base';

/**
 * 로컬·테스트용 이미지 어댑터.
 * 고정 샘플이 아니라 시드 기반 합성 이미지를 만든다.
 * 실제 PNG 를 쓰므로 QC 의 해상도·화면비·무결성 검사가 그대로 동작한다.
 */
export class MockImageBackend extends MockBackendBase implements GenerationBackend {
  readonly capability: Capability = 'image';

  constructor(
    private readonly storage: StorageService,
    opts: { name?: string; unitCostKrw?: number; failureRate?: number; latencyMs?: number; healthy?: boolean } = {},
  ) {
    super(opts.name ?? 'mock-image-a', opts.unitCostKrw ?? 120, opts);
  }

  async generate(req: GenRequest): Promise<GenResult> {
    const started = Date.now();
    await this.simulate();

    // 9:16 세로 규격에서는 짧은 변이 1080 이 되도록 한다.
    const { width, height } = aspectToSize(req.aspect, req.aspect === '9:16' ? 1920 : 1080);
    const seed = `${this.name}|${req.prompt}|${req.sourceAssetKey ?? ''}|${req.seed ?? ''}`;
    const png = syntheticImage({ width, height, seed, palette: req.palette });

    const key = req.outputKey.endsWith('.png') ? req.outputKey : `${req.outputKey}.png`;
    await this.storage.put(key, png, 'image/png');

    return {
      storageKey: key,
      provider: this.name,
      modelVersion: 'mock-v1',
      costKrw: this.unitCostKrw,
      latencyMs: Date.now() - started,
      meta: { mock: true, width, height, aspect: req.aspect, bytes: png.length },
    };
  }
}
