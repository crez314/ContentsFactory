import { Injectable } from '@nestjs/common';
import { Channel, Content } from '@cf/domain';
import { createLogger } from '@cf/common';
import { StorageService } from '@cf/storage';
import { probeMedia, runFfmpeg } from '@cf/model-abstraction';

export interface OptimizedContent {
  storageKey: string;
  title: string;
  description: string;
  hashtags: string[];
  durationMs: number | null;
  transformed: boolean;
}

/**
 * §4.8 2단계 — 채널 규격에 맞춘 최종 변환.
 * 길이 초과 시 잘라내고, 캡션·해시태그는 채널 한도에 맞춰 줄인다.
 * 이미 규격에 맞으면 원본 키를 그대로 쓴다.
 */
@Injectable()
export class ChannelOptimizerService {
  private readonly log = createLogger('channel-optimizer');

  constructor(private readonly storage: StorageService) {}

  async forChannel(content: Content, channel: Channel): Promise<OptimizedContent> {
    const captionLimit = channel.spec.captionLimit ?? 2200;
    const maxHashtags = channel.spec.maxHashtags ?? 30;
    const maxDurationMs = (channel.spec.maxDurationSec ?? 60) * 1000;

    const base: OptimizedContent = {
      storageKey: content.finalKey!,
      title: (content.title ?? '').slice(0, 200),
      description: (content.description ?? '').slice(0, captionLimit),
      hashtags: (content.hashtags ?? []).slice(0, maxHashtags),
      durationMs: content.durationMs,
      transformed: false,
    };

    if (content.outputType !== 'VIDEO' || !content.durationMs || content.durationMs <= maxDurationMs) {
      return base;
    }

    // 길이 초과 — 채널 한도에 맞춰 앞부분만 남긴다.
    const srcPath = await this.storage.materialize(content.finalKey!);
    const trimmedKey = content.finalKey!.replace(/\.mp4$/, '') + `.${channel.platform.toLowerCase()}.mp4`;
    await this.storage.put(trimmedKey, Buffer.alloc(0), 'video/mp4');
    const dstPath = await this.storage.materialize(trimmedKey);

    await runFfmpeg([
      '-y', '-i', srcPath, '-t', (maxDurationMs / 1000).toFixed(3),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', dstPath,
    ]);
    const probe = await probeMedia(dstPath);

    this.log.info('content trimmed for channel', {
      contentId: content.id, platform: channel.platform,
      fromMs: content.durationMs, toMs: probe.durationMs,
    });
    return { ...base, storageKey: trimmedKey, durationMs: probe.durationMs, transformed: true };
  }
}
