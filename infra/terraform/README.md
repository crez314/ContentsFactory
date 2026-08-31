# Terraform

§1.2 시스템 구성의 AWS 리소스를 정의하는 곳이다.
AWS 계정이 확보되기 전이라 아직 비어 있고, 로컬은 `infra/docker/docker-compose.yml` 로 대체한다.

## 만들어야 할 리소스

| 리소스 | 용도 | 명세 |
| --- | --- | --- |
| VPC · 서브넷 · SG | 네트워크 격리 | §1.2 |
| RDS PostgreSQL 15 | Multi-AZ, 자동 백업 7일, KMS 암호화 | §1.1, §9.2 |
| ElastiCache Redis 7 | BullMQ | §1.1 |
| S3 버킷 | 퍼블릭 액세스 차단, 조회는 Presigned URL 만 | §9.2 |
| S3 수명주기 규칙 | 중간 산출물 90일 후 Glacier | §9.1 |
| CloudFront | 백오피스 미리보기 | §1.1 |
| ECR | 컨테이너 이미지 | §1.1 |
| ECS Fargate 서비스 3종 | api(CPU 오토스케일) · orchestrator(단일) · worker(큐 길이 오토스케일) | §1.2 |
| ALB | api 앞단 | §1.2 |
| Secrets Manager | 외부 API 키 · 채널 자격증명 · JWT 시크릿 | §1.1, §9.2 |
| CloudWatch Logs · Metrics · Alarms | 구조화 로그 + §9.3 알림 임계값 | §9.3 |

## 환경

`local / dev / stage / prod` 를 workspace 로 나눈다 (§1.4).
`local` 은 Terraform 대상이 아니다.

## 배포 전 확인

- `assertProductionSafety()` 가 dev 이상에서 로컬 기본 시크릿과 `STORAGE_DRIVER=local` 을 거부한다.
  Secrets Manager 주입이 되지 않으면 컨테이너가 부팅 단계에서 멈춘다.
- orchestrator 는 단일 인스턴스(desired count 1)로 두되, Redis 분산 락이 중복 실행을 막으므로
  롤링 배포 중 순간적으로 2개가 떠도 안전하다.
