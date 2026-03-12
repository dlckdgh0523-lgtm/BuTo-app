# BUTO Owner Env Handoff

- Bundle label: `owner-env-rehearsal`
- Environment: `production`

## Infrastructure

- BUTO_DATABASE_URL=postgres://user:password@db.example.com:5432/buto
- TOSS_PARTNER_CERT_PATH=/run/secrets/toss-partner.crt
- TOSS_PARTNER_KEY_PATH=/run/secrets/toss-partner.key
- TOSS_PARTNER_CA_PATH=/run/secrets/toss-partner-ca.crt
- BUTO_PROOF_STORAGE_PROVIDER=s3
- BUTO_PROOF_S3_BUCKET=buto-proof-prod
- BUTO_PROOF_S3_REGION=ap-northeast-2
- BUTO_PROOF_S3_ENDPOINT=https://s3.ap-northeast-2.amazonaws.com
- BUTO_PROOF_S3_ACCESS_KEY_ID=replace-with-proof-access-key
- BUTO_PROOF_S3_SECRET_ACCESS_KEY=replace-with-proof-secret-key
- BUTO_UPLOAD_PUBLIC_BASE_URL=https://api.example.com
- BUTO_PROOF_PUBLIC_BASE_URL=https://cdn.example.com/buto-proofs

## Security

- BUTO_AUTH_TOKEN_SECRET=replace-with-production-secret
- BUTO_INTERNAL_SYSTEM_KEY=replace-with-production-internal-key
- TOSS_UNLINK_BASIC_USER=replace-with-unlink-user
- TOSS_UNLINK_BASIC_PASSWORD=replace-with-unlink-password

## Partnership

- TOSS_LOGIN_TOKEN_URL=https://developers-apps-in-toss.example/token
- TOSS_LOGIN_ME_URL=https://developers-apps-in-toss.example/me
- TOSS_PARTNER_CLIENT_ID=replace-with-partner-client-id
- TOSS_PARTNER_CLIENT_SECRET=replace-with-partner-client-secret
- TOSS_PARTNER_CERT_PATH=/run/secrets/toss-partner.crt
- TOSS_PARTNER_KEY_PATH=/run/secrets/toss-partner.key
- TOSS_PARTNER_CA_PATH=/run/secrets/toss-partner-ca.crt
- TOSS_CERT_TOKEN_URL=https://cert.toss.im/oauth2/token
- TOSS_CERT_REQUEST_URL=https://cert.toss.im/api/request
- TOSS_CERT_STATUS_URL=https://cert.toss.im/api/status
- TOSS_CERT_RESULT_URL=https://cert.toss.im/api/result
- TOSS_CERT_CLIENT_ID=replace-with-cert-client-id
- TOSS_CERT_CLIENT_SECRET=replace-with-cert-client-secret
- TOSS_CERT_REQUEST_URL_SCHEME=buto://toss-cert
- TOSS_PAY_BASE_URL=https://pay-apps-in-toss-api.toss.im
- TOSS_PAY_CLIENT_ID=replace-with-pay-client-id
- TOSS_PAY_CLIENT_SECRET=replace-with-pay-client-secret
- TOSS_PAY_MERCHANT_ID=replace-with-pay-merchant-id
- TOSS_PAY_TEST_MODE=false

## Backend

- BUTO_ALLOWED_ORIGINS=https://apps-in-toss-sandbox.toss.im,https://apps-in-toss-live.toss.im
- BUTO_STRICT_RUNTIME_ENV=true
- BUTO_STRICT_DATABASE_ENV=true

