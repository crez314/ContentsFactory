import { ulid } from 'ulid';
import { createHash, randomUUID } from 'crypto';

export { ulid, randomUUID };

export const requestId = (): string => `req_${ulid()}`;

export const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex');

/** §3.5 멱등키 형식: {kind}:{contentId|orderId}:{sceneId?}:{attempt} */
export function idempotencyKey(parts: {
  kind: string;
  orderId?: string | null;
  contentId?: string | null;
  sceneId?: string | null;
  attempt: number;
}): string {
  const target = parts.contentId ?? parts.orderId ?? 'none';
  return [parts.kind, target, parts.sceneId ?? '-', String(parts.attempt)].join(':');
}
