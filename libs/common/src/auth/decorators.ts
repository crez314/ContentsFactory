import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role, AuthUser } from './roles';

export const MIN_ROLE_KEY = 'minRole';
export const REVIEW_ONLY_KEY = 'reviewOnly';
export const PUBLIC_KEY = 'isPublic';
export const AUDIT_KEY = 'auditAction';

/** 최소 역할 요구 (§6.2 랭크 비교) */
export const MinRole = (role: Role) => SetMetadata(MIN_ROLE_KEY, role);
/** 승인 계열 전용 — REVIEWER/ADMIN/SUPER_ROOT 만 통과 */
export const ReviewOnly = () => SetMetadata(REVIEW_ONLY_KEY, true);
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** §9.2 감사 로그 대상 표시 */
export const Audit = (action: string, targetType: string) => SetMetadata(AUDIT_KEY, { action, targetType });

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
