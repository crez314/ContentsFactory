import type { ObjectHead, StorageDriver } from '../contracts';

/**
 * S3 드라이버 자리.
 * AWS 계정이 준비되면 @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner 를 설치하고
 * 아래 메서드를 구현한다. 계약이 동일하므로 나머지 코드는 손대지 않는다.
 *
 *   presignPut  -> getSignedUrl(client, new PutObjectCommand({...}), { expiresIn })
 *   presignGet  -> getSignedUrl(client, new GetObjectCommand({...}), { expiresIn })
 *   materialize -> 임시 디렉터리로 다운로드 후 경로 반환 (ffmpeg 등 외부 프로세스용)
 */
export class S3StorageDriver implements StorageDriver {
  readonly name = 's3' as const;
  constructor(private readonly opts: { bucket: string; region: string }) {}

  private notImplemented(): never {
    throw new Error(
      `S3StorageDriver is not wired yet (bucket=${this.opts.bucket}, region=${this.opts.region}). ` +
        'Install @aws-sdk/client-s3 and implement libs/storage/src/drivers/s3.driver.ts.',
    );
  }

  async presignPut(): Promise<string> { this.notImplemented(); }
  async presignGet(): Promise<string> { this.notImplemented(); }
  async head(): Promise<ObjectHead | null> { this.notImplemented(); }
  async put(): Promise<void> { this.notImplemented(); }
  async get(): Promise<Buffer> { this.notImplemented(); }
  async materialize(): Promise<string> { this.notImplemented(); }
  async copy(): Promise<void> { this.notImplemented(); }
  async delete(): Promise<void> { this.notImplemented(); }
  async exists(): Promise<boolean> { this.notImplemented(); }
}
