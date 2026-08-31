import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { getRedis } from '@cf/queue';

/** 대시보드 시스템 상태 패널이 읽는 워커 하트비트 */
@Injectable()
export class HeartbeatService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  onModuleInit(): void {
    const beat = (): void => {
      void getRedis().hset('cf:heartbeat', 'worker', new Date().toISOString());
    };
    beat();
    this.timer = setInterval(beat, 10_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
