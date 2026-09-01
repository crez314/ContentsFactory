-- 명세 v1.1 (2026-09) 반영
--   §4.3  Selection — 라이선스를 점수에서 사전 필터로 전환
--   §4.8.1 정품 표식 및 계보 기록
--   §4.9  Channel Health Module
--   §13   V2 대비 컬럼 (다채널 병렬 실험)

-- ─────────────────────────────── §4.3 사전 필터에 필요한 컬럼
--
-- eligible() 은 order.allowedGrades 와 order.derivativeLevel / license.derivativeLevel 을 본다.
-- 기존 스키마에는 derivative_allowed(boolean) 만 있어 "어느 수준까지 허용되는가"를 표현하지 못한다.
-- 단계값으로 승격하고, 기존 boolean 은 하위호환을 위해 남긴다.
--
--   0 불허 / 1 단순 편집(크롭·색보정) / 2 합성·변형 / 3 AI 생성물 제작 허용
ALTER TABLE asset_licenses
  ADD COLUMN derivative_level smallint NOT NULL DEFAULT 0
    CHECK (derivative_level BETWEEN 0 AND 3);

-- 기존 데이터 이관: 허용이면 AI 생성까지 허용된 것으로 본다.
UPDATE asset_licenses SET derivative_level = CASE WHEN derivative_allowed THEN 3 ELSE 0 END;

ALTER TABLE orders
  -- 오더가 허용하는 품질 등급. 비어 있으면 전 등급 허용으로 해석한다.
  ADD COLUMN allowed_grades  text[]   NOT NULL DEFAULT '{}',
  -- 이 오더 수행에 필요한 최소 2차 가공 수준. AI 생성 파이프라인이므로 기본 3.
  ADD COLUMN derivative_level smallint NOT NULL DEFAULT 3
    CHECK (derivative_level BETWEEN 0 AND 3);

-- ─────────────────────────────── §4.3 자산 커버리지 부족 기록
-- SELECTION_INSUFFICIENT_COVERAGE 는 시스템 실패가 아니라 촬영 계획의 입력이다.
-- V1 은 적재만 하고, V2 촬영 가이드 환류에서 사용한다.
CREATE TABLE coverage_gaps (
  id                   bigserial PRIMARY KEY,
  order_id             uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  artist_id            uuid NOT NULL REFERENCES artists(id),
  requested_attributes jsonb NOT NULL,
  best_fit_score       numeric(6,2),
  best_asset_id        uuid REFERENCES assets(id),
  reason               varchar(40) NOT NULL DEFAULT 'INSUFFICIENT_COVERAGE',
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_coverage_gaps_artist ON coverage_gaps(artist_id, created_at DESC);
CREATE INDEX idx_coverage_gaps_attrs  ON coverage_gaps USING gin (requested_attributes jsonb_path_ops);

-- ─────────────────────────────── §4.8.1 정품 표식
-- 계보는 사후 소급 생성이 불가능하므로 V1 첫 게시부터 남긴다.
ALTER TABLE publications
  ADD COLUMN provenance_manifest_id text,
  ADD COLUMN watermark_id           text,
  ADD COLUMN phash                  text,
  ADD COLUMN frame_signature        jsonb,
  -- §13 V2 다채널 병렬 실험. V1 은 컬럼만 확보하고 사용하지 않는다.
  ADD COLUMN experiment_id          uuid,
  ADD COLUMN variant_key            text;

CREATE INDEX idx_publications_phash ON publications (phash);

-- ─────────────────────────────── §4.9 Channel Health
-- 한도를 올리는 속도보다 내리는 속도를 빠르게 두는 비대칭 설계.
ALTER TABLE channels
  ADD COLUMN health_state      varchar(16) NOT NULL DEFAULT 'ACTIVE'
    CHECK (health_state IN ('ACTIVE','THROTTLED','QUARANTINE')),
  ADD COLUMN daily_cap         int NOT NULL DEFAULT 3  CHECK (daily_cap >= 0),
  ADD COLUMN min_interval_min  int NOT NULL DEFAULT 180 CHECK (min_interval_min >= 0),
  ADD COLUMN observed_safe_max int NOT NULL DEFAULT 3,
  ADD COLUMN quarantined_at    timestamptz,
  ADD COLUMN quarantine_reason text;

CREATE TABLE channel_health_logs (
  id              bigserial PRIMARY KEY,
  channel_id      uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  observed_on     date NOT NULL,
  posted_count    int  NOT NULL DEFAULT 0,
  policy_removals int  NOT NULL DEFAULT 0,
  daily_cap       int  NOT NULL DEFAULT 0,
  reach_rate      numeric(10,4),        -- V2
  reach_zscore    numeric(10,4),        -- V2
  signals         jsonb NOT NULL DEFAULT '{}'::jsonb,
  state_after     varchar(16) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, observed_on)
);
CREATE INDEX idx_channel_health_logs_channel ON channel_health_logs(channel_id, observed_on DESC);

-- 게시 간격·일일 상한 조회가 잦으므로 인덱스를 둔다.
CREATE INDEX idx_publications_channel_created ON publications(channel_id, created_at DESC);
