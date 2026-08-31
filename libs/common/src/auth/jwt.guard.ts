import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { config } from '../config/config';
import { AppError } from '../errors/app-error';
import { PUBLIC_KEY } from './decorators';
import type { AuthUser } from './roles';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header = req.headers['authorization'] as string | undefined;
    if (!header?.startsWith('Bearer ')) throw new AppError('AUTH_TOKEN_EXPIRED', { message: '인증 토큰이 없습니다.' });

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; email: string; name: string; role: AuthUser['role'] }>(
        header.slice(7),
        { secret: config.auth.accessSecret },
      );
      req.user = { id: payload.sub, email: payload.email, name: payload.name, role: payload.role } satisfies AuthUser;
      return true;
    } catch {
      throw new AppError('AUTH_TOKEN_EXPIRED');
    }
  }
}
