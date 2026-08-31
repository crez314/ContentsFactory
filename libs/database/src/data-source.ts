import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from '@cf/domain';
import { config } from '@cf/common';

/**
 * 스키마는 SQL 마이그레이션 파일이 단일 출처다 (§2.2).
 * synchronize 는 어떤 환경에서도 켜지 않는다.
 */
export const dataSource = new DataSource({
  type: 'postgres',
  url: config.db.url,
  entities: ALL_ENTITIES,
  synchronize: false,
  logging: config.logLevel === 'debug' ? ['query', 'error'] : ['error'],
  extra: { max: config.db.poolMax },
});

let initialized: Promise<DataSource> | null = null;

export function getDataSource(): Promise<DataSource> {
  if (!initialized) {
    initialized = dataSource.isInitialized ? Promise.resolve(dataSource) : dataSource.initialize();
  }
  return initialized;
}

export async function closeDataSource(): Promise<void> {
  if (dataSource.isInitialized) await dataSource.destroy();
  initialized = null;
}
