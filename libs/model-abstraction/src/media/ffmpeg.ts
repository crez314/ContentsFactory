import { spawn } from 'child_process';
import { config, TransientError, createLogger } from '@cf/common';

const log = createLogger('ffmpeg');

export function runFfmpeg(args: string[], timeoutMs = 300_000): Promise<string> {
  return run(config.ffmpeg.bin, args, timeoutMs);
}
export function runFfprobe(args: string[], timeoutMs = 30_000): Promise<string> {
  return run(config.ffmpeg.probeBin, args, timeoutMs);
}

function run(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new TransientError(`${bin} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new TransientError(`${bin} spawn failed: ${(err as Error).message}`, err));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(stdout);
      log.warn('ffmpeg exited non-zero', { bin, code, stderr: stderr.slice(-2000) });
      reject(new TransientError(`${bin} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

export interface MediaProbe {
  durationMs: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
  /** 오디오 전체가 무음인지. §4.6 quality 영역의 무음 구간 탐지에 쓴다. */
  meanVolumeDb?: number;
}

export async function probeMedia(filePath: string): Promise<MediaProbe> {
  const raw = await runFfprobe([
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath,
  ]);
  const json = JSON.parse(raw) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
  };
  const video = json.streams?.find((s) => s.codec_type === 'video');
  const audio = json.streams?.find((s) => s.codec_type === 'audio');
  return {
    durationMs: Math.round(Number(json.format?.duration ?? 0) * 1000),
    width: video?.width,
    height: video?.height,
    hasAudio: Boolean(audio),
  };
}

/**
 * 이 ffmpeg 빌드가 지원하는 필터를 한 번만 조회해 캐시한다.
 * Homebrew 등 배포판에 따라 drawtext(libfreetype)·subtitles(libass)가 빠져 있을 수 있어,
 * 자막을 굽기 전에 반드시 확인해야 한다.
 */
let filterCache: Set<string> | null = null;

export async function availableFilters(): Promise<Set<string>> {
  if (filterCache) return filterCache;
  try {
    const out = await run(config.ffmpeg.bin, ['-hide_banner', '-filters'], 15_000);
    const names = new Set<string>();
    for (const line of out.split('\n')) {
      // 형식: " ... name  in->out  description"
      const m = /^\s*[TSC.]{1,4}\s+(\S+)\s/.exec(line);
      if (m) names.add(m[1]);
    }
    filterCache = names;
  } catch {
    filterCache = new Set();
  }
  return filterCache;
}

export async function hasFilter(name: string): Promise<boolean> {
  return (await availableFilters()).has(name);
}

/** volumedetect 필터로 평균 볼륨(dB)을 얻는다. -91dB 근처면 사실상 무음이다. */
export async function meanVolumeDb(filePath: string): Promise<number | null> {
  try {
    await runFfmpeg(['-hide_banner', '-i', filePath, '-af', 'volumedetect', '-f', 'null', '-'], 60_000);
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    const m = /mean_volume:\s*(-?\d+(\.\d+)?) dB/.exec(msg);
    return m ? Number(m[1]) : null;
  }
}
