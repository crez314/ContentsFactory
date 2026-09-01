import 'reflect-metadata';
process.env.SERVICE_NAME ??= 'orchestrator';

import { NestFactory } from '@nestjs/core';
import { assertProductionSafety, config, createLogger, installCrashGuard } from '@cf/common';
import { OrchestratorModule } from './orchestrator.module';

const log = createLogger('bootstrap');

async function bootstrap(): Promise<void> {
  installCrashGuard('orchestrator');
  assertProductionSafety();
  const app = await NestFactory.createApplicationContext(OrchestratorModule, { bufferLogs: false });
  app.enableShutdownHooks();
  log.info('orchestrator started', { env: config.env });

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      log.info('shutting down', { signal: sig });
      void app.close().then(() => process.exit(0));
    });
  }
}

void bootstrap().catch((err) => {
  log.error('orchestrator bootstrap failed', { err });
  process.exit(1);
});
