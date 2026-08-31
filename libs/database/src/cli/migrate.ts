import { runMigrations, waitForDatabase } from '../migrator';
import { createLogger } from '@cf/common';

const log = createLogger('migrate-cli');

void (async () => {
  await waitForDatabase();
  const { applied, skipped } = await runMigrations();
  log.info('migrations complete', { applied, skippedCount: skipped.length });
  process.exit(0);
})().catch((err) => {
  log.error('migration run failed', { err });
  process.exit(1);
});
