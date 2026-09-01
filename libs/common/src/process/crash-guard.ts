import { createLogger } from '../logger/logger';

const log = createLogger('crash-guard');

/** graceful shutdown 유예. ECS 기본 stopTimeout(30초)보다 짧게 둔다. */
const SHUTDOWN_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS ?? 10_000);

/**
 * 프로세스가 죽을 때 이유를 남긴다.
 *
 * 개발 중 API 프로세스가 스택 한 줄 없이 사라진 적이 있어 원인을 특정하지 못했다.
 * Node 는 처리되지 않은 거부·예외를 stderr 로 뱉지만 형식이 우리 로그와 달라 수집기에서 놓치기 쉽고,
 * 시그널 종료는 아무것도 남기지 않는다. 두 경우 모두 구조화 로그로 찍어둔다.
 *
 * 종료를 막지는 않는다 — 상태가 깨진 프로세스를 살려두는 편이 더 위험하다.
 * ECS 가 재기동하고, 진행 중이던 Task 는 상태 테이블에서 복구된다 (§1.2).
 */
export function installCrashGuard(service: string): void {
  process.on('uncaughtException', (err, origin) => {
    log.error('uncaught exception — 프로세스를 종료한다', { service, origin, err });
    // 로그가 flush 될 시간을 주고 종료한다.
    setTimeout(() => process.exit(1), 100).unref();
  });

  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection — 프로세스를 종료한다', {
      service,
      err: reason instanceof Error ? reason : new Error(String(reason)),
    });
    setTimeout(() => process.exit(1), 100).unref();
  });

  /**
   * SIGKILL 은 잡을 수 없지만, 나머지는 누가 왜 죽였는지 남길 수 있다.
   *
   * 주의 — 시그널 리스너를 등록하는 순간 Node 의 기본 종료 동작이 사라진다.
   * 로그만 찍고 끝내면 프로세스가 SIGTERM 을 받고도 살아남아,
   * ECS 가 유예 시간 뒤 SIGKILL 로 강제 종료하게 된다 (진행 중 작업이 유실된다).
   * 그래서 여기서 반드시 종료를 이어받는다.
   *
   * 각 서비스의 graceful shutdown(app.close())이 먼저 끝나도록 유예를 주고,
   * 그 안에 스스로 나가지 않으면 강제로 종료한다.
   */
  let shuttingDown = false;
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT'] as const) {
    process.on(sig, () => {
      if (shuttingDown) {
        // 두 번째 시그널은 즉시 종료 요청으로 본다.
        log.warn('signal received again — 즉시 종료한다', { service, signal: sig });
        process.exit(130);
      }
      shuttingDown = true;
      log.warn('signal received — 종료 절차 시작', {
        service, signal: sig, uptimeSec: Math.round(process.uptime()), graceMs: SHUTDOWN_GRACE_MS,
      });
      const forced = setTimeout(() => {
        log.error('graceful shutdown 이 유예 시간 내에 끝나지 않아 강제 종료한다', { service, signal: sig });
        process.exit(1);
      }, SHUTDOWN_GRACE_MS);
      // 다른 핸들러가 먼저 정리를 끝내고 나가면 이 타이머가 프로세스를 붙잡지 않아야 한다.
      forced.unref();
    });
  }

  process.on('exit', (code) => {
    // exit 핸들러에서는 비동기 작업이 불가능하므로 동기 기록만 남긴다.
    if (code !== 0) {
      process.stderr.write(
        JSON.stringify({
          ts: new Date().toISOString(), level: 'error', service, scope: 'crash-guard',
          code, uptimeSec: Math.round(process.uptime()),
          heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          msg: 'process exiting with non-zero code',
        }) + '\n',
      );
    }
  });

  // 힙 사용량을 주기적으로 남겨 OOM 직전 추이를 볼 수 있게 한다.
  const timer = setInterval(() => {
    const m = process.memoryUsage();
    log.debug('memory', {
      service,
      heapUsedMb: Math.round(m.heapUsed / 1024 / 1024),
      rssMb: Math.round(m.rss / 1024 / 1024),
    });
  }, 60_000);
  timer.unref();
}
