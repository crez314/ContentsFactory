import type { Platform } from '@cf/domain';

export interface UploadRequest {
  filePath: string;
  storageKey: string;
  title: string;
  description: string;
  hashtags: string[];
  /** V1 은 항상 PRIVATE 로 올린다 (§4.8). */
  visibility: 'PRIVATE' | 'UNLISTED' | 'PUBLIC';
  credentialRef: string | null;
  durationMs: number | null;
  subtitleKey?: string | null;
}

export interface UploadResult {
  id: string;
  url: string;
  raw?: Record<string, unknown>;
}

/**
 * §8.2 SNS 플랫폼 어댑터 계약.
 * 실제 플랫폼 연동 전에 확인해야 할 항목은 docs/integrations/{platform}.md 에 기록한다.
 * 특히 비공개 업로드 지원 여부는 V1 설계의 전제다.
 */
export interface ChannelAdapter {
  readonly platform: Platform;
  /** 비공개 업로드를 지원하지 않는 플랫폼은 false. 업로드 전에 검사한다. */
  readonly supportsPrivateUpload: boolean;
  upload(req: UploadRequest): Promise<UploadResult>;
}
