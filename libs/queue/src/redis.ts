import IORedis, { Redis } from 'ioredis';
import { config } from '@cf/common';

let connection: Redis | null = null;

/** BullMQ 는 maxRetriesPerRequest: null 을 요구한다. */
export function getRedis(): Redis {
  if (!connection) {
    connection = new IORedis(config.redis.url, { maxRetriesPerRequest: null, enableReadyCheck: false });
  }
  return connection;
}

export function newRedis(): Redis {
  return new IORedis(config.redis.url, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

export async function closeRedis(): Promise<void> {
  if (connection) {
    await connection.quit().catch(() => undefined);
    connection = null;
  }
}

/**
 * §3.5 Orchestrator 단일 실행 보장용 분산 락 (SET NX PX).
 * 획득하면 해제 함수를 돌려주고, 실패하면 null 을 돌려준다.
 */
export async function acquireLock(key: string, ttlMs: number): Promise<(() => Promise<void>) | null> {
  const redis = getRedis();
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ok = await redis.set(`lock:${key}`, token, 'PX', ttlMs, 'NX');
  if (ok !== 'OK') return null;
  return async () => {
    // 내 토큰일 때만 해제한다. 만료 후 남의 락을 지우지 않기 위함이다.
    await redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
      1, `lock:${key}`, token,
    );
  };
}
