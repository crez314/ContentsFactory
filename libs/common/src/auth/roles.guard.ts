import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../errors/app-error';
import { MIN_ROLE_KEY, REVIEW_ONLY_KEY, PUBLIC_KEY } from './decorators';
import { AuthUser, Role, canReview, hasMinRole } from './roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) throw new AppError('AUTH_TOKEN_EXPIRED');

    const reviewOnly = this.reflector.getAllAndOverride<boolean>(REVIEW_ONLY_KEY, targets);
    if (reviewOnly && !canReview(user.role)) {
      throw new AppError('AUTH_FORBIDDEN', { details: [{ required: 'REVIEWER', actual: user.role }] });
    }

    const required = this.reflector.getAllAndOverride<Role>(MIN_ROLE_KEY, targets);
    if (required && !hasMinRole(user.role, required)) {
      throw new AppError('AUTH_FORBIDDEN', { details: [{ required, actual: user.role }] });
    }
    return true;
  }
}
