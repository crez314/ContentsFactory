import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Channel, ChannelHealthLog, Publication, type ChannelHealthState } from '@cf/domain';
import { AppError, config, createLogger } from '@cf/common';
import { NotifierService } from '@cf/model-abstraction';

export interface DailyMetrics {
  date: string;            // YYYY-MM-DD
  postedCount: number;
  policyRemovals: number;
  dailyCap: number;
  reachRate?: number | null;   // V2
  reachZscore?: number | null; // V2
  signals?: Record<string, unknown>;
}

export interface Headroom {
  channelId: string;
  available: number;
  reason: 'OK' | 'QUARANTINE' | 'THROTTLED_CAP_REACHED' | 'MIN_INTERVAL' | 'CHANNEL_INACTIVE';
  dailyCap: number;
  postedToday: number;
  minutesSinceLast: number | null;
  minIntervalMin: number;
}

export interface PublishCandidate {
  contentId: string;
  channelId: string;
}

/**
 * §4.9 Channel Health Module.
 *
 * 생산 능력을 그대로 게시량으로 전환하면 플랫폼의 비정상 활동 탐지에 걸린다.
 * 계정 제재는 축적된 채널 신뢰도를 한 번에 소멸시키므로 게시 물량을 안전 한도 내로 제한한다.
 *
 * 한도를 올리는 속도보다 **내리는 속도를 빠르게** 두는 비대칭 설계다.
 * 계정 손실 비용이 게시 기회 손실 비용보다 크기 때문이다.
 * V1 은 정책 삭제와 상한 초과만 보고, 도달률 기반 자동 조정(AIMD)은 V2 다.
 */
@Injectable()
export class ChannelHealthService {
  private readonly log = createLogger('channel-health');

  /** V2 AIMD 계수. V1 에서는 쓰지 않지만 의도를 코드에 남겨둔다. */
  static readonly AI_STEP = 1;      // 정상 유지 시 일일 상한 가산량
  static readonly MD_FACTOR = 0.5;  // 이상 감지 시 승산 감소 계수

  constructor(
    private readonly ds: DataSource,
    private readonly notifier: NotifierService,
  ) {}

  /** 오늘 추가 게시 가능 건수. 배포 스케줄러가 이 값으로 배정한다. */
  async headroom(channelId: string, now = new Date()): Promise<Headroom> {
    const ch = await this.ds.getRepository(Channel).findOne({ where: { id: channelId } });
    if (!ch) throw new AppError('NOT_FOUND', { message: '채널을 찾을 수 없습니다.' });

    const base = {
      channelId,
      dailyCap: ch.dailyCap,
      minIntervalMin: ch.minIntervalMin,
    };

    if (ch.healthState === 'QUARANTINE') {
      return { ...base, available: 0, reason: 'QUARANTINE', postedToday: 0, minutesSinceLast: null };
    }
    if (ch.status !== 'ACTIVE') {
      return { ...base, available: 0, reason: 'CHANNEL_INACTIVE', postedToday: 0, minutesSinceLast: null };
    }

    const postedToday = await this.countToday(channelId, now);
    const last = await this.lastPublishedAt(channelId);
    const minutesSinceLast = last ? (now.getTime() - last.getTime()) / 60_000 : null;

    if (minutesSinceLast !== null && minutesSinceLast < ch.minIntervalMin) {
      return { ...base, available: 0, reason: 'MIN_INTERVAL', postedToday, minutesSinceLast };
    }

    const available = Math.max(ch.dailyCap - postedToday, 0);
    return {
      ...base,
      available,
      reason: available > 0 ? 'OK' : 'THROTTLED_CAP_REACHED',
      postedToday,
      minutesSinceLast,
    };
  }

  /**
   * 게시 직전 확인. 여유가 없으면 던진다.
   * 던져진 오류는 재시도 대상이라 다음 슬롯에서 자연스럽게 재개된다.
   */
  async assertCanPublish(channelId: string, now = new Date()): Promise<Headroom> {
    const room = await this.headroom(channelId, now);
    if (room.reason === 'QUARANTINE') {
      throw new AppError('CHANNEL_QUARANTINED', { details: [room] });
    }
    if (room.available <= 0) {
      throw new AppError('CHANNEL_HEADROOM_EXCEEDED', { details: [room] });
    }
    return room;
  }

  /**
   * 오더 배정 — headroom 을 초과하는 물량은 다음 슬롯으로 이월한다.
   * 게시 Task 를 만들기 전에 호출해 애초에 큐에 넣지 않는 데 쓴다.
   */
  async assign(jobs: PublishCandidate[], now = new Date()): Promise<{
    plan: PublishCandidate[];
    deferred: Array<PublishCandidate & { reason: string }>;
  }> {
    const room = new Map<string, number>();
    const reasons = new Map<string, string>();
    for (const channelId of new Set(jobs.map((j) => j.channelId))) {
      const h = await this.headroom(channelId, now);
      room.set(channelId, h.available);
      reasons.set(channelId, h.reason);
    }

    const plan: PublishCandidate[] = [];
    const deferred: Array<PublishCandidate & { reason: string }> = [];
    for (const job of jobs) {
      const remaining = room.get(job.channelId) ?? 0;
      if (remaining <= 0) {
        deferred.push({ ...job, reason: reasons.get(job.channelId) ?? 'THROTTLED_CAP_REACHED' });
        continue;
      }
      plan.push(job);
      room.set(job.channelId, remaining - 1);
    }
    if (deferred.length) {
      this.log.info('publish jobs deferred by channel headroom', {
        planned: plan.length, deferred: deferred.length,
      });
    }
    return { plan, deferred };
  }

  /**
   * 일일 관측 → 상태 판정.
   * V1 은 정책 삭제와 상한 초과만 본다. 도달률 z-score 는 Analytics 수집 이후(V2).
   */
  async observe(channelId: string, m: DailyMetrics): Promise<ChannelHealthState> {
    const repo = this.ds.getRepository(Channel);
    const ch = await repo.findOne({ where: { id: channelId } });
    if (!ch) throw new AppError('NOT_FOUND', { message: '채널을 찾을 수 없습니다.' });

    let state: ChannelHealthState = 'ACTIVE';

    if (m.policyRemovals > 0 && config.channel.quarantineOnRemoval) {
      // 게시 중단, 자동 재개 없음. 운영자가 백오피스에서 해제한다.
      state = 'QUARANTINE';
      ch.healthState = 'QUARANTINE';
      ch.quarantinedAt = new Date();
      ch.quarantineReason = 'policy_removal';
      await repo.save(ch);
      await this.notifier.alert('channel_quarantined', {
        channelId, handle: ch.handle, reason: 'policy_removal', policyRemovals: m.policyRemovals,
      });
      this.log.error('channel quarantined', { channelId, handle: ch.handle, policyRemovals: m.policyRemovals });
    } else if (m.postedCount > m.dailyCap) {
      // 상한을 넘겼으면 즉시 한 칸 내린다 (내리는 쪽이 빠른 비대칭 설계).
      state = 'THROTTLED';
      ch.healthState = 'THROTTLED';
      ch.dailyCap = Math.max(m.dailyCap - 1, 1);
      await repo.save(ch);
      await this.notifier.warn('channel_throttled', {
        channelId, handle: ch.handle, postedCount: m.postedCount, newDailyCap: ch.dailyCap,
      });
      this.log.warn('channel throttled', { channelId, postedCount: m.postedCount, newDailyCap: ch.dailyCap });
    } else if (ch.healthState === 'THROTTLED') {
      // 하루 정상적으로 지나면 THROTTLED 는 푼다. 상한은 올리지 않는다 (AI_STEP 은 V2).
      state = 'ACTIVE';
      ch.healthState = 'ACTIVE';
      await repo.save(ch);
    } else {
      state = ch.healthState;
    }

    await this.ds
      .getRepository(ChannelHealthLog)
      .createQueryBuilder()
      .insert()
      .values({
        channelId,
        observedOn: m.date,
        postedCount: m.postedCount,
        policyRemovals: m.policyRemovals,
        dailyCap: m.dailyCap,
        reachRate: m.reachRate ?? null,
        reachZscore: m.reachZscore ?? null,
        // QueryDeepPartialEntity 가 jsonb 를 표현하지 못해 좁혀준다.
        signals: (m.signals ?? {}) as never,
        stateAfter: state,
      })
      .orUpdate(
        ['posted_count', 'policy_removals', 'daily_cap', 'reach_rate', 'reach_zscore', 'signals', 'state_after'],
        ['channel_id', 'observed_on'],
      )
      .execute();

    return state;
  }

  /** 오늘 관측치를 실제 게시 기록에서 만들어 observe 에 넘긴다. */
  async observeToday(channelId: string, now = new Date()): Promise<ChannelHealthState> {
    const ch = await this.ds.getRepository(Channel).findOneOrFail({ where: { id: channelId } });
    return this.observe(channelId, {
      date: now.toISOString().slice(0, 10),
      postedCount: await this.countToday(channelId, now),
      // 정책 삭제는 플랫폼 API 로만 알 수 있다. V1 은 REMOVED 로 표시된 게시를 센다.
      policyRemovals: await this.ds.getRepository(Publication).count({
        where: { channelId, status: 'REMOVED' },
      }),
      dailyCap: ch.dailyCap,
    });
  }

  /** 격리 해제 — 자동으로는 절대 일어나지 않는다. */
  async release(channelId: string, dailyCap?: number): Promise<Channel> {
    const repo = this.ds.getRepository(Channel);
    const ch = await repo.findOne({ where: { id: channelId } });
    if (!ch) throw new AppError('NOT_FOUND', { message: '채널을 찾을 수 없습니다.' });

    ch.healthState = 'ACTIVE';
    ch.quarantinedAt = null;
    ch.quarantineReason = null;
    // 해제 시 상한을 보수적으로 되돌린다. 관측된 안전 상한을 넘지 않는다.
    ch.dailyCap = Math.min(dailyCap ?? ch.dailyCap, ch.observedSafeMax);
    await repo.save(ch);
    this.log.info('channel released from quarantine', { channelId, dailyCap: ch.dailyCap });
    return ch;
  }

  async quarantine(channelId: string, reason: string): Promise<Channel> {
    const repo = this.ds.getRepository(Channel);
    const ch = await repo.findOne({ where: { id: channelId } });
    if (!ch) throw new AppError('NOT_FOUND', { message: '채널을 찾을 수 없습니다.' });

    ch.healthState = 'QUARANTINE';
    ch.quarantinedAt = new Date();
    ch.quarantineReason = reason;
    await repo.save(ch);
    await this.notifier.alert('channel_quarantined', { channelId, handle: ch.handle, reason });
    return ch;
  }

  private async countToday(channelId: string, now: Date): Promise<number> {
    const rows = await this.ds.query<Array<{ count: string }>>(
      `SELECT COUNT(*)::text AS count FROM publications
        WHERE channel_id = $1
          AND status IN ('UPLOADED','PUBLISHED')
          AND created_at >= date_trunc('day', $2::timestamptz)`,
      [channelId, now.toISOString()],
    );
    return Number(rows[0]?.count ?? 0);
  }

  private async lastPublishedAt(channelId: string): Promise<Date | null> {
    const rows = await this.ds.query<Array<{ at: Date | null }>>(
      `SELECT MAX(created_at) AS at FROM publications
        WHERE channel_id = $1 AND status IN ('UPLOADED','PUBLISHED')`,
      [channelId],
    );
    return rows[0]?.at ?? null;
  }
}
