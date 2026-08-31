import * as fs from 'fs/promises';
import * as path from 'path';
import { Client } from 'pg';
import { config, createLogger } from '@cf/common';

const log = createLogger('migrator');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * SQL 파일 기반 마이그레이션 (§1.1 "마이그레이션은 SQL 파일로 관리").
 * 파일명 타임스탬프 순으로 한 번씩만 적용하고 schema_migrations 에 기록한다.
 */
export async function runMigrations(): Promise<{ applied: string[]; skipped: string[] }> {
  const client = new Client({ connectionString: config.db.url });
  await client.connect();
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        varchar(200) PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )`);

    const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((r: { name: string }) => r.name));

    for (const file of files) {
      if (done.has(file)) {
        skipped.push(file);
        continue;
      }
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
        log.info('migration applied', { file });
      } catch (err) {
        await client.query('ROLLBACK');
        log.error('migration failed', { file, err });
        throw err;
      }
    }
  } finally {
    await client.end();
  }
  return { applied, skipped };
}

/** 로컬 개발 편의: 컨테이너가 뜰 때까지 기다린다. */
export async function waitForDatabase(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const client = new Client({ connectionString: config.db.url });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (err) {
      await client.end().catch(() => undefined);
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
