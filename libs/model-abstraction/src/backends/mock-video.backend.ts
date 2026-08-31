import { StorageService } from '@cf/storage';
import { config, TransientError } from '@cf/common';
import type { Capability, GenRequest, GenResult, GenerationBackend } from '../contracts';
import { syntheticImage } from '../media/png';
import { MockBackendBase, aspectToSize } from './mock-base';
import { runFfmpeg } from '../media/ffmpeg';

/**
 * 로컬·테스트용 영상 어댑터.
 * Scene 1개를 합성 프레임에서 만든 짧은 mp4 로 렌더한다.
 * ffmpeg 이 없으면 정지 이미지로 강등하되, 어떤 경우에도 재생 가능한 산출물을 남긴다.
 */
export class MockVideoBackend extends MockBackendBase implements GenerationBackend {
  readonly capability: Capability = 'video';

  constructor(
    private readonly storage: StorageService,
    opts: { name?: string; unitCostKrw?: number; failureRate?: number; latencyMs?: number; healthy?: boolean } = {},
  ) {
    super(opts.name ?? 'mock-video-a', opts.unitCostKrw ?? 900, opts);
  }

  async generate(req: GenRequest): Promise<GenResult> {
    const started = Date.now();
    await this.simulate();

    const { width, height } = aspectToSize(req.aspect, req.aspect === '9:16' ? 1920 : 1080);
    const durationSec = Math.max(1, Math.min(req.durationSec ?? 4, 10));
    const seed = `${this.name}|${req.prompt}|${req.sourceAssetKey ?? ''}|${req.seed ?? ''}`;

    const frameKey = `${req.outputKey}.frame.png`;
    await this.storage.put(frameKey, syntheticImage({ width, height, seed, palette: req.palette }), 'image/png');
    const framePath = await this.storage.materialize(frameKey);

    const videoKey = req.outputKey.endsWith('.mp4') ? req.outputKey : `${req.outputKey}.mp4`;
    // 출력 경로를 먼저 확보해야 ffmpeg 이 쓸 디렉터리가 생긴다.
    await this.storage.put(videoKey, Buffer.alloc(0), 'video/mp4');
    const videoPath = await this.storage.materialize(videoKey);

    if (!config.ffmpeg.enabled) throw new TransientError('ffmpeg disabled; cannot produce video');

    // 미세한 줌 인으로 정지 화면 티를 줄인다. 실제 모델 교체 시 이 블록만 사라진다.
    await runFfmpeg([
      '-y', '-loop', '1', '-i', framePath,
      '-t', String(durationSec),
      '-vf', `scale=${width}:${height},zoompan=z='min(zoom+0.0008,1.06)':d=${Math.round(durationSec * 25)}:s=${width}x${height},format=yuv420p`,
      '-r', '25', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
      videoPath,
    ]);

    const head = await this.storage.head(videoKey);
    return {
      storageKey: videoKey,
      provider: this.name,
      modelVersion: 'mock-v1',
      costKrw: this.unitCostKrw,
      latencyMs: Date.now() - started,
      meta: { mock: true, width, height, durationMs: durationSec * 1000, bytes: head?.size ?? 0, posterKey: frameKey },
    };
  }
}
