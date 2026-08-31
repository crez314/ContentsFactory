import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Job, Worker } from 'bullmq';
import { z } from 'zod';
import { Asset, MasterAttributeValue, ATTRIBUTE_STANDARDS, type AssetAttributes } from '@cf/domain';
import { config, createLogger } from '@cf/common';
import { StorageService } from '@cf/storage';
import { newRedis } from '@cf/queue';
import { readPngSize } from '@cf/model-abstraction';

const TaggingJob = z.object({ assetId: z.string().uuid() });

/**
 * §4.1 자동 태깅.
 * 이미지 분석 API 를 호출해 attributes 를 채우고 tagging_status 를 AUTO_DONE 으로 올린다.
 *
 * 로컬에서는 외부 분석 API 가 없으므로 파일에서 읽을 수 있는 것(해상도)과
 * 결정적 규칙으로 속성을 추정한다. 운영자가 태깅 검토 대기열에서 확정(REVIEWED)한다.
 * 실제 분석 API 를 붙일 때 analyze() 만 교체하면 된다.
 */
@Injectable()
export class AutoTagService implements OnModuleInit, OnModuleDestroy {
  private readonly log = createLogger('auto-tag');
  private worker?: Worker;

  constructor(
    private readonly ds: DataSource,
    private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(
      'q.tagging',
      async (job: Job) => {
        const { assetId } = TaggingJob.parse(job.data);
        await this.tag(assetId);
      },
      { connection: newRedis(), prefix: config.redis.queuePrefix, concurrency: 4 },
    );
    this.worker.on('failed', (job, err) => this.log.error('auto-tag failed', { jobId: job?.id, err }));
    this.log.info('auto-tag worker started', { queue: 'q.tagging' });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  async tag(assetId: string): Promise<void> {
    const repo = this.ds.getRepository(Asset);
    const asset = await repo.findOne({ where: { id: assetId } });
    if (!asset) return;

    const analyzed = await this.analyze(asset);

    // 마스터 허용값 밖의 추정치는 버린다. 표준값 밖의 값이 들어가면 매칭이 깨진다.
    const allowed = await this.allowedValues();
    const attributes: AssetAttributes = { ...asset.attributes };
    for (const [k, v] of Object.entries(analyzed.attributes)) {
      if (v && allowed[k]?.includes(v)) attributes[k] = v;
    }

    await repo.update(assetId, {
      attributes,
      width: analyzed.width ?? asset.width,
      height: analyzed.height ?? asset.height,
      qualityGrade: analyzed.qualityGrade ?? asset.qualityGrade,
      taggingStatus: 'AUTO_DONE',
    });
    this.log.info('asset auto-tagged', { assetId, attributes });
  }

  private async allowedValues(): Promise<Record<string, string[]>> {
    const rows = await this.ds.getRepository(MasterAttributeValue).find({ where: { active: true } });
    if (!rows.length) return ATTRIBUTE_STANDARDS as unknown as Record<string, string[]>;
    const out: Record<string, string[]> = {};
    for (const r of rows) (out[r.attribute] ??= []).push(r.value);
    return out;
  }

  /** 실제 이미지 분석 API 로 교체할 지점 (§4.1). */
  private async analyze(asset: Asset): Promise<{
    attributes: Record<string, string>;
    width?: number;
    height?: number;
    qualityGrade?: 'A' | 'B' | 'C';
  }> {
    let width: number | undefined;
    let height: number | undefined;

    if (asset.mimeType === 'image/png') {
      try {
        const size = readPngSize(await this.storage.get(asset.storageKey));
        if (size) { width = size.width; height = size.height; }
      } catch {
        // 파일을 못 읽어도 태깅 자체는 계속한다. 검토 대기열에서 사람이 채운다.
      }
    }

    // 해상도로 품질 등급을 1차 추정한다. 운영자가 검토 단계에서 조정한다.
    const pixels = (width ?? 0) * (height ?? 0);
    const qualityGrade: 'A' | 'B' | 'C' =
      pixels >= 1920 * 1080 ? 'A' : pixels >= 720 * 1280 ? 'B' : 'C';

    // 외부 분석 API 가 붙기 전까지는 자산 ID 해시로 결정적 추정치를 만든다.
    // 임의값이 아니라 결정적이어야 같은 자산을 다시 태깅해도 결과가 흔들리지 않는다.
    const h = hash(asset.id);
    const pick = (name: keyof typeof ATTRIBUTE_STANDARDS, salt: number): string => {
      const values = ATTRIBUTE_STANDARDS[name];
      return values[(h + salt) % values.length];
    };

    return {
      width, height, qualityGrade,
      attributes: {
        angle: pick('angle', 0),
        lighting: pick('lighting', 7),
        background: pick('background', 13),
        outfit: pick('outfit', 23),
        pose: pick('pose', 31),
        expression: pick('expression', 41),
      },
    };
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
