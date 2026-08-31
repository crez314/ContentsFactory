import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Blueprint, Content, GeneratedAsset, Order, Scene } from '@cf/domain';
import { AppError, TransientError, createLogger } from '@cf/common';
import { StorageService } from '@cf/storage';
import {
  GenerationService, hasFilter, probeMedia, runFfmpeg, type JobCtx,
} from '@cf/model-abstraction';
import { RenderResult, type JobEnvelope } from '@cf/queue';
import { CaptionService } from '../generation/caption.service';
import type { TaskProcessor } from './processor.registry';

/**
 * 최종 렌더링.
 * Scene 산출물(정지 이미지 / 클립)을 이어붙이고, 자막을 굽고, 음성·BGM 을 믹스한다.
 * ffmpeg 은 로컬 실행이며, 운영에서는 이 프로세서만 렌더 팜으로 옮기면 된다.
 */
@Injectable()
export class RenderProcessor implements TaskProcessor {
  private readonly log = createLogger('render');

  constructor(
    private readonly ds: DataSource,
    private readonly storage: StorageService,
    private readonly generation: GenerationService,
    private readonly captions: CaptionService,
  ) {}

  async process(envelope: JobEnvelope): Promise<RenderResult> {
    const contentId = envelope.contentId!;
    const content = await this.ds.getRepository(Content).findOne({ where: { id: contentId } });
    if (!content) throw new AppError('CONTENT_NOT_FOUND');

    const blueprint = await this.ds.getRepository(Blueprint).findOne({ where: { id: content.blueprintId } });
    const order = await this.ds.getRepository(Order).findOne({ where: { id: content.orderId } });
    const scenes = await this.ds.getRepository(Scene).find({ where: { contentId }, order: { seq: 'ASC' } });
    if (!blueprint || !order || !scenes.length) throw new AppError('CONTENT_INVALID_STATE');

    const [w, h] = (blueprint.layout.resolution ?? '1080x1920').split('x').map(Number);

    // 자막 굽기는 drawtext(libfreetype)를 요구한다. 없는 빌드에서는 SRT 사이드카만 남기고 계속 진행한다.
    const canBurnSubtitles = await hasFilter('drawtext');
    if (!canBurnSubtitles) {
      this.log.warn('drawtext filter unavailable; subtitles will ship as a sidecar SRT only', { contentId });
    }
    const ctx: JobCtx = {
      taskId: envelope.taskId, orderId: order.id, contentId, agentId: order.agentId,
    };

    // 1) Scene 별 정규화 클립 만들기
    const clipKeys: string[] = [];
    for (const scene of scenes) {
      const artifact = await this.ds.getRepository(GeneratedAsset).findOne({
        where: { sceneId: scene.id },
        order: { createdAt: 'DESC' },
      });
      if (!artifact) throw new TransientError(`scene ${scene.seq} has no artifact`);

      const srcPath = await this.storage.materialize(artifact.storageKey);
      const clipKey = `generated/${order.artistId}/${contentId}/clip-${String(scene.seq).padStart(2, '0')}.mp4`;
      await this.storage.put(clipKey, Buffer.alloc(0), 'video/mp4');
      const clipPath = await this.storage.materialize(clipKey);
      const seconds = (scene.durationMs / 1000).toFixed(3);

      const drawtext = canBurnSubtitles ? this.drawtextFilter(scene.subtitle, h) : '';
      const scale = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;

      if (artifact.kind === 'IMAGE') {
        await runFfmpeg([
          '-y', '-loop', '1', '-i', srcPath, '-t', seconds,
          '-vf', [scale, drawtext, 'format=yuv420p'].filter(Boolean).join(','),
          '-r', '25', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', clipPath,
        ]);
      } else {
        await runFfmpeg([
          '-y', '-i', srcPath, '-t', seconds,
          '-vf', [scale, drawtext, 'format=yuv420p'].filter(Boolean).join(','),
          '-r', '25', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-an', clipPath,
        ]);
      }
      clipKeys.push(clipKey);
    }

    // 2) concat
    const totalMs = scenes.reduce((s, x) => s + x.durationMs, 0);
    const listKey = `generated/${order.artistId}/${contentId}/concat.txt`;
    const clipPaths = await Promise.all(clipKeys.map((k) => this.storage.materialize(k)));
    await this.storage.put(
      listKey,
      Buffer.from(clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')),
      'text/plain',
    );
    const listPath = await this.storage.materialize(listKey);

    const silentKey = `generated/${order.artistId}/${contentId}/silent.mp4`;
    await this.storage.put(silentKey, Buffer.alloc(0), 'video/mp4');
    const silentPath = await this.storage.materialize(silentKey);
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', silentPath]);

    // 3) 음성(내레이션) + BGM
    const durationSec = Math.max(1, Math.round(totalMs / 1000));
    const narration = scenes.map((s) => s.subtitle).filter(Boolean).join(' ');
    const voice = narration
      ? await this.generation.generate('voice', {
          prompt: narration, aspect: '1:1', durationSec,
          outputKey: `generated/${order.artistId}/${contentId}/voice`,
        }, ctx)
      : null;
    const music = await this.generation.generate('music', {
      prompt: `bgm ${blueprint.style.bgmMood ?? 'bright'}`, aspect: '1:1', durationSec,
      outputKey: `generated/${order.artistId}/${contentId}/bgm`,
      meta: { mood: blueprint.style.bgmMood ?? 'bright' },
    }, ctx);

    const finalKey = `generated/${order.artistId}/${contentId}/final.mp4`;
    await this.storage.put(finalKey, Buffer.alloc(0), 'video/mp4');
    const finalPath = await this.storage.materialize(finalKey);

    const musicPath = await this.storage.materialize(music.storageKey);
    if (voice) {
      const voicePath = await this.storage.materialize(voice.storageKey);
      await runFfmpeg([
        '-y', '-i', silentPath, '-i', voicePath, '-i', musicPath,
        '-filter_complex', '[1:a]volume=1.0[v];[2:a]volume=0.25[m];[v][m]amix=inputs=2:duration=first[a]',
        '-map', '0:v', '-map', '[a]', '-shortest',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', finalPath,
      ]);
    } else {
      await runFfmpeg([
        '-y', '-i', silentPath, '-i', musicPath,
        '-map', '0:v', '-map', '1:a', '-shortest',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', finalPath,
      ]);
    }

    // 4) 자막 파일(SRT)도 산출물로 남긴다 — 채널 업로드 시 별도 첨부에 쓴다.
    const srtKey = `generated/${order.artistId}/${contentId}/subtitles.srt`;
    await this.storage.put(srtKey, Buffer.from(this.buildSrt(scenes)), 'application/x-subrip');

    const probe = await probeMedia(finalPath);
    const genRepo = this.ds.getRepository(GeneratedAsset);
    const renderCost = (voice?.costKrw ?? 0) + music.costKrw;
    await genRepo.save(genRepo.create({
      contentId, sceneId: null, kind: 'RENDER',
      storageKey: finalKey, provider: 'ffmpeg-local', modelVersion: null,
      costKrw: renderCost, latencyMs: null,
      meta: {
        durationMs: probe.durationMs, width: probe.width, height: probe.height,
        hasAudio: probe.hasAudio, srtKey, subtitleBurnedIn: canBurnSubtitles,
      },
    }));
    await genRepo.save(genRepo.create({
      contentId, sceneId: null, kind: 'SUBTITLE',
      storageKey: srtKey, provider: 'rule-based', costKrw: 0, meta: { lines: scenes.length },
    }));

    const caption = await this.captions.build(order, blueprint, content);
    await this.ds.getRepository(Content).update(contentId, {
      finalKey,
      durationMs: probe.durationMs || totalMs,
      title: caption.title,
      description: caption.description,
      hashtags: caption.hashtags,
      status: 'QC',
    });

    const result: RenderResult = {
      contentId, storageKey: finalKey, durationMs: probe.durationMs || totalMs, costKrw: renderCost,
    };
    RenderResult.parse(result);
    this.log.info('render completed', {
      contentId, durationMs: result.durationMs, scenes: scenes.length, costKrw: renderCost,
    });
    return result;
  }

  /**
   * 자막을 영상에 굽는다.
   * 폰트 파일 경로를 강제하지 않고 fontconfig 기본 폰트를 쓴다.
   * 특수문자는 ffmpeg 필터 문법을 깨뜨리므로 이스케이프한다.
   */
  private drawtextFilter(subtitle: string | null, height: number): string {
    if (!subtitle) return '';
    const text = subtitle
      .replace(/\\/g, '\\\\')
      .replace(/:/g, '\\:')
      .replace(/'/g, "\u2019")
      .replace(/[\[\]]/g, '')
      .slice(0, 60);
    const y = Math.round(height * 0.78);
    return [
      `drawtext=text='${text}'`,
      'fontcolor=white',
      `fontsize=${Math.round(height / 26)}`,
      'box=1', 'boxcolor=black@0.45', 'boxborderw=18',
      'x=(w-text_w)/2', `y=${y}`,
    ].join(':');
  }

  private buildSrt(scenes: Scene[]): string {
    let t = 0;
    return scenes
      .map((s, i) => {
        const start = t;
        t += s.durationMs;
        return `${i + 1}\n${srtTime(start)} --> ${srtTime(t)}\n${s.subtitle ?? ''}\n`;
      })
      .join('\n');
  }
}

function srtTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const msec = ms % 1000;
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(msec, 3)}`;
}
