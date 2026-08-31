import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  Asset, Blueprint, Channel, Order, Selection,
  DEFAULT_SCENE_MS, SCENE_MAX_MS, SCENE_MIN_MS,
  type BlueprintLayout, type BlueprintStyle, type ScenePlan,
} from '@cf/domain';
import { AppError, createLogger } from '@cf/common';
import { BlueprintResult, type JobEnvelope } from '@cf/queue';
import type { TaskProcessor } from './processor.registry';

/**
 * §4.4 Blueprint Module.
 * 선별된 자산 + 오더 컨셉 + 채널 규격을 결합해 제작 사양을 확정한다.
 * 오더 1건에서 (채널 수 × 수량)개의 Blueprint 가 생성된다.
 */
@Injectable()
export class BlueprintProcessor implements TaskProcessor {
  private readonly log = createLogger('blueprint-processor');

  constructor(private readonly ds: DataSource) {}

  async process(envelope: JobEnvelope): Promise<BlueprintResult> {
    const orderId = envelope.orderId!;
    const order = await this.ds.getRepository(Order).findOne({
      where: { id: orderId },
      relations: { channels: true },
    });
    if (!order) throw new AppError('ORDER_NOT_FOUND');

    const selections = await this.ds.getRepository(Selection).find({
      where: { orderId },
      order: { rank: 'ASC' },
    });
    if (!selections.length) throw new AppError('INSUFFICIENT_ASSETS', { details: [{ orderId }] });

    const assets = await this.ds.getRepository(Asset).findByIds(selections.map((s) => s.assetId));
    const assetById = new Map(assets.map((a) => [a.id, a]));
    const ordered = selections.map((s) => assetById.get(s.assetId)).filter(Boolean) as Asset[];

    const repo = this.ds.getRepository(Blueprint);
    const outputTypes = order.outputType === 'BOTH' ? (['IMAGE', 'VIDEO'] as const) : ([order.outputType] as const);
    const created: BlueprintResult['blueprints'] = [];

    let cursor = 0; // 자산을 라운드로빈으로 배분해 한 자산에 몰리지 않게 한다.
    for (const channel of order.channels ?? []) {
      let seq = 0;
      for (const outputType of outputTypes) {
        for (let n = 0; n < order.quantity; n++) {
          seq += 1;
          const existing = await repo.findOne({ where: { orderId, channelId: channel.id, seq } });
          if (existing) {
            created.push(this.toResult(existing));
            cursor += this.assetsNeeded(outputType, order.spec.durationSec);
            continue;
          }

          const need = this.assetsNeeded(outputType, order.spec.durationSec);
          const picked = pickRotating(ordered, cursor, need);
          cursor += need;

          const layout = this.layoutFor(channel, order);
          const style: BlueprintStyle = {
            tone: order.design.tone,
            palette: order.design.palette,
            template: order.design.template,
            bgmMood: String(order.concept.mood ?? 'bright'),
          };
          const scenePlan = outputType === 'VIDEO'
            ? this.buildScenePlan(order, channel, picked)
            : [];

          const bp = await repo.save(repo.create({
            orderId,
            channelId: channel.id,
            seq,
            outputType,
            layout,
            style,
            scenePlan,
          }));
          created.push(this.toResult(bp));
        }
      }
    }

    const result: BlueprintResult = { orderId, blueprints: created };
    BlueprintResult.parse(result);
    this.log.info('blueprints created', { orderId, count: created.length });
    return result;
  }

  private toResult(bp: Blueprint): BlueprintResult['blueprints'][number] {
    return {
      blueprintId: bp.id,
      channelId: bp.channelId,
      seq: bp.seq,
      outputType: bp.outputType as 'IMAGE' | 'VIDEO',
      scenePlan: bp.scenePlan,
    };
  }

  private assetsNeeded(outputType: 'IMAGE' | 'VIDEO' | 'BOTH', durationSec?: number): number {
    if (outputType !== 'VIDEO') return 1;
    return Math.max(1, Math.round(((durationSec ?? 30) * 1000) / DEFAULT_SCENE_MS));
  }

  private layoutFor(channel: Channel, order: Order): BlueprintLayout {
    const aspect = order.spec.aspect ?? channel.spec.aspect ?? '9:16';
    const resolution = order.spec.resolution ?? (aspect === '9:16' ? '1080x1920' : '1080x1080');
    return {
      aspect,
      resolution,
      // 세로 영상은 상하 UI 에 가려지므로 안전 영역을 비워둔다.
      safeArea: aspect === '9:16' ? { top: 220, bottom: 320 } : { top: 80, bottom: 80 },
      typography: {
        headline: String(order.design.template ?? 'crez_basic_v1'),
        caption: 'noto_sans_kr',
      },
      backgroundTreatment: String(order.concept.mood ?? 'bright'),
    };
  }

  /**
   * Scene 배열 — 각 3~6초.
   * 실사 자산이 있는 Scene 은 REAL_IMAGE 로 두고 원본을 그대로 쓰며,
   * 나머지는 AI_VIDEO 로 생성한다. 첫 Scene 은 항상 실사로 시작해 동일성 인지를 높인다.
   */
  private buildScenePlan(order: Order, channel: Channel, picked: Asset[]): ScenePlan[] {
    const totalMs = (order.spec.durationSec ?? 30) * 1000;
    const count = Math.max(1, Math.round(totalMs / DEFAULT_SCENE_MS));
    const base = Math.min(SCENE_MAX_MS, Math.max(SCENE_MIN_MS, Math.round(totalMs / count)));

    const campaign = String(order.concept.campaign ?? 'campaign');
    const story = String(order.concept.story ?? 'story');
    const mood = String(order.concept.mood ?? 'bright');

    const plan: ScenePlan[] = [];
    let remaining = totalMs;
    for (let i = 0; i < count; i++) {
      const isLast = i === count - 1;
      const durationMs = isLast ? Math.max(SCENE_MIN_MS, remaining) : base;
      remaining -= durationMs;

      const asset = picked[i % Math.max(1, picked.length)];
      // 짝수 Scene 은 실사 원본, 홀수 Scene 은 원본을 참조한 AI 영상으로 변주를 준다.
      const useReal = i % 2 === 0 && Boolean(asset);
      plan.push({
        seq: i + 1,
        durationMs,
        sourceType: useReal ? 'REAL_IMAGE' : 'AI_VIDEO',
        sourceAssetId: asset?.id,
        prompt: [
          `${campaign} ${story}`,
          `mood=${mood}`,
          `tone=${order.design.tone ?? 'warm'}`,
          asset ? `attrs=${Object.entries(asset.attributes).map(([k, v]) => `${k}:${v}`).join(',')}` : '',
          `channel=${channel.platform.toLowerCase()}`,
        ].filter(Boolean).join(' | '),
        subtitle: this.subtitleFor(i, count, order),
      });
    }
    return plan;
  }

  /**
   * 자막은 사실 단정 표현을 피한다. QC 의 aiRisk 영역이 이를 룰로 검사하므로,
   * 생성 단계에서부터 단정 어휘를 쓰지 않는 문장을 만든다.
   */
  private subtitleFor(index: number, count: number, order: Order): string {
    const campaign = String(order.concept.campaign ?? '');
    const story = String(order.concept.story ?? '').replace(/_/g, ' ');
    if (index === 0) return `${campaign} ${story}`.trim();
    if (index === count - 1) return '더 많은 이야기는 프로필에서';
    return `${story} #${index + 1}`.trim();
  }
}

/** 자산 목록을 순환하며 n개를 뽑는다. */
function pickRotating<T>(list: T[], start: number, n: number): T[] {
  if (!list.length) return [];
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(list[(start + i) % list.length]);
  return out;
}
