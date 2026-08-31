# 아키텍처 메모 — 명세와 다르게 간 지점

명세(PART 4 v1.0)를 따르되 구현 중 판단이 필요했던 지점과 그 근거를 남긴다.
나중에 "왜 이렇게 했지"를 다시 묻지 않기 위한 문서다.

## 1. `libs/orchestration` 을 추가했다

**명세** §1.3 의 libs 목록: `domain, database, queue, model-abstraction, storage, contracts, common`

**구현** 여기에 `orchestration` 을 하나 더 두고 `TaskFactory`, `ApprovalService`, `OrchestratorService` 를 넣었다.

**이유** §3.3 의 오케스트레이터 코드가 `this.approvalService.decide(...)` 를 호출한다.
그런데 승인은 백오피스에서도 수동으로 일어나므로 API 도 같은 서비스가 필요하다.
Task 생성 역시 오더 제출(API)과 후속 단계 생성(오케스트레이터) 양쪽에서 일어난다.

선택지는 셋이었다.

1. 앱 간 교차 import (`apps/orchestrator` → `apps/api/src/...`) — §1.3 의 단방향 의존 규칙을 깬다.
2. 양쪽에 각각 구현 — 승인 규칙이 두 곳에 생겨 시간이 지나면 갈라진다.
3. libs 로 올린다 — 의존 방향(`apps/* → libs/*`)을 지키고 구현이 하나로 유지된다.

3번을 택했다. 순수 판정 로직(`shouldAutoApprove`, `violatesFourEyes`)은 여전히 `libs/domain` 에 있고,
`libs/orchestration` 은 DB·큐가 필요한 조립부만 담는다.

## 2. 워커 → 오케스트레이터 통지에 큐를 하나 더 썼다

**명세** §3.2 "워커는 다음 단계 큐에 직접 넣지 않는다. 결과를 DB 에 기록하고 Task 를 DONE 으로
전이시키면, Orchestrator 가 후속 Task 를 생성한다."

**구현** 워커가 Task 를 DONE 으로 쓴 뒤 `q.orchestrate` 에 완료 통지를 넣는다.
오케스트레이터는 이 큐만 소비한다.

**이유** 명세는 "오케스트레이터가 안다"고만 하고 전달 방법을 정하지 않았다.
DB 폴링은 지연과 부하가 생기고, 워커가 오케스트레이터를 직접 호출하면 결합이 생긴다.
전용 큐를 쓰면 워커는 여전히 다음 **작업** 큐를 모르고(원칙 유지), 통지는 즉시 전달되며,
오케스트레이터가 죽어도 통지가 큐에 남아 재기동 후 이어서 처리된다.

## 3. Task 되살리기 (`revived_by_orchestrator`)

§3.5 의 멱등키는 같은 작업이 두 번 만들어지는 것을 막는다.
그런데 그대로 구현하면 **한 번 실패해 ESCALATED 된 Task 의 멱등키가 영원히 점유**되어,
같은 단계를 다시 시도해야 할 때 `createTask` 가 죽은 Task 를 그대로 돌려주고 큐에는 아무것도 들어가지 않는다.
결과적으로 오더가 `RENDERING` 같은 중간 상태에서 멈춘다. 실제로 개발 중 이 증상을 만났다.

그래서 `createTask` 는 기존 Task 의 상태를 보고 갈라진다.

- `DONE` → 그대로 반환 (재실행하지 않는다)
- `QUEUED / RUNNING / RETRY / FALLBACK` → 그대로 반환 (중복 투입 방지)
- `FAILED / ESCALATED / CANCELLED` → `QUEUED` 로 되살리고 다시 큐에 넣는다

세 번째 경우는 `task_events` 에 `revived_by_orchestrator` 로 남아 이력에서 구분된다.

## 4. BullMQ jobId 에서 멱등키 구분자를 바꾼다

멱등키 형식은 §3.5 대로 `{kind}:{target}:{scene}:{attempt}` 인데, BullMQ 는 jobId 에 `:` 를 허용하지 않는다.
DB 에는 명세 그대로 저장하고, 큐에 넣을 때만 `:` → `~` 로 치환한다.

## 5. 오더 제출 순서를 뒤집었다

Task 생성을 먼저 하고 그다음에 오더를 `QUEUED` 로 올린다.
반대 순서로 하면 큐 투입이 실패했을 때 상태만 `QUEUED` 로 남아 오더가 영원히 멈춘 것처럼 보인다.
큐 투입이 실패하면 오더를 `DRAFT` 로 되돌리고 에러를 올린다.

## 6. `asset_usages` 유니크 제약을 부분 인덱스로 바꿨다

**명세** `UNIQUE (content_id, asset_id, scene_id)`

**구현** `scene_id IS NOT NULL` 인 경우와 `NULL` 인 경우로 나눈 부분 유니크 인덱스 두 개.

**이유** PostgreSQL 에서 `NULL` 은 유니크 제약에 걸리지 않는다.
이미지 트랙은 `scene_id` 가 `NULL` 이므로 명세 그대로 두면 같은 (콘텐츠, 자산) 계보가 중복 삽입된다.
계보는 V2 성과 역추적의 전제라 중복이 들어가면 배분 비율이 틀어진다.

## 7. `orders.agent_id` 를 추가했다

명세 §2.2 의 `orders` 에는 에이전트 참조가 없는데, §4.7 의 승인 판정과 §4.2 의 9번 검증
(에이전트 일일 잔여 예산)은 "이 오더의 에이전트"를 필요로 한다.
`orders.agent_id` 를 nullable 로 추가하고, 없으면 오더 자체의 `approval_level` 을 쓴다.

## 8. QC `retryTarget` → 재실행 모듈 매핑

§3.3 은 `this.moduleFor(qc.retryTarget)` 이라고만 쓰여 있고 매핑표는 없다. 다음과 같이 정했다.

| retryTarget | 이미지 | 영상 | 근거 |
| --- | --- | --- | --- |
| `identity`, `quality` | GENERATE_IMAGE | GENERATE_VIDEO | 생성물 자체를 다시 만들어야 한다 |
| `brand`, `aiRisk` | GENERATE_IMAGE | RENDER | 자막·카피·색상은 렌더 단계에서 바뀐다 |

`policy`, `copyright` 는 HARD_BLOCK 이라 재시도 대상이 되지 않는다.

## 9. 승인 랭크와 승인 권한을 분리했다

§6.2 가 스스로 지적한 문제 — `ROLE_RANK` 로 비교하면 `OPERATOR(2) > REVIEWER(1)` 이므로
운영자가 승인 권한까지 갖게 된다.

`@MinRole()` 은 랭크 비교를 그대로 쓰되, 승인·반려·공개 전환에는 `@ReviewOnly()` 를 붙였다.
이건 `REVIEWER / ADMIN / SUPER_ROOT` 만 통과하는 별도 검사다.
4-eyes 는 그 위에 한 겹 더 얹힌다.

## 10. Mock 어댑터가 진짜 파일을 만든다

§12 의 예시는 고정 샘플(`fixtures/sample-9x16.jpg`)을 반환한다.
그렇게 하면 QC 의 해상도·화면비·길이·무결성·무음 검사가 전부 같은 값만 보게 되어 무의미해진다.

대신 의존성 없는 PNG 인코더로 프롬프트 시드에서 결정적 이미지를 합성하고,
ffmpeg 으로 실제 mp4 를 만든다. 비용은 0 이 아니라 명세의 단가표를 따르므로 비용 화면도 의미를 갖는다.
같은 프롬프트는 같은 이미지가 나오므로 §9.4 의 중복 호출 캐시가 동작하는지도 눈으로 확인할 수 있다.

임베딩 어댑터는 스토리지 키에서 아티스트 식별자를 뽑아 벡터의 지배 성분으로 넣는다.
그래야 "같은 아티스트의 생성물끼리 높은 유사도"라는 성질이 생기고,
§4.5 의 임계값·마진·재시도 로직을 실제 모델 없이 검증할 수 있다.
`MOCK_IDENTITY_BASE` 를 낮추면 동일성 미달 경로가 재현된다.

## 11. 이미지 트랙의 Identity 재시도는 출력 키를 바꾼다

§4.5 의 재시도 루프는 `seed: null` 로 다시 생성한다.
그런데 §9.4 의 중복 호출 캐시는 `(capability, modelVersion, prompt, sourceAssetKey, aspect, seed)` 해시라
같은 프롬프트로 재시도하면 캐시 히트가 나서 **같은 결과가 돌아온다** — 재시도가 무의미해진다.

재시도마다 프롬프트에 `[identity_guidance=x.xx]` 가 붙어 해시가 달라지긴 하지만,
산출물 키까지 `.r2`, `.r3` 로 분리해 이전 시도를 덮어쓰지 않도록 했다.

## 12. 비공개 업로드를 지원하지 않는 플랫폼

§4.8 은 V1 업로드를 `PRIVATE` 고정으로 못박았고, §8.2 는 "비공개 업로드 지원 여부가 V1 설계의 전제"라고 한다.
어댑터에 `supportsPrivateUpload` 를 두고, 지원하지 않으면 `UNLISTED` 로 내려간다.
**`PUBLIC` 으로는 어떤 경우에도 자동 업로드하지 않는다.** 공개는 사람이 누르는 것이다.

로컬 확인을 위해 Instagram 어댑터를 "비공개 미지원"으로 두었다.
실제 지원 여부는 `docs/integrations/{platform}.md` 에 실측해 기록한다(부록 B #1).

## 13. `order_no` 채번을 원자적 카운터로 바꿨다

처음에는 `SELECT COUNT(*) FROM orders WHERE order_no LIKE 'ORD-YYYYMMDD-%'` 후 +1 로 번호를 만들었다.
단건 제출에서는 문제없이 돌아가지만, §9.1 의 "동시 처리 오더 10건"을 실제로 걸어보니
여러 트랜잭션이 같은 COUNT 를 읽어 같은 번호를 만들고 `orders_order_no_key` 유니크 제약에 걸렸다.

날짜별 카운터 테이블을 두고 `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` 한 번으로 증가시킨다.
마이그레이션(`20260901010000_order_no_counter.sql`)은 기존에 발급된 번호를 세어 초기값을 맞추므로
이미 데이터가 있는 환경에서도 번호가 겹치지 않는다.

부하 테스트를 나중으로 미뤘다면 운영에서 처음 만났을 종류의 버그다.
