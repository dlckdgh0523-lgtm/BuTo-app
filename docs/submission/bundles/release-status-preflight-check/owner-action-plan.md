# BUTO Owner Action Plan

- Bundle label: `release-status-preflight-check`
- Environment: `production`
- Overall status: `ACTION_REQUIRED`

## Infrastructure

- Open blockers: `3`
- Open warnings: `1`

### 데이터베이스 연결
- Status: `WARN`
- Detail: 운영 DB 연결 문자열이 없어요. 지금 상태는 재시작/장애 복구에 취약해요.
- Action: Postgres 연결 문자열을 설정하고 `pnpm db:migrate` 이후 worker와 API를 같은 DB에 붙이세요.
- Env keys: `BUTO_DATABASE_URL`
- References: `apps/api/.env.production.example`, `docs/runtime-workers.md`

### mTLS 인증서
- Status: `BLOCK`
- Detail: TOSS_PARTNER_CERT_PATH 또는 TOSS_PARTNER_KEY_PATH가 비어 있어요.
- Action: 파트너 인증서와 키를 서버에 마운트하고 파일 경로를 env에 설정한 뒤 readiness를 다시 실행하세요.
- Env keys: `TOSS_PARTNER_CERT_PATH`, `TOSS_PARTNER_KEY_PATH`, `TOSS_PARTNER_CA_PATH`
- References: `apps/api/.env.production.example`, `docs/apps-in-toss-release-checklist.md`

### 증빙 스토리지 provider
- Status: `BLOCK`
- Detail: 현재 증빙은 로컬 임시 저장 provider를 사용해요. 운영에서는 object storage와 lifecycle 정책이 필요해요.
- Action: 증빙 스토리지를 `s3`로 전환하고 bucket, lifecycle, 접근정책, 검증 경로를 운영 설정으로 마무리하세요.
- Env keys: `BUTO_PROOF_STORAGE_PROVIDER`, `BUTO_PROOF_S3_BUCKET`, `BUTO_PROOF_S3_REGION`, `BUTO_PROOF_S3_ENDPOINT`, `BUTO_PROOF_S3_ACCESS_KEY_ID`, `BUTO_PROOF_S3_SECRET_ACCESS_KEY`
- References: `apps/api/.env.production.example`, `docs/ops/proof-storage-s3-runbook.md`

### 증빙 업로드 / 공개 URL
- Status: `BLOCK`
- Detail: 업로드 또는 CDN base URL이 아직 localhost/placeholder 값이에요.
- Action: 운영 CDN 또는 object storage 공개 URL을 placeholder 대신 실제 도메인으로 교체하세요.
- Env keys: `BUTO_UPLOAD_PUBLIC_BASE_URL`, `BUTO_PROOF_PUBLIC_BASE_URL`
- References: `apps/api/.env.production.example`, `docs/runtime-env-placeholders.md`

## Security

- Open blockers: `2`
- Open warnings: `0`

### 런타임 시크릿
- Status: `BLOCK`
- Detail: 기본 인증 시크릿 또는 내부 시스템 키가 아직 개발용 기본값이에요.
- Action: 운영용 랜덤 시크릿을 발급해 API 런타임 env에 주입하고, 기본값 부팅을 금지하세요.
- Env keys: `BUTO_AUTH_TOKEN_SECRET`, `BUTO_INTERNAL_SYSTEM_KEY`
- References: `apps/api/.env.production.example`, `docs/runtime-env-placeholders.md`

### unlink 콜백 인증
- Status: `BLOCK`
- Detail: unlink callback Basic Auth가 아직 placeholder 값이에요.
- Action: 콘솔 unlink callback 설정과 동일한 Basic Auth 값을 운영 env에 넣고, 연결 끊기 콜백을 실서버에서 검증하세요.
- Env keys: `TOSS_UNLINK_BASIC_USER`, `TOSS_UNLINK_BASIC_PASSWORD`
- References: `apps/api/.env.production.example`, `docs/apps-in-toss-release-checklist.md`

## Partnership

- Open blockers: `2`
- Open warnings: `0`

### 토스 로그인 / 인증 설정
- Status: `BLOCK`
- Detail: 누락된 인증 env: TOSS_LOGIN_TOKEN_URL, TOSS_LOGIN_ME_URL, TOSS_PARTNER_CLIENT_ID, TOSS_PARTNER_CLIENT_SECRET, TOSS_PARTNER_CERT_PATH, TOSS_PARTNER_KEY_PATH, TOSS_PARTNER_CA_PATH, TOSS_CERT_TOKEN_URL, TOSS_CERT_REQUEST_URL, TOSS_CERT_STATUS_URL, TOSS_CERT_RESULT_URL, TOSS_CERT_CLIENT_ID, TOSS_CERT_CLIENT_SECRET, TOSS_CERT_REQUEST_URL_SCHEME
- Action: 토스 로그인/인증 운영 계약값과 endpoint를 env에 넣고, callback과 결과조회 경로를 샌드박스/운영으로 검증하세요.
- Env keys: `TOSS_LOGIN_TOKEN_URL`, `TOSS_LOGIN_ME_URL`, `TOSS_PARTNER_CLIENT_ID`, `TOSS_PARTNER_CLIENT_SECRET`, `TOSS_PARTNER_CERT_PATH`, `TOSS_PARTNER_KEY_PATH`, `TOSS_PARTNER_CA_PATH`, `TOSS_CERT_TOKEN_URL`, `TOSS_CERT_REQUEST_URL`, `TOSS_CERT_STATUS_URL`, `TOSS_CERT_RESULT_URL`, `TOSS_CERT_CLIENT_ID`, `TOSS_CERT_CLIENT_SECRET`, `TOSS_CERT_REQUEST_URL_SCHEME`
- References: `apps/api/.env.production.example`, `docs/apps-in-toss-release-checklist.md`

### 토스페이 설정
- Status: `BLOCK`
- Detail: 누락된 결제 env: TOSS_PAY_BASE_URL, TOSS_PAY_CLIENT_ID, TOSS_PAY_CLIENT_SECRET, TOSS_PAY_MERCHANT_ID
- Action: 토스페이 운영 merchant/client 자격증명과 base URL을 주입하고 test mode를 끈 뒤 승인/환불 QA를 다시 확인하세요.
- Env keys: `TOSS_PAY_BASE_URL`, `TOSS_PAY_CLIENT_ID`, `TOSS_PAY_CLIENT_SECRET`, `TOSS_PAY_MERCHANT_ID`, `TOSS_PAY_TEST_MODE`
- References: `apps/api/.env.production.example`, `docs/apps-in-toss-release-checklist.md`

## Backend

- Open blockers: `1`
- Open warnings: `1`

### 허용 origin 목록
- Status: `BLOCK`
- Detail: placeholder 또는 localhost origin이 남아 있어요: http://localhost:5173, https://apps-in-toss-sandbox.invalid, https://apps-in-toss-live.invalid
- Action: Apps-in-Toss sandbox/live origin과 실제 miniapp 도메인만 허용 목록에 남기고 placeholder를 제거하세요.
- Env keys: `BUTO_ALLOWED_ORIGINS`
- References: `apps/api/.env.production.example`, `docs/apps-in-toss-release-checklist.md`

### strict runtime 검사
- Status: `WARN`
- Detail: strict runtime 또는 database env 검사가 꺼져 있어요.
- Action: 운영 부팅에서 strict runtime/database env 검사를 켜고 기본값 부팅을 막으세요.
- Env keys: `BUTO_STRICT_RUNTIME_ENV`, `BUTO_STRICT_DATABASE_ENV`
- References: `apps/api/.env.production.example`, `docs/runtime-workers.md`

