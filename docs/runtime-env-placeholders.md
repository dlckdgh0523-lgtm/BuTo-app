# BUTO Runtime Env Placeholders

These values are placeholders for local integration development and must be replaced before release.

## API

- `BUTO_PROOF_STORAGE_PROVIDER=local`
- `BUTO_ALLOWED_ORIGINS=http://localhost:5173,https://apps-in-toss-sandbox.invalid,https://apps-in-toss-live.invalid`
- `BUTO_UPLOAD_PUBLIC_BASE_URL=http://localhost:4000`
- `BUTO_PROOF_PUBLIC_BASE_URL=https://cdn-placeholder.invalid/buto-proofs`
- `BUTO_PROOF_S3_BUCKET=buto-proof-placeholder`
- `BUTO_PROOF_S3_REGION=ap-northeast-2`
- `BUTO_PROOF_S3_ENDPOINT=https://s3.placeholder.invalid`
- `BUTO_PROOF_S3_ACCESS_KEY_ID=placeholder-access-key`
- `BUTO_PROOF_S3_SECRET_ACCESS_KEY=placeholder-secret-key`
- `TOSS_UNLINK_BASIC_USER=unlink-placeholder-user`
- `TOSS_UNLINK_BASIC_PASSWORD=unlink-placeholder-password`

## Miniapp

- `VITE_BUTO_SUPPORT_KAKAOTALK_URL=https://pf.kakao.com/_placeholder`
- `VITE_BUTO_EMERGENCY_CALL_URL=tel:0000000000`
- `VITE_BUTO_EMERGENCY_SMS_URL=sms:0000000000?body=BUTO%20emergency%20placeholder`

## Notes

- The `apps-in-toss` domains above are placeholders only.
- The proof CDN URL is not backed by a real bucket yet.
- `BUTO_PROOF_STORAGE_PROVIDER=s3` should only be enabled when the bucket, lifecycle, and server-side verification path are ready.
- Emergency links are intentionally dummy values for review-safe development.
- Production example files:
  - `apps/api/.env.production.example`
  - `apps/miniapp/.env.production.example`
