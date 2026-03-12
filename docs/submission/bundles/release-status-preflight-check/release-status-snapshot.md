# BUTO Release Status Snapshot

- Generated at: `2026-03-10T05:00:23.901Z`
- Environment: `production`
- Runtime readiness: `ACTION_REQUIRED`
- Blockers: `8`
- Warnings: `2`

## Checklist Summary

- Runtime: COMPLETE 13 / PENDING 0
- Required environment placeholders: COMPLETE 8 / PENDING 0
- Still external / operational: COMPLETE 0 / PENDING 10
- Submission packet: COMPLETE 9 / PENDING 5
- Current placeholder values to replace before launch: COMPLETE 0 / PENDING 5

## Owner Summary

- INFRA: BLOCK 3 / WARN 1 / PASS 0
- SECURITY: BLOCK 2 / WARN 0 / PASS 0
- PARTNERSHIP: BLOCK 2 / WARN 0 / PASS 0
- BACKEND: BLOCK 1 / WARN 1 / PASS 0

## Current Blockers

- [SECURITY] 런타임 시크릿
  Next: 운영용 랜덤 시크릿을 발급해 API 런타임 env에 주입하고, 기본값 부팅을 금지하세요.
  Env: BUTO_AUTH_TOKEN_SECRET, BUTO_INTERNAL_SYSTEM_KEY
- [INFRA] mTLS 인증서
  Next: 파트너 인증서와 키를 서버에 마운트하고 파일 경로를 env에 설정한 뒤 readiness를 다시 실행하세요.
  Env: TOSS_PARTNER_CERT_PATH, TOSS_PARTNER_KEY_PATH, TOSS_PARTNER_CA_PATH
- [PARTNERSHIP] 토스 로그인 / 인증 설정
  Next: 토스 로그인/인증 운영 계약값과 endpoint를 env에 넣고, callback과 결과조회 경로를 샌드박스/운영으로 검증하세요.
  Env: TOSS_LOGIN_TOKEN_URL, TOSS_LOGIN_ME_URL, TOSS_PARTNER_CLIENT_ID, TOSS_PARTNER_CLIENT_SECRET, TOSS_PARTNER_CERT_PATH, TOSS_PARTNER_KEY_PATH, TOSS_PARTNER_CA_PATH, TOSS_CERT_TOKEN_URL, TOSS_CERT_REQUEST_URL, TOSS_CERT_STATUS_URL, TOSS_CERT_RESULT_URL, TOSS_CERT_CLIENT_ID, TOSS_CERT_CLIENT_SECRET, TOSS_CERT_REQUEST_URL_SCHEME
- [PARTNERSHIP] 토스페이 설정
  Next: 토스페이 운영 merchant/client 자격증명과 base URL을 주입하고 test mode를 끈 뒤 승인/환불 QA를 다시 확인하세요.
  Env: TOSS_PAY_BASE_URL, TOSS_PAY_CLIENT_ID, TOSS_PAY_CLIENT_SECRET, TOSS_PAY_MERCHANT_ID, TOSS_PAY_TEST_MODE
- [INFRA] 증빙 스토리지 provider
  Next: 증빙 스토리지를 `s3`로 전환하고 bucket, lifecycle, 접근정책, 검증 경로를 운영 설정으로 마무리하세요.
  Env: BUTO_PROOF_STORAGE_PROVIDER, BUTO_PROOF_S3_BUCKET, BUTO_PROOF_S3_REGION, BUTO_PROOF_S3_ENDPOINT, BUTO_PROOF_S3_ACCESS_KEY_ID, BUTO_PROOF_S3_SECRET_ACCESS_KEY
- [INFRA] 증빙 업로드 / 공개 URL
  Next: 운영 CDN 또는 object storage 공개 URL을 placeholder 대신 실제 도메인으로 교체하세요.
  Env: BUTO_UPLOAD_PUBLIC_BASE_URL, BUTO_PROOF_PUBLIC_BASE_URL
- [BACKEND] 허용 origin 목록
  Next: Apps-in-Toss sandbox/live origin과 실제 miniapp 도메인만 허용 목록에 남기고 placeholder를 제거하세요.
  Env: BUTO_ALLOWED_ORIGINS
- [SECURITY] unlink 콜백 인증
  Next: 콘솔 unlink callback 설정과 동일한 Basic Auth 값을 운영 env에 넣고, 연결 끊기 콜백을 실서버에서 검증하세요.
  Env: TOSS_UNLINK_BASIC_USER, TOSS_UNLINK_BASIC_PASSWORD

## Recent Bundles

- `docs/submission/bundles/owner-env-rehearsal`
- `docs/submission/bundles/rc-rehearsal`
- `docs/submission/bundles/staging-preflight`

