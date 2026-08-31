// Express Request 에 요청 추적 ID 를 얹는다 (§5.1 X-Request-Id).
declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}
export {};
