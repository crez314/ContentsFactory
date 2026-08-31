import { config } from '../config/config';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

/** §9.3 구조화 로그 필수 필드 */
export interface LogContext {
  requestId?: string;
  taskId?: string;
  orderId?: string;
  contentId?: string;
  sceneId?: string;
  kind?: string;
  provider?: string;
  durationMs?: number;
  costKrw?: number;
  [k: string]: unknown;
}

export class Logger {
  constructor(
    private readonly scope: string,
    private readonly base: LogContext = {},
  ) {}

  child(ctx: LogContext): Logger {
    return new Logger(this.scope, { ...this.base, ...ctx });
  }

  debug(msg: string, ctx?: LogContext): void { this.write('debug', msg, ctx); }
  info(msg: string, ctx?: LogContext): void { this.write('info', msg, ctx); }
  warn(msg: string, ctx?: LogContext): void { this.write('warn', msg, ctx); }
  error(msg: string, ctx?: LogContext): void { this.write('error', msg, ctx); }

  private write(level: LogLevel, msg: string, ctx?: LogContext): void {
    if (LEVELS[level] < LEVELS[config.logLevel]) return;
    const err = ctx?.err;
    const line = {
      ts: new Date().toISOString(),
      level,
      service: config.serviceName,
      scope: this.scope,
      ...this.base,
      ...ctx,
      ...(err instanceof Error ? { err: { name: err.name, message: err.message, stack: err.stack } } : {}),
      msg,
    };
    const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    out.write(JSON.stringify(line) + '\n');
  }
}

export const rootLogger = new Logger('root');
export const createLogger = (scope: string, ctx: LogContext = {}): Logger => new Logger(scope, ctx);
