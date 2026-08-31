/** §4.5 Model Abstraction Layer — 모든 외부 생성 모델이 구현하는 계약 */

export type Capability = 'image' | 'video' | 'voice' | 'music' | 'embedding';

export interface GenRequest {
  prompt: string;
  aspect: string;                 // '9:16' | '1:1' | '16:9'
  durationSec?: number;           // 영상만
  identityRefKeys?: string[];     // 아티스트 기준 자산 스토리지 키
  sourceAssetKey?: string;        // 변형 대상 원본
  seed?: number | null;
  /** 산출물을 쓸 스토리지 키. 호출자가 지정한다. */
  outputKey: string;
  palette?: string[];
  meta?: Record<string, unknown>;
}

export interface GenResult {
  storageKey: string;
  provider: string;
  modelVersion?: string;
  costKrw: number;
  latencyMs: number;
  meta: Record<string, unknown>;
}

export interface GenerationBackend {
  readonly name: string;
  readonly capability: Capability;
  readonly unitCostKrw: number;
  healthy(): Promise<boolean>;
  generate(req: GenRequest): Promise<GenResult>;
}

/** 임베딩은 벡터를 돌려주므로 별도 계약을 둔다. */
export interface EmbeddingBackend extends GenerationBackend {
  readonly capability: 'embedding';
  readonly dim: number;
  embed(storageKey: string): Promise<number[]>;
}

export function isEmbeddingBackend(b: GenerationBackend): b is EmbeddingBackend {
  return b.capability === 'embedding' && typeof (b as EmbeddingBackend).embed === 'function';
}

/** 워커가 생성 호출에 함께 넘기는 실행 컨텍스트 */
export interface JobCtx {
  taskId: string;
  orderId?: string | null;
  contentId?: string | null;
  sceneId?: string | null;
  agentId?: string | null;
  artistId?: string | null;
  requestId?: string;
  /** 이 호출에 허용되는 최대 단가 */
  maxCostKrw?: number;
}
