-- PART 4 §2.2 DDL (PostgreSQL 15)
-- 공통 규약: uuid PK, created_at/updated_at timestamptz, deleted_at 소프트 삭제,
--            열거값은 CHECK 제약, 금액은 numeric(14,2) KRW 고정.
-- orders.requested_by 가 users 를 참조하므로 users → artists → assets 순으로 생성한다.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────── 사용자·권한
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         varchar(190) NOT NULL UNIQUE,
  name          varchar(80)  NOT NULL,
  password_hash text,
  role          varchar(20)  NOT NULL DEFAULT 'VIEWER'
                CHECK (role IN ('SUPER_ROOT','ADMIN','OPERATOR','REVIEWER','VIEWER')),
  status        varchar(20)  NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('ACTIVE','SUSPENDED')),
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id),
  action      varchar(60) NOT NULL,
  target_type varchar(40) NOT NULL,
  target_id   uuid,
  before      jsonb,
  after       jsonb,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_target ON audit_logs(target_type, target_id, created_at DESC);

-- ─────────────────────────────── 아티스트
CREATE TABLE artists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          varchar(100) NOT NULL,
  code          varchar(30)  NOT NULL UNIQUE,
  identity_ref  jsonb,                    -- 기준 임베딩 세트 메타 (S3 키 목록)
  status        varchar(20)  NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

-- ─────────────────────────────── 원본 자산
CREATE TABLE assets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id      uuid NOT NULL REFERENCES artists(id),
  media_type     varchar(20) NOT NULL
                 CHECK (media_type IN ('PHOTO','VIDEO','AUDIO')),
  storage_key    text        NOT NULL,
  file_size      bigint      NOT NULL,
  mime_type      varchar(80) NOT NULL,
  width          int,
  height         int,
  duration_ms    int,
  shot_at        date,
  attributes     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  quality_grade  varchar(1)  NOT NULL DEFAULT 'B'
                 CHECK (quality_grade IN ('A','B','C')),
  tagging_status varchar(20) NOT NULL DEFAULT 'PENDING'
                 CHECK (tagging_status IN ('PENDING','AUTO_DONE','REVIEWED')),
  status         varchar(20) NOT NULL DEFAULT 'ACTIVE'
                 CHECK (status IN ('UPLOADING','ACTIVE','BLOCKED','ARCHIVED')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
CREATE INDEX idx_assets_artist       ON assets(artist_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_assets_attributes   ON assets USING gin (attributes jsonb_path_ops);
CREATE INDEX idx_assets_status_type  ON assets(status, media_type);

-- ─────────────────────────────── 자산 라이선스
CREATE TABLE asset_licenses (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id           uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  allowed_channels   text[] NOT NULL DEFAULT '{}',
  allowed_regions    text[] NOT NULL DEFAULT '{}',
  derivative_allowed boolean NOT NULL DEFAULT true,
  valid_from         date   NOT NULL,
  valid_until        date   NOT NULL,
  contract_ref       varchar(120),
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_license_period CHECK (valid_until >= valid_from)
);
CREATE INDEX idx_licenses_asset  ON asset_licenses(asset_id);
CREATE INDEX idx_licenses_until  ON asset_licenses(valid_until);

-- ─────────────────────────────── 채널
CREATE TABLE channels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform      varchar(20) NOT NULL
                CHECK (platform IN ('YOUTUBE','TIKTOK','INSTAGRAM','X')),
  handle        varchar(120) NOT NULL,
  segment       varchar(60),
  region        varchar(10),
  spec          jsonb NOT NULL DEFAULT '{}'::jsonb,
  credential_ref varchar(200),
  status        varchar(20) NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('ACTIVE','PAUSED','SUSPENDED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, handle)
);

-- ─────────────────────────────── 생성 주체 (에이전트)
CREATE TABLE agents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           varchar(80) NOT NULL,
  kind           varchar(30) NOT NULL
                 CHECK (kind IN ('IMAGE','VIDEO','SCRIPT','VOICE','MUSIC','SUBTITLE')),
  profile        jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval_level smallint NOT NULL DEFAULT 0
                 CHECK (approval_level BETWEEN 0 AND 3),
  daily_budget   numeric(14,2) NOT NULL DEFAULT 0,
  monthly_budget numeric(14,2) NOT NULL DEFAULT 0,
  lifecycle      varchar(20) NOT NULL DEFAULT 'CREATED'
                 CHECK (lifecycle IN ('CREATED','CONFIGURED','TEST','ACTIVE',
                                      'PAUSED','PAUSED_BUDGET','ARCHIVED')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────── 제작 오더
CREATE TABLE orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no       varchar(30) NOT NULL UNIQUE,     -- ORD-20260901-0001
  artist_id      uuid NOT NULL REFERENCES artists(id),
  requested_by   uuid NOT NULL REFERENCES users(id),
  agent_id       uuid REFERENCES agents(id),
  output_type    varchar(20) NOT NULL
                 CHECK (output_type IN ('IMAGE','VIDEO','BOTH')),
  quantity       int NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  concept        jsonb NOT NULL DEFAULT '{}'::jsonb,
  design         jsonb NOT NULL DEFAULT '{}'::jsonb,
  spec           jsonb NOT NULL DEFAULT '{}'::jsonb,
  asset_filter   jsonb NOT NULL DEFAULT '{}'::jsonb,
  budget_cap     numeric(14,2) NOT NULL DEFAULT 0,
  approval_level smallint NOT NULL DEFAULT 0,
  scheduled_at   timestamptz,
  status         varchar(24) NOT NULL DEFAULT 'DRAFT'
                 CHECK (status IN ('DRAFT','VALIDATING','REJECTED','QUEUED',
                                   'RUNNING','PARTIAL','DONE','CANCELLED')),
  reject_reason  jsonb,
  idempotency_key varchar(160) UNIQUE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_status  ON orders(status, created_at DESC);
CREATE INDEX idx_orders_artist  ON orders(artist_id);

CREATE TABLE order_channels (
  order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels(id),
  PRIMARY KEY (order_id, channel_id)
);

-- ─────────────────────────────── 자산 선별 결과
CREATE TABLE selections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  asset_id    uuid NOT NULL REFERENCES assets(id),
  rank        int  NOT NULL,
  fit_score   numeric(5,2) NOT NULL,
  reason      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, asset_id)
);
CREATE INDEX idx_selections_order ON selections(order_id, rank);

-- ─────────────────────────────── 제작 사양
CREATE TABLE blueprints (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  channel_id   uuid NOT NULL REFERENCES channels(id),
  seq          int  NOT NULL,
  output_type  varchar(20) NOT NULL,
  layout       jsonb NOT NULL DEFAULT '{}'::jsonb,
  style        jsonb NOT NULL DEFAULT '{}'::jsonb,
  scene_plan   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, channel_id, seq)
);

-- ─────────────────────────────── 콘텐츠
CREATE TABLE contents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id  uuid NOT NULL REFERENCES blueprints(id),
  order_id      uuid NOT NULL REFERENCES orders(id),
  title         varchar(200),
  description   text,
  hashtags      text[] NOT NULL DEFAULT '{}',
  output_type   varchar(20) NOT NULL,
  final_key     text,
  duration_ms   int,
  status        varchar(24) NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING','GENERATING','RENDERING','QC',
                                  'QC_FAILED','READY','APPROVED','REJECTED',
                                  'PUBLISHING','PUBLISHED','BLOCKED','FAILED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_contents_status ON contents(status, created_at DESC);
CREATE INDEX idx_contents_order  ON contents(order_id);

-- ─────────────────────────────── Scene (영상 트랙)
CREATE TABLE scenes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id    uuid NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  seq           int  NOT NULL,
  duration_ms   int  NOT NULL,
  source_type   varchar(20) NOT NULL
                CHECK (source_type IN ('REAL_IMAGE','AI_IMAGE','AI_VIDEO','TEXT_MOTION')),
  source_asset_id uuid REFERENCES assets(id),
  prompt        text,
  subtitle      text,
  status        varchar(20) NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING','GENERATING','DONE','FAILED')),
  retry_count   smallint NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_id, seq)
);

-- ─────────────────────────────── 생성 산출물
CREATE TABLE generated_assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id      uuid NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  scene_id        uuid REFERENCES scenes(id) ON DELETE CASCADE,
  kind            varchar(20) NOT NULL
                  CHECK (kind IN ('IMAGE','VIDEO','AUDIO','SUBTITLE','RENDER')),
  storage_key     text NOT NULL,
  provider        varchar(60) NOT NULL,
  model_version   varchar(80),
  cost_krw        numeric(14,2) NOT NULL DEFAULT 0,
  latency_ms      int,
  identity_score  numeric(5,4),
  cache_key       varchar(64),
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_gen_content ON generated_assets(content_id);
CREATE INDEX idx_gen_cache   ON generated_assets(cache_key);

-- ─────────────────────────────── 콘텐츠 계보 (Content Lineage)
CREATE TABLE asset_usages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id   uuid NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  asset_id     uuid NOT NULL REFERENCES assets(id),
  scene_id     uuid REFERENCES scenes(id) ON DELETE CASCADE,
  usage_weight numeric(5,4) NOT NULL DEFAULT 1.0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- scene_id 가 NULL 인 행은 UNIQUE 제약이 걸리지 않으므로 부분 인덱스로 보완한다.
CREATE UNIQUE INDEX uq_usages_scene   ON asset_usages(content_id, asset_id, scene_id) WHERE scene_id IS NOT NULL;
CREATE UNIQUE INDEX uq_usages_noscene ON asset_usages(content_id, asset_id)           WHERE scene_id IS NULL;
CREATE INDEX idx_usages_asset   ON asset_usages(asset_id);
CREATE INDEX idx_usages_content ON asset_usages(content_id);

-- ─────────────────────────────── QC 결과
CREATE TABLE qc_results (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id    uuid NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  attempt       smallint NOT NULL DEFAULT 1,
  total_score   numeric(5,2) NOT NULL,
  verdict       varchar(12) NOT NULL
                CHECK (verdict IN ('PASS','FAIL','BLOCKED')),
  area_scores   jsonb NOT NULL,
  violations    jsonb NOT NULL DEFAULT '[]'::jsonb,
  retry_target  varchar(20),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_id, attempt)
);

-- ─────────────────────────────── 승인
CREATE TABLE approvals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id   uuid NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  decided_by   uuid REFERENCES users(id),
  decision     varchar(12) NOT NULL
               CHECK (decision IN ('APPROVED','REJECTED')),
  auto         boolean NOT NULL DEFAULT false,
  level_at     smallint NOT NULL,
  comment      text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_approvals_content ON approvals(content_id, created_at DESC);

-- ─────────────────────────────── 게시
CREATE TABLE publications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id     uuid NOT NULL REFERENCES contents(id),
  channel_id     uuid NOT NULL REFERENCES channels(id),
  external_id    varchar(120),
  external_url   text,
  visibility     varchar(12) NOT NULL DEFAULT 'PRIVATE'
                 CHECK (visibility IN ('PRIVATE','UNLISTED','PUBLIC')),
  status         varchar(20) NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','UPLOADING','UPLOADED',
                                   'PUBLISHED','FAILED','REMOVED')),
  published_at   timestamptz,
  error          jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_id, channel_id)
);

-- ─────────────────────────────── 성과 (V1에서는 스키마만)
CREATE TABLE analytics_snapshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id    uuid NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  collected_at      timestamptz NOT NULL,
  views             bigint NOT NULL DEFAULT 0,
  likes             bigint NOT NULL DEFAULT 0,
  comments          bigint NOT NULL DEFAULT 0,
  shares            bigint NOT NULL DEFAULT 0,
  avg_view_ms       int,
  retention_rate    numeric(5,4),
  follows_gained    int,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (publication_id, collected_at)
);

-- ─────────────────────────────── Task (오케스트레이션)
CREATE TABLE tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          varchar(40) NOT NULL,
  order_id      uuid REFERENCES orders(id),
  content_id    uuid REFERENCES contents(id),
  scene_id      uuid REFERENCES scenes(id),
  agent_id      uuid REFERENCES agents(id),
  priority      smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 0 AND 4),
  state         varchar(20) NOT NULL DEFAULT 'QUEUED'
                CHECK (state IN ('QUEUED','RUNNING','RETRY','FALLBACK',
                                 'ESCALATED','DONE','FAILED','CANCELLED')),
  retry_count   smallint NOT NULL DEFAULT 0,
  max_retry     smallint NOT NULL DEFAULT 3,
  idempotency_key varchar(120) NOT NULL UNIQUE,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  result        jsonb,
  error         jsonb,
  queued_at     timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  sla_deadline  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tasks_state    ON tasks(state, priority, queued_at);
CREATE INDEX idx_tasks_order    ON tasks(order_id);
CREATE INDEX idx_tasks_content  ON tasks(content_id);
CREATE INDEX idx_tasks_sla      ON tasks(sla_deadline) WHERE state IN ('QUEUED','RUNNING');

CREATE TABLE task_events (
  id         bigserial PRIMARY KEY,
  task_id    uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_state varchar(20),
  to_state   varchar(20) NOT NULL,
  reason     text,
  meta       jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_task_events_task ON task_events(task_id, created_at);

-- ─────────────────────────────── 비용
CREATE TABLE cost_logs (
  id          bigserial PRIMARY KEY,
  agent_id    uuid REFERENCES agents(id),
  content_id  uuid REFERENCES contents(id),
  task_id     uuid REFERENCES tasks(id),
  provider    varchar(60) NOT NULL,
  cost_krw    numeric(14,2) NOT NULL,
  unit        varchar(30),
  quantity    numeric(12,4),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cost_agent_date ON cost_logs(agent_id, occurred_at);
CREATE INDEX idx_cost_content    ON cost_logs(content_id);

-- ─────────────────────────────── 마스터 (속성 표준값 · 금지어)
-- §4.1 "값 추가는 마스터 테이블 관리 화면에서 수행한다"
CREATE TABLE master_attribute_values (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attribute   varchar(40) NOT NULL,
  value       varchar(60) NOT NULL,
  label_ko    varchar(60),
  sort_order  int NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attribute, value)
);

CREATE TABLE master_banned_terms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term        varchar(120) NOT NULL UNIQUE,
  category    varchar(30) NOT NULL DEFAULT 'BRAND'
              CHECK (category IN ('BRAND','POLICY','TOPIC')),
  severity    varchar(10) NOT NULL DEFAULT 'WARN'
              CHECK (severity IN ('WARN','BLOCK')),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────── 시스템 플래그 (Emergency Stop)
CREATE TABLE system_flags (
  key        varchar(60) PRIMARY KEY,
  value      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO system_flags(key, value) VALUES ('emergency_stop', '{"active": false}'::jsonb);
