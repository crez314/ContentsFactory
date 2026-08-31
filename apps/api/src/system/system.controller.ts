import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import type { Request } from 'express';
import { SystemFlag } from '@cf/domain';
import { CurrentUser, MinRole, Public, config, createLogger, type AuthUser } from '@cf/common';
import { ALL_WORK_QUEUES, getRedis } from '@cf/queue';
import { AuditService } from '../common/audit.service';

const EMERGENCY_STOP = 'emergency_stop';

@ApiTags('system')
@Controller('system')
export class SystemController {
  private readonly log = createLogger('system');

  constructor(private readonly ds: DataSource, private readonly audit: AuditService) {}

  @Public()
  @Get('health')
  health() {
    return { ok: true, service: config.serviceName, env: config.env, at: new Date().toISOString() };
  }

  @Get('flags')
  async flags() {
    return this.ds.getRepository(SystemFlag).find();
  }

  /**
   * 전체 정지 — 모든 작업 큐를 일시정지한다.
   * 이미 실행 중인 Job 은 끝까지 가지만 새 Job 은 집히지 않는다.
   */
  @Post('emergency-stop')
  @MinRole('SUPER_ROOT')
  @ApiOperation({ summary: '전체 정지 / 해제' })
  async emergencyStop(
    @Body() body: { active?: boolean; reason?: string },
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const active = body?.active ?? true;
    const redis = getRedis();

    for (const name of ALL_WORK_QUEUES) {
      const q = new Queue(name, { connection: redis, prefix: config.redis.queuePrefix });
      active ? await q.pause() : await q.resume();
      await q.close();
    }

    const repo = this.ds.getRepository(SystemFlag);
    const before = await repo.findOne({ where: { key: EMERGENCY_STOP } });
    await repo.save({
      key: EMERGENCY_STOP,
      value: { active, reason: body?.reason ?? null, at: new Date().toISOString() },
      updatedBy: actor.id,
    });

    await this.audit.record({
      actor, action: active ? 'EMERGENCY_STOP' : 'EMERGENCY_RESUME',
      targetType: 'system', targetId: null, before: before?.value, after: { active }, ip: req.ip,
    });
    this.log.error('emergency stop toggled', { active, actor: actor.email, reason: body?.reason });
    return { active, queues: ALL_WORK_QUEUES };
  }

  /** §9.2 감사 로그 열람은 SUPER_ROOT 전용 */
  @Get('audit-logs')
  @MinRole('SUPER_ROOT')
  auditLogs() {
    return this.ds.query(
      `SELECT a.*, u.email AS actor_email, u.name AS actor_name
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
        ORDER BY a.created_at DESC LIMIT 200`,
    );
  }
}
