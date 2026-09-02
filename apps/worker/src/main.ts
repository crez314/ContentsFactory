import 'reflect-metadata';
process.env.SERVICE_NAME ??= 'worker';

import { NestFactory } from '@nestjs/core';
import { assertProductionSafety, config, createLogger, installCrashGuard, onShutdown } from '@cf/common';
import { WorkerModule } from './worker.module';

const log = createLogger('bootstrap');

async function bootstrap(): Promise<void> {
  installCrashGuard('worker');
  assertProductionSafety();
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: false });
  log.info('worker started', { env: config.env, adapters: config.adapters.mode });

  onShutdown('worker', () => app.close());
}

void bootstrap().catch((err) => {
  log.error('worker bootstrap failed', { err });
  process.exit(1);
});
