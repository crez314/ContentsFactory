import 'reflect-metadata';
process.env.SERVICE_NAME ??= 'api';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import { assertProductionSafety, config, createLogger, installCrashGuard, onShutdown } from '@cf/common';
import { getRedis } from '@cf/queue';
import { AppModule } from './app.module';

const log = createLogger('bootstrap');

async function bootstrap(): Promise<void> {
  installCrashGuard('api');
  assertProductionSafety();

  const app = await NestFactory.create(AppModule, { bufferLogs: false, cors: true });
  app.setGlobalPrefix('v1');
  // 로컬 스토리지 업로드는 원본 바디를 직접 읽으므로 /v1/files 는 파서를 우회한다.
  app.use((req: { path: string }, res: unknown, next: () => void) =>
    req.path.startsWith('/v1/files') ? next() : json({ limit: '5mb' })(req as never, res as never, next));
  app.use(urlencoded({ extended: true }));

  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('CREZ Content Factory API')
      .setDescription('PART 4 개발 명세서 v1.0 기준 API')
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, doc);

  // 대시보드 시스템 상태 패널이 읽는 하트비트
  const redis = getRedis();
  const beat = setInterval(() => {
    void redis.hset('cf:heartbeat', 'api', new Date().toISOString());
  }, 10_000);
  beat.unref();

  await app.listen(config.ports.api, '0.0.0.0');
  log.info('api listening', { port: config.ports.api, env: config.env, docs: `http://localhost:${config.ports.api}/docs` });

  // 진행 중인 요청을 마무리하고 나간다. 종료 경로는 onShutdown 하나로 통일한다.
  onShutdown('api', async () => {
    clearInterval(beat);
    await app.close();
  });
}

void bootstrap().catch((err) => {
  log.error('api bootstrap failed', { err });
  process.exit(1);
});
