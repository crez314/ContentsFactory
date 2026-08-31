-- order_no 채번을 원자적으로 만든다.
--
-- 기존 구현은 "같은 날짜 접두사로 COUNT 한 뒤 +1" 이었는데,
-- 동시 오더 제출 시 여러 트랜잭션이 같은 COUNT 를 읽어 같은 번호를 만들고
-- orders_order_no_key 유니크 제약에 걸린다. (§9.1 동시 처리 오더 10건 요구사항에서 재현됨)
--
-- 날짜별 카운터를 UPSERT ... RETURNING 으로 증가시키면 한 번의 원자적 연산으로 끝난다.
CREATE TABLE order_no_counters (
  day        date PRIMARY KEY,
  seq        int  NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 이미 발급된 번호가 있으면 이어서 채번하도록 초기값을 맞춘다.
INSERT INTO order_no_counters (day, seq)
SELECT to_date(split_part(order_no, '-', 2), 'YYYYMMDD') AS day, COUNT(*)::int
  FROM orders
 WHERE order_no LIKE 'ORD-%'
 GROUP BY 1
ON CONFLICT (day) DO NOTHING;
