import 'reflect-metadata';
process.env.SERVICE_NAME ??= 'worker';

import { NestFactory } from '@nestjs/core';
import { assertProductionSafety, config, createLogger } from '@cf/common';
import { WorkerModule } from './worker.module';

const log = createLogger('bootstrap');

async function bootstrap(): Promise<void> {
  assertProductionSafety();
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: false });
  app.enableShutdownHooks();
  log.info('worker started', { env: config.env, adapters: config.adapters.mode });

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      log.info('shutting down', { signal: sig });
      void app.close().then(() => process.exit(0));
    });
  }
}

void bootstrap().catch((err) => {
  log.error('worker bootstrap failed', { err });
  process.exit(1);
});
