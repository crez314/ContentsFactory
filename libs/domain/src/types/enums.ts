/** §2.2 CHECK 제약과 1:1 대응하는 열거값. DB 제약이 단일 출처이며 여기는 그 사본이다. */

export const ARTIST_STATUS = ['ACTIVE', 'PAUSED', 'ARCHIVED'] as const;
export type ArtistStatus = (typeof ARTIST_STATUS)[number];

export const MEDIA_TYPE = ['PHOTO', 'VIDEO', 'AUDIO'] as const;
export type MediaType = (typeof MEDIA_TYPE)[number];

export const QUALITY_GRADE = ['A', 'B', 'C'] as const;
export type QualityGrade = (typeof QUALITY_GRADE)[number];

export const TAGGING_STATUS = ['PENDING', 'AUTO_DONE', 'REVIEWED'] as const;
export type TaggingStatus = (typeof TAGGING_STATUS)[number];

export const ASSET_STATUS = ['UPLOADING', 'ACTIVE', 'BLOCKED', 'ARCHIVED'] as const;
export type AssetStatus = (typeof ASSET_STATUS)[number];

export const PLATFORM = ['YOUTUBE', 'TIKTOK', 'INSTAGRAM', 'X'] as const;
export type Platform = (typeof PLATFORM)[number];

export const CHANNEL_STATUS = ['ACTIVE', 'PAUSED', 'SUSPENDED'] as const;
export type ChannelStatus = (typeof CHANNEL_STATUS)[number];

/**
 * §4.9 채널 건강 상태.
 * 운영자가 끄고 켜는 status 와는 축이 다르다 — 이쪽은 플랫폼 제재 위험에 대한 자동 판정이다.
 */
export const CHANNEL_HEALTH_STATE = ['ACTIVE', 'THROTTLED', 'QUARANTINE'] as const;
export type ChannelHealthState = (typeof CHANNEL_HEALTH_STATE)[number];

export const CHANNEL_HEALTH_LABELS_KO: Record<ChannelHealthState, string> = {
  ACTIVE: '정상',
  THROTTLED: '상한 하향',
  QUARANTINE: '격리',
};

export const AGENT_KIND = ['IMAGE', 'VIDEO', 'SCRIPT', 'VOICE', 'MUSIC', 'SUBTITLE'] as const;
export type AgentKind = (typeof AGENT_KIND)[number];

export const AGENT_LIFECYCLE = [
  'CREATED', 'CONFIGURED', 'TEST', 'ACTIVE', 'PAUSED', 'PAUSED_BUDGET', 'ARCHIVED',
] as const;
export type AgentLifecycle = (typeof AGENT_LIFECYCLE)[number];

export const OUTPUT_TYPE = ['IMAGE', 'VIDEO', 'BOTH'] as const;
export type OutputType = (typeof OUTPUT_TYPE)[number];

export const ORDER_STATUS = [
  'DRAFT', 'VALIDATING', 'REJECTED', 'QUEUED', 'RUNNING', 'PARTIAL', 'DONE', 'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUS)[number];

export const CONTENT_STATUS = [
  'PENDING', 'GENERATING', 'RENDERING', 'QC', 'QC_FAILED', 'READY',
  'APPROVED', 'REJECTED', 'PUBLISHING', 'PUBLISHED', 'BLOCKED', 'FAILED',
] as const;
export type ContentStatus = (typeof CONTENT_STATUS)[number];

export const SCENE_SOURCE_TYPE = ['REAL_IMAGE', 'AI_IMAGE', 'AI_VIDEO', 'TEXT_MOTION'] as const;
export type SceneSourceType = (typeof SCENE_SOURCE_TYPE)[number];

export const SCENE_STATUS = ['PENDING', 'GENERATING', 'DONE', 'FAILED'] as const;
export type SceneStatus = (typeof SCENE_STATUS)[number];

export const GENERATED_KIND = ['IMAGE', 'VIDEO', 'AUDIO', 'SUBTITLE', 'RENDER'] as const;
export type GeneratedKind = (typeof GENERATED_KIND)[number];

export const QC_VERDICT = ['PASS', 'FAIL', 'BLOCKED'] as const;
export type QcVerdict = (typeof QC_VERDICT)[number];

export const APPROVAL_DECISION = ['APPROVED', 'REJECTED'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISION)[number];

export const VISIBILITY = ['PRIVATE', 'UNLISTED', 'PUBLIC'] as const;
export type Visibility = (typeof VISIBILITY)[number];

export const PUBLICATION_STATUS = [
  'PENDING', 'UPLOADING', 'UPLOADED', 'PUBLISHED', 'FAILED', 'REMOVED',
] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUS)[number];

/** §3.2 Task kind */
export const TASK_KIND = [
  'SELECTION', 'BLUEPRINT', 'GENERATE_IMAGE', 'GENERATE_VIDEO', 'RENDER', 'QC', 'PUBLISH',
] as const;
export type TaskKind = (typeof TASK_KIND)[number];

export const TASK_STATE = [
  'QUEUED', 'RUNNING', 'RETRY', 'FALLBACK', 'ESCALATED', 'DONE', 'FAILED', 'CANCELLED',
] as const;
export type TaskState = (typeof TASK_STATE)[number];

/** §3.1 우선순위 */
export const PRIORITY_LABEL: Record<number, string> = {
  0: 'P0 긴급',
  1: 'P1 아티스트 캠페인',
  2: 'P2 급상승 대응',
  3: 'P3 일반',
  4: 'P4 상시',
};

export const USER_ROLE = ['SUPER_ROOT', 'ADMIN', 'OPERATOR', 'REVIEWER', 'VIEWER'] as const;
export type UserRole = (typeof USER_ROLE)[number];
