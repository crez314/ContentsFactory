import { StorageService } from '@cf/storage';
import type { Capability, GenRequest, GenResult, GenerationBackend } from '../contracts';
import { MockBackendBase } from './mock-base';
import { runFfmpeg } from '../media/ffmpeg';

/**
 * BGM 자리. 무드에 따라 기음을 바꾼 사인파를 만든다.
 * QC 의 오디오 무음 구간 탐지를 통과시키기 위해 실제로 소리가 나는 트랙을 만든다.
 */
const MOOD_HZ: Record<string, number> = {
  bright: 440, warm: 392, calm: 349, energetic: 523, dark: 294,
};

export class MockMusicBackend extends MockBackendBase implements GenerationBackend {
  readonly capability: Capability = 'music';

  constructor(private readonly storage: StorageService, opts: { name?: string; unitCostKrw?: number } = {}) {
    super(opts.name ?? 'mock-music-a', opts.unitCostKrw ?? 80, opts);
  }

  async generate(req: GenRequest): Promise<GenResult> {
    const started = Date.now();
    await this.simulate();
    const mood = String(req.meta?.mood ?? 'bright');
    const hz = MOOD_HZ[mood] ?? 440;
    const durationSec = Math.max(1, req.durationSec ?? 30);
    const key = req.outputKey.endsWith('.m4a') ? req.outputKey : `${req.outputKey}.m4a`;
    await this.storage.put(key, Buffer.alloc(0), 'audio/mp4');
    const path = await this.storage.materialize(key);

    await runFfmpeg([
      '-y', '-f', 'lavfi', '-i', `sine=frequency=${hz}:sample_rate=44100`,
      '-t', String(durationSec), '-af', 'volume=0.12', '-c:a', 'aac', '-b:a', '128k', path,
    ]);

    const head = await this.storage.head(key);
    return {
      storageKey: key, provider: this.name, modelVersion: 'mock-v1',
      costKrw: this.unitCostKrw, latencyMs: Date.now() - started,
      meta: { mock: true, mood, hz, durationMs: durationSec * 1000, licensed: true, bytes: head?.size ?? 0 },
    };
  }
}
