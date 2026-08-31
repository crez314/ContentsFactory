export interface ObjectHead {
  size: number;
  contentType?: string;
  lastModified?: Date;
}

/**
 * §9.2 — 오브젝트는 직접 노출하지 않는다. 조회는 Presigned URL(15분)만 허용한다.
 * local 환경은 S3 대신 파일시스템 + HMAC 서명 URL 로 동일한 계약을 구현한다.
 */
export interface StorageDriver {
  readonly name: 'local' | 's3';
  presignPut(key: string, contentType: string, ttlSec: number): Promise<string>;
  presignGet(key: string, ttlSec: number): Promise<string>;
  head(key: string): Promise<ObjectHead | null>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** 워커가 ffmpeg 등 외부 프로세스에 넘길 실제 경로 (local 전용, s3 는 임시 다운로드) */
  materialize(key: string): Promise<string>;
  copy(from: string, to: string): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
