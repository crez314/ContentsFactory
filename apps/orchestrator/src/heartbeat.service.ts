import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { config, createLogger } from '@cf/common';
import { acquireLock, getRedis } from '@cf/queue';

/**
 * §1.2 Orchestrator 는 단일 인스턴스로 운영하되 Redis 분산 락으로 중복 실행을 방지한다.
 * 락은 주기적으로 갱신하고, 잃으면 이 프로세스는 대기 모드로 남는다.
 */
@Injectable()
export class HeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly log = createLogger('heartbeat');
  private timer?: NodeJS.Timeout;
  private release?: () => Promise<void>;

  async onModuleInit(): Promise<void> {
    this.release = (await acquireLock('orchestrator:leader', 30_000)) ?? undefined;
    if (this.release) this.log.info('acquired orchestrator leadership');
    else this.log.warn('another orchestrator holds leadership; running in standby');

    this.timer = setInterval(() => {
      void getRedis().hset('cf:heartbeat', 'orchestrator', new Date().toISOString());
      // 리더십 갱신 (TTL 연장)
      void getRedis().pexpire('lock:orchestrator:leader', 30_000);
    }, 10_000);
    this.timer.unref();
    void getRedis().hset('cf:heartbeat', 'orchestrator', new Date().toISOString());
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.release?.().catch(() => undefined);
  }
}
