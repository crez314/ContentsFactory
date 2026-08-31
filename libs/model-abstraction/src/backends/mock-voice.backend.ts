import { StorageService } from '@cf/storage';
import type { Capability, GenRequest, GenResult, GenerationBackend } from '../contracts';
import { MockBackendBase } from './mock-base';
import { runFfmpeg } from '../media/ffmpeg';

/** 한국어 TTS 자리. 로컬에서는 자막 길이에 비례한 무음 트랙을 만든다. */
export class MockVoiceBackend extends MockBackendBase implements GenerationBackend {
  readonly capability: Capability = 'voice';

  constructor(private readonly storage: StorageService, opts: { name?: string; unitCostKrw?: number } = {}) {
    super(opts.name ?? 'mock-voice-a', opts.unitCostKrw ?? 60, opts);
  }

  async generate(req: GenRequest): Promise<GenResult> {
    const started = Date.now();
    await this.simulate();
    const durationSec = req.durationSec ?? Math.max(1, Math.round(req.prompt.length / 8));
    const key = req.outputKey.endsWith('.m4a') ? req.outputKey : `${req.outputKey}.m4a`;
    await this.storage.put(key, Buffer.alloc(0), 'audio/mp4');
    const path = await this.storage.materialize(key);

    await runFfmpeg([
      '-y', '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo`,
      '-t', String(durationSec), '-c:a', 'aac', '-b:a', '96k', path,
    ]);

    const head = await this.storage.head(key);
    return {
      storageKey: key, provider: this.name, modelVersion: 'mock-v1',
      costKrw: this.unitCostKrw, latencyMs: Date.now() - started,
      meta: { mock: true, durationMs: durationSec * 1000, silent: true, bytes: head?.size ?? 0 },
    };
  }
}
