import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  Artist, Asset, AssetLicense, AssetUsage, Blueprint, Channel, Content,
  GeneratedAsset, MasterBannedTerm, Order, Scene,
  QC_AREAS, evaluateQc, type ChecksByArea, type QcArea, type QcEvaluation, type QcViolation,
} from '@cf/domain';
import { config, createLogger } from '@cf/common';
import { StorageService } from '@cf/storage';
import {
  GenerationService, cosineAll, meanVolumeDb, probeMedia, readPngSize, topKMean, type JobCtx,
} from '@cf/model-abstraction';

/**
 * §4.6 QC Engine — 6개 영역.
 *
 *  quality    해상도·화면비·길이·파일 무결성 정적 검사 + 오디오 무음 구간 탐지
 *  identity   생성물 임베딩과 기준 임베딩의 상위 3개 평균 유사도
 *  brand      금지어 사전 + 브랜드 색상·로고 규격 검사
 *  policy     채널별 금지 항목 룰셋 (길이·해시태그 수·금칙어)
 *  copyright  사용된 자산의 라이선스 유효성 재확인 + BGM 라이선스 확인
 *  aiRisk     자막·카피의 사실 단정 표현 탐지 (룰 기반)
 *
 * V1 의 brand·aiRisk 는 룰 기반이다. 모델 기반 판정은 V2 에서 도입하되
 * 이 인터페이스(AreaCheck)는 그대로 유지한다.
 */
@Injectable()
export class QcEngineService {
  private readonly log = createLogger('qc-engine');

  constructor(
    private readonly ds: DataSource,
    private readonly storage: StorageService,
    private readonly generation: GenerationService,
  ) {}

  async evaluate(contentId: string, ctx: JobCtx): Promise<QcEvaluation> {
    const content = await this.ds.getRepository(Content).findOneOrFail({ where: { id: contentId } });
    const blueprint = await this.ds.getRepository(Blueprint).findOneOrFail({ where: { id: content.blueprintId } });
    const channel = await this.ds.getRepository(Channel).findOneOrFail({ where: { id: blueprint.channelId } });
    const order = await this.ds.getRepository(Order).findOneOrFail({ where: { id: content.orderId } });

    const checks: ChecksByArea = {
      quality:   await this.checkQuality(content, blueprint, channel),
      identity:  await this.checkIdentity(content, order, ctx),
      brand:     await this.checkBrand(content, blueprint),
      policy:    await this.checkPolicy(content, channel),
      copyright: await this.checkCopyright(content, channel, order),
      aiRisk:    await this.checkAiRisk(content),
    };

    const evaluation = evaluateQc(checks, config.ops.qcPassScore);
    this.log.info('qc evaluated', {
      contentId, verdict: evaluation.verdict, totalScore: evaluation.totalScore,
      retryTarget: evaluation.retryTarget,
    });
    return evaluation;
  }

  /** 해상도·화면비·길이·무결성 + 오디오 무음 */
  private async checkQuality(content: Content, blueprint: Blueprint, channel: Channel) {
    const violations: QcViolation[] = [];
    let score = 100;

    if (!content.finalKey) {
      return { score: 0, violations: [v('quality', 'MISSING_OUTPUT', '최종 산출물이 없습니다.')] };
    }
    const head = await this.storage.head(content.finalKey);
    if (!head || head.size === 0) {
      return { score: 0, violations: [v('quality', 'EMPTY_FILE', '산출물 파일이 비어 있습니다.')] };
    }

    const [expectW, expectH] = (blueprint.layout.resolution ?? '1080x1920').split('x').map(Number);
    const filePath = await this.storage.materialize(content.finalKey);

    if (content.outputType === 'VIDEO') {
      const probe = await probeMedia(filePath);

      if (!probe.durationMs) {
        violations.push(v('quality', 'NO_DURATION', '영상 길이를 확인할 수 없습니다.'));
        score -= 40;
      }
      const targetMs = (blueprint.scenePlan ?? []).reduce((s, p) => s + p.durationMs, 0);
      if (targetMs && Math.abs(probe.durationMs - targetMs) > targetMs * 0.15) {
        violations.push(v('quality', 'DURATION_DRIFT', '계획 대비 영상 길이 편차가 큽니다.', {
          expectedMs: targetMs, actualMs: probe.durationMs,
        }));
        score -= 15;
      }
      const maxMs = (channel.spec.maxDurationSec ?? 60) * 1000;
      if (probe.durationMs > maxMs) {
        violations.push(v('quality', 'DURATION_OVER_LIMIT', '채널 최대 길이를 초과했습니다.', {
          maxMs, actualMs: probe.durationMs,
        }));
        score -= 25;
      }
      if (probe.width !== expectW || probe.height !== expectH) {
        violations.push(v('quality', 'RESOLUTION_MISMATCH', '해상도가 사양과 다릅니다.', {
          expected: `${expectW}x${expectH}`, actual: `${probe.width}x${probe.height}`,
        }));
        score -= 20;
      }
      if (!probe.hasAudio) {
        violations.push(v('quality', 'NO_AUDIO_TRACK', '오디오 트랙이 없습니다.'));
        score -= 15;
      } else {
        // 무음 구간 탐지 — 평균 볼륨이 -60dB 아래면 사실상 무음이다.
        const db = await meanVolumeDb(filePath);
        if (db !== null && db < -60) {
          violations.push(v('quality', 'SILENT_AUDIO', '오디오가 사실상 무음입니다.', { meanVolumeDb: db }));
          score -= 15;
        }
      }
    } else {
      const buf = await this.storage.get(content.finalKey);
      const size = readPngSize(buf);
      if (!size) {
        violations.push(v('quality', 'CORRUPT_IMAGE', '이미지 헤더를 읽을 수 없습니다.'));
        score -= 40;
      } else {
        if (size.width !== expectW || size.height !== expectH) {
          violations.push(v('quality', 'RESOLUTION_MISMATCH', '해상도가 사양과 다릅니다.', {
            expected: `${expectW}x${expectH}`, actual: `${size.width}x${size.height}`,
          }));
          score -= 20;
        }
        const wantAspect = (blueprint.layout.aspect ?? '9:16').split(':').map(Number);
        const actual = size.width / size.height;
        const expected = wantAspect[0] / wantAspect[1];
        if (Math.abs(actual - expected) > 0.02) {
          violations.push(v('quality', 'ASPECT_MISMATCH', '화면비가 사양과 다릅니다.', {
            expected: blueprint.layout.aspect, actual: actual.toFixed(3),
          }));
          score -= 20;
        }
      }
    }

    return { score: clamp(score), violations };
  }

  /** 생성물 임베딩과 기준 임베딩의 상위 3개 평균 유사도 */
  private async checkIdentity(content: Content, order: Order, ctx: JobCtx) {
    const artist = await this.ds.getRepository(Artist).findOne({ where: { id: order.artistId } });
    const refKeys = artist?.identityRef?.refKeys ?? [];

    // 생성 단계가 기록한 점수를 우선 쓴다. 없으면 최종 산출물로 직접 잰다.
    const recorded = await this.ds.getRepository(GeneratedAsset).find({
      where: { contentId: content.id },
      order: { createdAt: 'DESC' },
    });
    const scores = recorded.map((g) => g.identityScore).filter((s): s is number => typeof s === 'number');

    let similarity: number | null = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

    if (similarity === null && refKeys.length && content.outputType !== 'VIDEO' && content.finalKey) {
      const refs = await Promise.all(refKeys.map((k) => this.generation.embed(k, ctx)));
      const vec = await this.generation.embed(content.finalKey, ctx);
      similarity = topKMean(cosineAll(refs, vec), 3);
    }

    if (similarity === null) {
      // 기준 세트가 없으면 판단 근거가 없다. 감점하되 위반으로는 보지 않는다.
      return { score: 70, violations: [v('identity', 'NO_REFERENCE', '아티스트 기준 임베딩이 없어 동일성을 판정하지 못했습니다.')] };
    }

    const threshold = config.ops.identityThreshold;
    const violations: QcViolation[] = [];
    if (similarity < threshold) {
      violations.push(v('identity', 'BELOW_THRESHOLD', '동일성 점수가 임계값 미만입니다.', { similarity, threshold }));
    }
    // 0.70~1.00 구간을 0~100 으로 펴서 점수 차이를 드러나게 한다.
    const score = clamp(((similarity - 0.7) / 0.3) * 100);
    return { score, violations };
  }

  /** 금지어 사전 + 브랜드 색상 규격 */
  private async checkBrand(content: Content, blueprint: Blueprint) {
    const violations: QcViolation[] = [];
    let score = 100;

    const terms = await this.ds.getRepository(MasterBannedTerm).find({ where: { category: 'BRAND' } });
    const text = [content.title, content.description, ...(content.hashtags ?? [])].filter(Boolean).join(' ').toLowerCase();
    for (const t of terms) {
      if (text.includes(t.term.toLowerCase())) {
        violations.push(v('brand', 'BANNED_TERM', `브랜드 금지어가 포함되었습니다: ${t.term}`, { term: t.term }));
        score -= t.severity === 'BLOCK' ? 40 : 15;
      }
    }

    // 브랜드 팔레트가 지정되었으면 유효한 색상값인지 확인한다.
    const palette = blueprint.style.palette ?? [];
    const invalid = palette.filter((c) => !/^#[0-9a-fA-F]{6}$/.test(c));
    if (invalid.length) {
      violations.push(v('brand', 'INVALID_PALETTE', '브랜드 팔레트 색상값이 올바르지 않습니다.', { invalid }));
      score -= 10;
    }
    if (!blueprint.style.template) {
      violations.push(v('brand', 'NO_TEMPLATE', '브랜드 템플릿이 지정되지 않았습니다.'));
      score -= 10;
    }

    return { score: clamp(score), violations };
  }

  /**
   * 채널별 금지 항목 룰셋.
   * 여기서 위반이 나오면 HARD_BLOCK 이므로 재시도 없이 BLOCKED 로 간다.
   */
  private async checkPolicy(content: Content, channel: Channel) {
    const violations: QcViolation[] = [];

    const captionLimit = channel.spec.captionLimit ?? 2200;
    if ((content.description ?? '').length > captionLimit) {
      violations.push(v('policy', 'CAPTION_TOO_LONG', '캡션이 채널 한도를 초과했습니다.', {
        limit: captionLimit, actual: content.description?.length,
      }));
    }
    const maxHashtags = channel.spec.maxHashtags ?? 30;
    if ((content.hashtags ?? []).length > maxHashtags) {
      violations.push(v('policy', 'TOO_MANY_HASHTAGS', '해시태그 수가 채널 한도를 초과했습니다.', {
        limit: maxHashtags, actual: content.hashtags?.length,
      }));
    }
    const maxDurationMs = (channel.spec.maxDurationSec ?? 60) * 1000;
    if (content.durationMs && content.durationMs > maxDurationMs) {
      violations.push(v('policy', 'DURATION_OVER_LIMIT', '영상 길이가 채널 한도를 초과했습니다.', {
        limit: maxDurationMs, actual: content.durationMs,
      }));
    }

    // 정책 금칙어는 BLOCK 등급만 위반으로 처리한다.
    const terms = await this.ds.getRepository(MasterBannedTerm).find({ where: [{ category: 'POLICY' }, { category: 'TOPIC' }] });
    const text = [content.title, content.description, ...(content.hashtags ?? [])].filter(Boolean).join(' ').toLowerCase();
    for (const t of terms) {
      if (t.severity === 'BLOCK' && text.includes(t.term.toLowerCase())) {
        violations.push(v('policy', 'PROHIBITED_TOPIC', `금지 주제가 포함되었습니다: ${t.term}`, { term: t.term }));
      }
    }

    return { score: violations.length ? 0 : 100, violations };
  }

  /** 사용된 자산의 라이선스 유효성 재확인 + BGM 라이선스 */
  private async checkCopyright(content: Content, channel: Channel, order: Order) {
    const violations: QcViolation[] = [];

    const usages = await this.ds.getRepository(AssetUsage).find({ where: { contentId: content.id } });
    if (!usages.length) {
      violations.push(v('copyright', 'NO_LINEAGE', '사용된 원본 자산 기록이 없습니다.'));
      return { score: 0, violations };
    }

    const publishDate = (order.scheduledAt ?? new Date()).toISOString().slice(0, 10);
    const platform = channel.platform.toLowerCase();
    const region = (channel.region ?? 'KR').toUpperCase();

    for (const u of usages) {
      const licenses = await this.ds.getRepository(AssetLicense).find({ where: { assetId: u.assetId } });
      if (!licenses.length) {
        violations.push(v('copyright', 'NO_LICENSE', '라이선스가 등록되지 않은 자산이 사용되었습니다.', { assetId: u.assetId }));
        continue;
      }
      const usable = licenses.find(
        (l) =>
          l.allowedChannels.includes(platform) &&
          l.allowedRegions.includes(region) &&
          l.derivativeAllowed &&
          l.validFrom <= publishDate &&
          l.validUntil >= publishDate,
      );
      if (!usable) {
        violations.push(v('copyright', 'LICENSE_INVALID_AT_PUBLISH', '게시 시점에 유효한 라이선스가 없습니다.', {
          assetId: u.assetId, platform, region, publishDate,
        }));
      }
    }

    // BGM 라이선스 — 어댑터가 상업적 이용 가능 여부를 meta.licensed 로 보고한다 (§8.1).
    const bgm = await this.ds.getRepository(GeneratedAsset).findOne({
      where: { contentId: content.id, kind: 'AUDIO' },
      order: { createdAt: 'DESC' },
    });
    if (bgm && bgm.meta?.licensed === false) {
      violations.push(v('copyright', 'BGM_NOT_LICENSED', 'BGM 의 상업적 이용 라이선스가 확인되지 않았습니다.', {
        provider: bgm.provider,
      }));
    }

    return { score: violations.length ? 0 : 100, violations };
  }

  /**
   * 자막·카피의 사실 단정 표현 탐지 (룰 기반).
   * 효능·순위·수치 보장 같은 단정 표현은 광고 심의에서 문제가 되므로 감점한다.
   */
  private async checkAiRisk(content: Content) {
    const violations: QcViolation[] = [];
    let score = 100;

    const scenes = await this.ds.getRepository(Scene).find({ where: { contentId: content.id } });
    const corpus = [
      content.title ?? '',
      content.description ?? '',
      ...scenes.map((s) => s.subtitle ?? ''),
    ].join(' ');

    const patterns: Array<{ re: RegExp; code: string; message: string; penalty: number }> = [
      { re: /(100\s*%|백\s*퍼센트)/, code: 'ABSOLUTE_CLAIM', message: '절대 수치 단정 표현이 있습니다.', penalty: 25 },
      { re: /(무조건|반드시|절대로|틀림없)/, code: 'ABSOLUTE_WORDING', message: '단정적 부사가 사용되었습니다.', penalty: 20 },
      { re: /(최고|최초|1위|유일)/, code: 'SUPERLATIVE', message: '최상급·순위 표현은 근거가 필요합니다.', penalty: 15 },
      { re: /(보장|효과가?\s*있습니다|치료|완치)/, code: 'EFFICACY_CLAIM', message: '효능·보장 표현이 있습니다.', penalty: 30 },
      { re: /(공식\s*발표|확정)/, code: 'UNVERIFIED_FACT', message: '검증되지 않은 사실 단정 표현입니다.', penalty: 15 },
    ];

    for (const p of patterns) {
      if (p.re.test(corpus)) {
        violations.push(v('aiRisk', p.code, p.message));
        score -= p.penalty;
      }
    }

    return { score: clamp(score), violations };
  }
}

function v(area: QcArea, code: string, message: string, detail?: Record<string, unknown>): QcViolation {
  return { area, code, message, detail };
}
function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}
