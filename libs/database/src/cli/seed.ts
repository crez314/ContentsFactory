import { createLogger } from '@cf/common';
import { closeDataSource, getDataSource } from '../data-source';
import { seed, SEED_CREDENTIALS } from '../seed';

const log = createLogger('seed-cli');

void (async () => {
  const ds = await getDataSource();
  await seed(ds);
  await closeDataSource();
  log.info('seed complete', {
    password: SEED_CREDENTIALS.password,
    accounts: SEED_CREDENTIALS.users.map((u) => `${u.email} (${u.role})`),
  });
  process.exit(0);
})().catch((err) => {
  log.error('seed failed', { err });
  process.exit(1);
});
