import { Injectable } from '@nestjs/common';
import { config } from '@cf/common';
import type { ObjectHead, StorageDriver } from './contracts';
import { LocalStorageDriver } from './drivers/local.driver';
import { S3StorageDriver } from './drivers/s3.driver';

let singleton: StorageDriver | null = null;

export function createStorageDriver(): StorageDriver {
  if (singleton) return singleton;
  singleton =
    config.storage.driver === 's3'
      ? new S3StorageDriver({ bucket: config.storage.bucket, region: config.storage.region })
      : new LocalStorageDriver();
  return singleton;
}

@Injectable()
export class StorageService {
  readonly driver: StorageDriver = createStorageDriver();

  presignPut(key: string, contentType: string, ttlSec = config.storage.presignTtlSec): Promise<string> {
    return this.driver.presignPut(key, contentType, ttlSec);
  }
  presignGet(key: string, ttlSec = config.storage.presignTtlSec): Promise<string> {
    return this.driver.presignGet(key, ttlSec);
  }
  head(key: string): Promise<ObjectHead | null> { return this.driver.head(key); }
  put(key: string, body: Buffer, contentType: string): Promise<void> { return this.driver.put(key, body, contentType); }
  get(key: string): Promise<Buffer> { return this.driver.get(key); }
  materialize(key: string): Promise<string> { return this.driver.materialize(key); }
  copy(from: string, to: string): Promise<void> { return this.driver.copy(from, to); }
  exists(key: string): Promise<boolean> { return this.driver.exists(key); }
}
