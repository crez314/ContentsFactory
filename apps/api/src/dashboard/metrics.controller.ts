import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { MinRole } from '@cf/common';

/**
 * §9.5 지표 측정 정의 (명세 v1.1).
 *
 * 운영 지표는 산식과 소스 테이블을 고정한다. 자의적 해석을 배제하고,
 * V1 검증 결과를 사업 문서(PART 1, 3.13)의 정량 항목에 그대로 쓰기 위한 정의다.
 *
 * 여기 SQL 이 곧 산식의 단일 출처다. 화면이나 보고서에서 따로 계산하지 않는다.
 */
@ApiTags('metrics')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly ds: DataSource) {}

  @Get()
  @MinRole('VIEWER')
  @ApiOperation({ summary: '§9.5 운영 지표 — 산식과 소스가 고정되어 있다' })
  async metrics(@Query('days') days = '30') {
    const n = Math.min(365, Math.max(1, Number(days) || 30));
    const since = `now() - ${n} * interval '1 day'`;

    const [row] = await this.ds.query<Array<Record<string, string | null>>>(`
      WITH
      -- 제작 리드타임: 오더 접수 → 게시. accepted_at 컬럼이 없어 오더 생성 시각을 접수 시각으로 본다.
      leadtime AS (
        SELECT percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY EXTRACT(EPOCH FROM (p.created_at - o.created_at))
               ) AS median_sec
          FROM publications p
          JOIN contents c ON c.id = p.content_id
          JOIN orders   o ON o.id = c.order_id
         WHERE p.created_at >= ${since}
      ),
      -- 콘텐츠 원가: content_id 기준 합계 (재생성분 포함)
      unitcost AS (
        SELECT AVG(t.cost) AS avg_cost
          FROM (SELECT content_id, SUM(cost_krw) AS cost
                  FROM cost_logs
                 WHERE content_id IS NOT NULL AND occurred_at >= ${since}
                 GROUP BY 1) t
      ),
      -- 촬영당 산출 수: 동일 촬영 세션(촬영일)에 연결된 콘텐츠 수
      pershoot AS (
        SELECT AVG(t.cnt) AS avg_cnt
          FROM (SELECT a.shot_at, COUNT(DISTINCT u.content_id) AS cnt
                  FROM asset_usages u
                  JOIN assets a ON a.id = u.asset_id
                 WHERE a.shot_at IS NOT NULL AND u.created_at >= ${since}
                 GROUP BY 1) t
      ),
      -- 자동 제작 성공률: 정상 완료 / 생성 시도
      success AS (
        SELECT COUNT(*) FILTER (WHERE status IN ('PUBLISHED','APPROVED','READY'))::numeric AS ok,
               NULLIF(COUNT(*), 0)::numeric                                                AS total
          FROM contents WHERE created_at >= ${since}
      ),
      -- 자동화율: 자동 승인 게시 / 전체 게시
      automation AS (
        SELECT COUNT(*) FILTER (WHERE ap.auto)::numeric AS auto_cnt,
               NULLIF(COUNT(*), 0)::numeric             AS total
          FROM publications p
          JOIN approvals ap ON ap.content_id = p.content_id AND ap.decision = 'APPROVED'
         WHERE p.created_at >= ${since}
      ),
      -- 재작업률: QC FAIL 이후 재생성 / 총 생성 시도
      rework AS (
        SELECT (SELECT COUNT(*) FROM qc_results
                 WHERE verdict = 'FAIL' AND created_at >= ${since})::numeric AS fails,
               (SELECT NULLIF(COUNT(*), 0) FROM tasks
                 WHERE kind IN ('GENERATE_IMAGE','GENERATE_VIDEO','RENDER')
                   AND queued_at >= ${since})::numeric                        AS attempts
      ),
      -- QC 자동판정 정확도: 자동 판정과 사람 재검토 판정의 일치율
      qcaccuracy AS (
        SELECT COUNT(*) FILTER (
                 WHERE (q.verdict = 'PASS' AND ap.decision = 'APPROVED')
                    OR (q.verdict <> 'PASS' AND ap.decision = 'REJECTED')
               )::numeric AS agreed,
               NULLIF(COUNT(*), 0)::numeric AS reviewed
          FROM approvals ap
          JOIN LATERAL (SELECT verdict FROM qc_results
                         WHERE content_id = ap.content_id
                         ORDER BY attempt DESC LIMIT 1) q ON true
         WHERE ap.auto = false AND ap.created_at >= ${since}
      ),
      -- Identity 일치도
      identity AS (
        SELECT AVG((area_scores->>'identity')::numeric) AS avg_identity
          FROM qc_results WHERE created_at >= ${since}
      ),
      -- 오더 실행률: Validator 통과 / 접수
      execrate AS (
        SELECT COUNT(*) FILTER (WHERE status <> 'REJECTED' AND status <> 'DRAFT')::numeric AS passed,
               NULLIF(COUNT(*) FILTER (WHERE status <> 'DRAFT'), 0)::numeric               AS accepted
          FROM orders WHERE created_at >= ${since}
      ),
      -- 사전 차단 절감액: 반려 오더의 예상 생성비
      saved AS (
        SELECT COALESCE(SUM(budget_cap), 0) AS krw, COUNT(*) AS cnt
          FROM orders WHERE status = 'REJECTED' AND created_at >= ${since}
      )
      SELECT
        (SELECT median_sec   FROM leadtime)::text     AS leadtime_sec,
        (SELECT avg_cost     FROM unitcost)::text     AS unit_cost_krw,
        (SELECT avg_cnt      FROM pershoot)::text     AS contents_per_shoot,
        (SELECT ok/total     FROM success)::text      AS success_rate,
        (SELECT auto_cnt/total FROM automation)::text AS automation_rate,
        (SELECT fails/attempts FROM rework)::text     AS rework_rate,
        (SELECT agreed/reviewed FROM qcaccuracy)::text AS qc_accuracy,
        (SELECT reviewed     FROM qcaccuracy)::text   AS qc_reviewed_n,
        (SELECT avg_identity FROM identity)::text     AS identity_score,
        (SELECT passed/accepted FROM execrate)::text  AS order_exec_rate,
        (SELECT krw          FROM saved)::text        AS blocked_saving_krw,
        (SELECT cnt          FROM saved)::text        AS blocked_order_count
    `);

    const num = (v: string | null): number | null => (v === null ? null : Number(v));

    return {
      windowDays: n,
      metrics: [
        { key: 'leadTimeSec', label: '제작 리드타임(중앙값, 초)',
          value: num(row.leadtime_sec), formula: 'median(publications.created_at − orders.created_at)',
          source: 'orders · publications' },
        { key: 'unitCostKrw', label: '콘텐츠 원가(평균, 원)',
          value: num(row.unit_cost_krw), formula: 'Σ cost_logs.cost_krw (content_id 기준, 재생성분 포함)',
          source: 'cost_logs' },
        { key: 'contentsPerShoot', label: '촬영당 산출 수',
          value: num(row.contents_per_shoot), formula: '동일 촬영 세션에 연결된 contents 수',
          source: 'assets · asset_usages · contents' },
        { key: 'successRate', label: '자동 제작 성공률',
          value: num(row.success_rate), formula: '정상 완료 contents / 생성 시도 contents',
          source: 'contents · tasks' },
        { key: 'automationRate', label: '자동화율',
          value: num(row.automation_rate), formula: '자동 승인 게시 건수 / 전체 게시 건수',
          source: 'approvals · publications' },
        { key: 'reworkRate', label: '재작업률',
          value: num(row.rework_rate), formula: 'QC FAIL 이후 재생성 건수 / 총 생성 시도 건수',
          source: 'qc_results · tasks' },
        { key: 'qcAccuracy', label: 'QC 자동판정 정확도',
          value: num(row.qc_accuracy), sampleSize: num(row.qc_reviewed_n),
          formula: '자동 판정과 사람 재검토 판정의 일치 건수 / 재검토 표본 수',
          source: 'qc_results · approvals' },
        { key: 'identityScore', label: 'Identity 일치도',
          value: num(row.identity_score), formula: 'mean(top3(cos(기준 임베딩, 생성물)))',
          source: 'qc_results.area_scores.identity' },
        { key: 'orderExecRate', label: '오더 실행률',
          value: num(row.order_exec_rate), formula: 'Validator 통과 오더 / 접수 오더',
          source: 'orders' },
        { key: 'blockedSavingKrw', label: '사전 차단 절감액(원)',
          value: num(row.blocked_saving_krw), sampleSize: num(row.blocked_order_count),
          formula: 'Σ 반려 오더의 예상 생성비', source: 'orders · cost_logs 단가표' },
      ],
    };
  }

  /**
   * §9.5 — 실패 이력은 전량 보존한다.
   * task_events 와 qc_results 의 실패 레코드는 삭제하지 않으며, 실패 유형 코드를 함께 기록한다.
   * 이 부정 사례 코퍼스는 V2 리스크 스코어러의 학습 입력이 된다.
   */
  @Get('failure-corpus')
  @MinRole('OPERATOR')
  @ApiOperation({ summary: '실패 사례 코퍼스 통계 (V2 리스크 스코어러 학습 입력)' })
  async failureCorpus(@Query('days') days = '90') {
    const n = Math.min(365, Math.max(1, Number(days) || 90));
    const [taskFailures, qcFailures, coverageGaps] = await Promise.all([
      this.ds.query(
        `SELECT t.kind, t.error->>'code' AS code, COUNT(*)::int AS count
           FROM tasks t
          WHERE t.state IN ('FAILED','ESCALATED') AND t.queued_at >= now() - ($1 || ' days')::interval
          GROUP BY 1,2 ORDER BY 3 DESC`, [n]),
      this.ds.query(
        `SELECT verdict, retry_target, COUNT(*)::int AS count
           FROM qc_results
          WHERE verdict <> 'PASS' AND created_at >= now() - ($1 || ' days')::interval
          GROUP BY 1,2 ORDER BY 3 DESC`, [n]),
      this.ds.query(
        `SELECT reason, requested_attributes, COUNT(*)::int AS count
           FROM coverage_gaps
          WHERE created_at >= now() - ($1 || ' days')::interval
          GROUP BY 1,2 ORDER BY 3 DESC LIMIT 50`, [n]),
    ]);
    return { windowDays: n, taskFailures, qcFailures, coverageGaps };
  }

  /** §4.3 커버리지 부족 — V2 촬영 가이드 환류의 입력 */
  @Get('coverage-gaps')
  @MinRole('OPERATOR')
  @ApiOperation({ summary: '반복적으로 자산 부족으로 반려된 속성 조합' })
  async coverageGaps(@Query('days') days = '90') {
    const n = Math.min(365, Math.max(1, Number(days) || 90));
    const rows = await this.ds.query(
      `SELECT g.requested_attributes, g.reason,
              COUNT(*)::int         AS gap_count,
              MAX(g.best_fit_score) AS best_fit_score,
              MAX(g.created_at)     AS last_seen,
              a.name                AS artist_name,
              g.artist_id
         FROM coverage_gaps g
         JOIN artists a ON a.id = g.artist_id
        WHERE g.created_at >= now() - ($1 || ' days')::interval
        GROUP BY g.requested_attributes, g.reason, a.name, g.artist_id
        ORDER BY gap_count DESC, last_seen DESC
        LIMIT 100`, [n]);
    return { windowDays: n, gaps: rows };
  }
}
