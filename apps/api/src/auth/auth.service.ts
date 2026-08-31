import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '@cf/domain';
import { AppError, config, createLogger, ulid, type AuthUser } from '@cf/common';
import { getRedis } from '@cf/queue';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

/**
 * §6.1 인증.
 * - Access JWT 30분 / Refresh 14일, Refresh 는 회전 발급 (사용 즉시 폐기 후 재발급)
 * - Refresh 는 Redis 에 저장한다. 로그아웃은 Refresh 폐기이며 Access 는 만료까지 유효하다.
 * - 5회 실패 시 15분 잠금
 */
@Injectable()
export class AuthService {
  private readonly log = createLogger('auth');

  constructor(
    private readonly ds: DataSource,
    private readonly jwt: JwtService,
  ) {}

  private failKey = (email: string): string => `login:fail:${email.toLowerCase()}`;
  private refreshKey = (jti: string): string => `refresh:${jti}`;

  async login(email: string, password: string): Promise<TokenPair> {
    const redis = getRedis();
    const fails = Number((await redis.get(this.failKey(email))) ?? 0);
    if (fails >= config.auth.loginMaxFailures) {
      throw new AppError('AUTH_ACCOUNT_LOCKED', {
        details: [{ retryAfterSec: await redis.ttl(this.failKey(email)) }],
      });
    }

    const user = await this.ds.getRepository(User).findOne({ where: { email: email.toLowerCase() } });
    const ok = user?.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false;

    if (!user || !ok || user.status !== 'ACTIVE') {
      const next = await redis.incr(this.failKey(email));
      if (next === 1) await redis.expire(this.failKey(email), config.auth.loginLockSeconds);
      this.log.warn('login failed', { email, attempt: next });
      throw new AppError('AUTH_INVALID_CREDENTIALS');
    }

    await redis.del(this.failKey(email));
    await this.ds.getRepository(User).update(user.id, { lastLoginAt: new Date() });
    return this.issue(user);
  }

  private async issue(user: User): Promise<TokenPair> {
    const authUser: AuthUser = { id: user.id, email: user.email, name: user.name, role: user.role };
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, name: user.name, role: user.role },
      { secret: config.auth.accessSecret, expiresIn: config.auth.accessTtl },
    );

    const jti = ulid();
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti },
      { secret: config.auth.refreshSecret, expiresIn: config.auth.refreshTtl },
    );
    await getRedis().set(this.refreshKey(jti), user.id, 'EX', config.auth.refreshTtl);

    return { accessToken, refreshToken, expiresIn: config.auth.accessTtl, user: authUser };
  }

  /** 회전 발급 — 제시된 refresh 는 즉시 폐기한다. 재사용은 거부된다. */
  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: { sub: string; jti: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, { secret: config.auth.refreshSecret });
    } catch {
      throw new AppError('AUTH_TOKEN_EXPIRED', { message: '리프레시 토큰이 유효하지 않습니다.' });
    }

    const redis = getRedis();
    const stored = await redis.getdel(this.refreshKey(payload.jti));
    if (!stored || stored !== payload.sub) {
      throw new AppError('AUTH_TOKEN_EXPIRED', { message: '이미 사용되었거나 폐기된 리프레시 토큰입니다.' });
    }

    const user = await this.ds.getRepository(User).findOne({ where: { id: payload.sub } });
    if (!user || user.status !== 'ACTIVE') throw new AppError('AUTH_FORBIDDEN');
    return this.issue(user);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    try {
      const payload = await this.jwt.verifyAsync<{ jti: string }>(refreshToken, { secret: config.auth.refreshSecret });
      await getRedis().del(this.refreshKey(payload.jti));
    } catch {
      // 이미 만료된 토큰이면 폐기할 것도 없다.
    }
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.ds.getRepository(User).findOne({ where: { id: userId } });
    if (!user) throw new AppError('AUTH_FORBIDDEN');
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }
}
