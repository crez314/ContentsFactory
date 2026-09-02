import 'reflect-metadata';
process.env.SERVICE_NAME ??= 'orchestrator';

import { NestFactory } from '@nestjs/core';
import { assertProductionSafety, config, createLogger, installCrashGuard, onShutdown } from '@cf/common';
import { OrchestratorModule } from './orchestrator.module';

const log = createLogger('bootstrap');

async function bootstrap(): Promise<void> {
  installCrashGuard('orchestrator');
  assertProductionSafety();
  const app = await NestFactory.createApplicationContext(OrchestratorModule, { bufferLogs: false });
  log.info('orchestrator started', { env: config.env });

  onShutdown('orchestrator', () => app.close());
}

void bootstrap().catch((err) => {
  log.error('orchestrator bootstrap failed', { err });
  process.exit(1);
});
