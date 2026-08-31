import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createLogger } from '@cf/common';

export type AlertLevel = 'INFO' | 'WARN' | 'CRITICAL';

export interface AlertRecord {
  id: string;
  level: AlertLevel;
  code: string;
  detail: Record<string, unknown>;
  at: string;
}

/**
 * §9.3 알림.
 * 운영에서는 Slack Webhook 을 붙이지만, 로컬에서는 구조화 로그 + 인메모리 링버퍼로 대체한다.
 * 백오피스 「주의 필요」 패널이 이 버퍼를 읽는다.
 */
@Injectable()
export class NotifierService {
  private readonly log = createLogger('notifier');
  private static readonly buffer: AlertRecord[] = [];
  private static readonly MAX = 200;

  constructor(private readonly ds?: DataSource) {}

  private push(level: AlertLevel, code: string, detail: Record<string, unknown>): void {
    const rec: AlertRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      level, code, detail, at: new Date().toISOString(),
    };
    NotifierService.buffer.unshift(rec);
    if (NotifierService.buffer.length > NotifierService.MAX) NotifierService.buffer.pop();
  }

  async info(code: string, detail: Record<string, unknown> = {}): Promise<void> {
    this.push('INFO', code, detail);
    this.log.info(`alert:${code}`, detail);
  }
  async warn(code: string, detail: Record<string, unknown> = {}): Promise<void> {
    this.push('WARN', code, detail);
    this.log.warn(`alert:${code}`, detail);
  }
  async alert(code: string, detail: Record<string, unknown> = {}): Promise<void> {
    this.push('CRITICAL', code, detail);
    this.log.error(`alert:${code}`, detail);
  }
  /** §3.4 에스컬레이션 — 백오피스 + Slack */
  async escalate(code: string, detail: Record<string, unknown> = {}): Promise<void> {
    this.push('CRITICAL', code, detail);
    this.log.error(`escalation:${code}`, detail);
  }

  recent(limit = 50): AlertRecord[] {
    return NotifierService.buffer.slice(0, limit);
  }
}
