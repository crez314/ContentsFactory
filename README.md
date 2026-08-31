# CREZ Content Factory

[PART 4. Content Factory 개발 명세서 v1.0](https://crez.atlassian.net/wiki/spaces/crez/pages/8552449) 구현.

V1 범위인 **오더 → 생성 → QC → 승인 → 업로드** 파이프라인이 로컬에서 끝까지 동작한다.
AWS 계정 없이 개발·디버깅할 수 있도록 S3·Secrets Manager·SNS 플랫폼은 로컬 대체 구현으로 붙어 있고,
교체 지점이 인터페이스 하나로 좁혀져 있다.

---

## 빠른 시작

```bash
pnpm install
pnpm infra:up          # Postgres 15 + Redis 7 (Docker)
pnpm db:migrate        # SQL 마이그레이션
pnpm db:seed           # 데모 데이터 (자산 60건 + 라이선스 + 채널 4 + 에이전트 3)
pnpm dev               # API + Orchestrator + Worker + 백오피스 동시 실행
```

| 주소 | 내용 |
| --- | --- |
| http://localhost:3000 | 백오피스 |
| http://localhost:4000/v1 | REST API |
| http://localhost:4000/docs | OpenAPI 3.1 (Swagger) |

**데모 계정** — 비밀번호 전부 `crez1234!`

| 이메일 | 역할 | 할 수 있는 일 |
| --- | --- | --- |
| `root@crez.local` | SUPER_ROOT | 전체 + Emergency Stop + 감사 로그 |
| `admin@crez.local` | ADMIN | 에이전트·채널·라이선스·사용자 |
| `operator@crez.local` | OPERATOR | 자산 업로드·태깅, 오더 생성·제출, Task 재시도 |
| `reviewer@crez.local` | REVIEWER | 콘텐츠 승인·반려, 공개 전환 |
| `viewer@crez.local` | VIEWER | 조회만 |

개별 실행이 필요하면:

```bash
pnpm start:api           # 4000
pnpm start:orchestrator
pnpm start:worker
pnpm dev:backoffice      # 3000
```

---

## 한 바퀴 돌려보기

1. `operator@crez.local` 로 로그인
2. **오더 → 오더 생성** — 7단계 폼.
   5단계에서 속성을 바꿀 때마다 우측 **「조건에 맞는 자산 N건」**이 즉시 갱신된다.
   `@crez_jp` 채널을 함께 고르면 사용 가능 0건으로 표시되는데, 시드 자산의 일부가 KR 전용 라이선스이기 때문이다.
3. 7단계 **검증 후 제출** → 오더 상세로 이동
4. 오더 상세에서 선별 결과(적합도 점수·세부 항목), 진행률 5단계, 생성되는 콘텐츠를 관찰
5. **운영 → Task 모니터** 에서 SELECTION → BLUEPRINT → GENERATE → RENDER → QC → PUBLISH 전이를 확인
6. 콘텐츠 상세에서 렌더된 영상 재생, QC 6개 영역 점수, 계보(사용된 원본 자산), 어댑터별 원가 확인
7. 승인 레벨 0 에이전트로 만든 오더는 **콘텐츠 → 승인 대기열** 에 쌓인다.
   `operator` 로는 승인 버튼이 잠긴다 — 본인이 만든 오더는 승인할 수 없다(4-eyes).
   `reviewer@crez.local` 로 로그인하면 승인된다.
8. 게시 후 콘텐츠 상세에서 **공개 전환** 을 누르면 PRIVATE → PUBLIC 으로 바뀐다.

---

## 테스트

```bash
pnpm test                # 단위·계약 테스트 (56)
pnpm test:e2e            # 오더 제출 → 게시 전 구간 (34)
pnpm test:e2e:failure    # 장애 시나리오 (10) — 아래 참고
pnpm test:load           # 동시 오더 10건 + 조회 API p95 측정
```

`test:e2e` 와 `test:e2e:failure` 는 API·오케스트레이터·워커가 떠 있어야 한다.

장애 시나리오는 어댑터가 100% 실패하는 상황을 만들어
**재시도 → Fallback → 에스컬레이션** 이 순서대로 일어나는지 확인한다.
워커를 실패율 100% 로 띄운 뒤 실행한다:

```bash
MOCK_FAILURE_RATE=1 pnpm start:worker
pnpm test:e2e:failure
# 확인 후 워커를 정상 모드로 되돌린다
```

부하 테스트는 §9.1 목표(조회 p95 300ms, 오더 검증 p95 3초, 동시 오더 10건)를 측정한다.
`ORDERS=20 pnpm test:load` 로 규모를 올릴 수 있다.
이 테스트가 실제로 `order_no` 채번의 경쟁 상태를 잡아냈다 —
자세한 내용은 `docs/ARCHITECTURE-NOTES.md` 13번.

---

## 로컬 대체 구현

AWS 가 없어서 다음을 대체했다. **계약은 그대로**라서 실제 인프라가 준비되면 구현체만 바꾸면 된다.

| 명세 | 로컬 구현 | 교체 지점 |
| --- | --- | --- |
| Amazon S3 | 파일시스템(`.storage/`) + HMAC 서명 URL | `libs/storage/src/drivers/s3.driver.ts` 구현 후 `STORAGE_DRIVER=s3` |
| CloudFront Presigned URL | API 의 `/v1/files` 라우트가 서명·만료 검증 | 위와 동일 |
| Secrets Manager | 로컬 스텁 자격증명 | `apps/worker/src/publish/credentials.service.ts` |
| 생성 모델 API | Mock 어댑터 (실제 PNG·MP4 생성) | `ADAPTERS=http` + `libs/model-abstraction/src/register-backends.ts` |
| 임베딩 API | 결정적 해시 벡터 (동일 인물 성분 지배) | 위와 동일 |
| SNS 플랫폼 업로드 | 스토리지에 게시 매니페스트 기록 | `apps/worker/src/publish/mock-channel.adapter.ts` |
| Slack 알림 | 구조화 로그 + 인메모리 버퍼 (대시보드 「주의 필요」) | `libs/model-abstraction/src/notifier.service.ts` |
| ECS Fargate | 로컬 프로세스 3개 | `infra/terraform/` |

**Mock 어댑터는 고정 샘플이 아니다.** 프롬프트 시드에서 결정적으로 PNG 를 합성하고,
ffmpeg 으로 실제 재생 가능한 H.264 + AAC mp4 를 만든다.
그래야 QC 의 해상도·화면비·길이·무결성·무음 검사가 실제로 동작한다.

### 로컬 동작 제어 (버그 재현용)

| 환경변수 | 용도 |
| --- | --- |
| `MOCK_FAILURE_RATE=0.3` | 어댑터가 30% 확률로 실패 — 재시도·Fallback 경로 재현 |
| `MOCK_LATENCY_MS=3000` | 느린 모델 흉내 — SLA 초과 재현 |
| `MOCK_IDENTITY_BASE=0.6` | 동일성 점수를 낮춤 — Identity 재생성·QC FAIL 재현 |
| `QC_PASS_SCORE=95` | QC 기준 상향 — 부분 재생성 경로 재현 |
| `SLA_SCAN_INTERVAL_MS=10000` | SLA 감시 주기 단축 |

---

## 구조

```
apps/
  api/            NestJS REST API · 인증 · 백오피스 데이터
  orchestrator/   Task 상태머신 · 재시도/Fallback/에스컬레이션 · SLA 감시
  worker/         큐 소비 · 선별/블루프린트/생성/렌더/QC/게시
  backoffice/     Next.js 14
libs/
  domain/         엔티티 · 열거값 · 순수 도메인 로직 (선별 점수, QC 가중합, 승인 규칙, 상태머신)
  database/       DataSource · SQL 마이그레이션 · 시드
  queue/          BullMQ 큐 정의 · Job 계약 (zod) · 분산 락
  orchestration/  TaskFactory · ApprovalService · OrchestratorService
  model-abstraction/ 어댑터 계약 · 레지스트리 · Fallback 체인 · 비용 가드 · Mock 백엔드
  storage/        스토리지 드라이버 (local / s3)
  common/         설정 · 구조화 로그 · 에러 코드 · RBAC 가드
infra/docker/     로컬 Postgres · Redis
test/unit/        단위·계약 테스트
test/e2e/         E2E · 장애 시나리오
docs/             통합 확인 항목 · 아키텍처 메모
```

의존 방향은 `apps/* → libs/*` 단방향이다. `libs/domain` 은 다른 libs 를 참조하지 않는다.

명세 §1.3 의 리포 구조에서 **`libs/orchestration` 하나를 추가**했다.
§3.3 에서 오케스트레이터가 `approvalService.decide()` 를 호출하고,
API 도 오더 제출 시 Task 를 만들어야 해서 두 앱이 같은 서비스를 공유해야 하기 때문이다.
앱 간 교차 import 대신 libs 로 올렸다. 자세한 배경은 `docs/ARCHITECTURE-NOTES.md`.

---

## 알려진 로컬 제약

- **자막 굽기** — ffmpeg 빌드에 `drawtext`(libfreetype)가 없으면 자막을 영상에 굽지 않고
  SRT 사이드카만 남긴다. 런타임에 필터 가용성을 확인해 자동으로 갈라진다.
  굽기를 원하면 freetype 포함 ffmpeg 을 설치한다. 렌더 산출물의 `meta.subtitleBurnedIn` 으로 확인할 수 있다.
- **음성** — 로컬 TTS 가 없어 자막 길이에 비례한 무음 트랙을 만든다.
  QC 의 무음 탐지는 BGM 이 섞인 최종 트랙을 보므로 통과한다. 실제 TTS 어댑터를 붙이면 사라지는 제약이다.
- **S3 드라이버** — 계약만 있고 구현이 비어 있다. `STORAGE_DRIVER=s3` 로 켜면 명시적으로 던진다.

## V1 에서 제외된 것 (§0.1)

성과 수집(Analytics)·Optimization Loop·촬영 가이드 환류·승인 레벨 자동 상향·
Trend Research·Command Center·100채널 하네스·멀티테넌시는 구현하지 않았다.
다만 **데이터 모델과 인터페이스는 확보**했다 —
`analytics_snapshots` 테이블, `asset_usages` 계보, 에이전트 실적 집계(`GET /agents/{id}/stats`)는
V1 에서 생성·집계만 하고 활용은 V2 에서 시작한다.
