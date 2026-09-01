import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

type Env = 'local' | 'dev' | 'stage' | 'prod' | 'test';

function str(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`missing required env: ${key}`);
  return v;
}
function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`env ${key} is not a number: ${v}`);
  return n;
}
function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return v === '1' || v.toLowerCase() === 'true';
}

/**
 * 부록 A 환경변수 매핑.
 * local 환경은 Secrets Manager 대신 평문 시크릿을 허용한다.
 * dev 이상에서 평문 시크릿을 쓰면 부팅 시점에 거부한다.
 */
export const config = {
  env: str('NODE_ENV', 'local') as Env,
  logLevel: str('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',
  serviceName: process.env.SERVICE_NAME ?? 'api',

  db: {
    url: str('DATABASE_URL', 'postgres://crez:crez@localhost:55432/crez'),
    poolMax: num('DATABASE_POOL_MAX', 20),
  },

  redis: {
    url: str('REDIS_URL', 'redis://localhost:56379'),
    queuePrefix: str('QUEUE_PREFIX', 'cf'),
  },

  storage: {
    driver: str('STORAGE_DRIVER', 'local') as 'local' | 's3',
    localRoot: str('STORAGE_LOCAL_ROOT', '.storage'),
    bucket: str('S3_BUCKET', 'crez-content-factory'),
    region: str('S3_REGION', 'ap-northeast-2'),
    cdnBaseUrl: str('CDN_BASE_URL', 'http://localhost:4000/v1/files'),
    presignTtlSec: num('PRESIGN_TTL_SEC', 900), // §9.2 15분
  },

  auth: {
    accessSecret: str('JWT_ACCESS_SECRET', 'local-dev-access-secret-change-me'),
    refreshSecret: str('JWT_REFRESH_SECRET', 'local-dev-refresh-secret-change-me'),
    accessTtl: num('ACCESS_TOKEN_TTL', 1800),
    refreshTtl: num('REFRESH_TOKEN_TTL', 1209600),
    bcryptCost: num('BCRYPT_COST', 12),
    loginMaxFailures: num('LOGIN_MAX_FAILURES', 5),
    loginLockSeconds: num('LOGIN_LOCK_SECONDS', 900),
  },

  adapters: {
    // 'mock' | 'http'
    mode: str('ADAPTERS', 'mock') as 'mock' | 'http',
    mockLatencyMs: num('MOCK_LATENCY_MS', 200),
    mockFailureRate: num('MOCK_FAILURE_RATE', 0),
    mockIdentityBase: num('MOCK_IDENTITY_BASE', 0.9),
    imageTimeoutMs: num('ADAPTER_IMAGE_TIMEOUT_MS', 120_000), // §8.1
    videoTimeoutMs: num('ADAPTER_VIDEO_TIMEOUT_MS', 900_000),
    healthCacheMs: num('ADAPTER_HEALTH_CACHE_MS', 30_000),
  },

  ops: {
    qcPassScore: num('QC_PASS_SCORE', 80),
    identityThreshold: num('IDENTITY_THRESHOLD', 0.82),
    identityMargin: num('IDENTITY_MARGIN', 0.04),
    maxGenerationRetry: num('MAX_GENERATION_RETRY', 3),
    slaScanIntervalMs: num('SLA_SCAN_INTERVAL_MS', 60_000),
    minCandidateAssets: num('MIN_CANDIDATE_ASSETS', 8),
    maxQcAttempts: num('MAX_QC_ATTEMPTS', 3),
  },

  ports: {
    api: num('API_PORT', 4000),
    orchestrator: num('ORCHESTRATOR_PORT', 4001),
    worker: num('WORKER_PORT', 4002),
  },

  /** §4.9 채널 안전 게시 제어 */
  channel: {
    defaultDailyCap: num('CHANNEL_DEFAULT_DAILY_CAP', 3),
    minIntervalMin: num('CHANNEL_MIN_INTERVAL_MIN', 180),
    quarantineOnRemoval: bool('CHANNEL_QUARANTINE_ON_REMOVAL', true),
  },

  /** §4.8.1 정품 표식 */
  provenance: {
    signingKeyRef: str('PROVENANCE_SIGNING_KEY_REF', 'secretsmanager://crez/provenance/signing'),
    /** local 은 Secrets Manager 가 없으므로 이 값을 서명 키로 쓴다 (prod 에서는 거부된다) */
    localSigningKey: str('PROVENANCE_LOCAL_SIGNING_KEY', 'local-dev-provenance-key'),
    watermarkStrength: str('WATERMARK_STRENGTH', 'medium') as 'low' | 'medium' | 'high',
    phashAlgo: str('PHASH_ALGO', 'phash-dct-64'),
    /** 영상 지각해시를 뽑을 프레임 수 */
    frameSignatureCount: num('FRAME_SIGNATURE_COUNT', 5),
  },

  ffmpeg: {
    bin: str('FFMPEG_BIN', 'ffmpeg'),
    probeBin: str('FFPROBE_BIN', 'ffprobe'),
    enabled: bool('FFMPEG_ENABLED', true),
  },
} as const;

export const isLocalLike = (): boolean => config.env === 'local' || config.env === 'test';

/** dev 이상에서 로컬 기본 시크릿이 남아있으면 부팅 거부 (§9.2) */
export function assertProductionSafety(): void {
  if (isLocalLike()) return;
  if (config.auth.accessSecret.startsWith('local-dev')) {
    throw new Error('JWT_ACCESS_SECRET must be provided from Secrets Manager outside local');
  }
  if (config.storage.driver === 'local') {
    throw new Error('STORAGE_DRIVER=local is not allowed outside local env');
  }
  // §4.8.1 표식 없는 게시물은 이후 소명이 불가능하다. 서명 키가 없으면 부팅을 막는다.
  if (config.provenance.localSigningKey.startsWith('local-dev')) {
    throw new Error('PROVENANCE signing key must come from Secrets Manager outside local');
  }
}
