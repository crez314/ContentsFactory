import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditLog } from '@cf/domain';
import type { AuthUser } from '@cf/common';

/**
 * §9.2 감사 로그 — 승인·반려·게시·권한 변경·라이선스 변경은 전건 기록한다.
 */
@Injectable()
export class AuditService {
  constructor(private readonly ds: DataSource) {}

  async record(args: {
    actor?: AuthUser | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    before?: unknown;
    after?: unknown;
    ip?: string | null;
  }): Promise<void> {
    const repo = this.ds.getRepository(AuditLog);
    // insert() 의 QueryDeepPartialEntity 는 nullable jsonb 를 표현하지 못하므로 save() 를 쓴다.
    await repo.save(
      repo.create({
        actorId: args.actor?.id ?? null,
        action: args.action,
        targetType: args.targetType,
        targetId: args.targetId ?? null,
        before: args.before ?? null,
        after: args.after ?? null,
        ip: args.ip ?? null,
      }),
    );
  }
}
