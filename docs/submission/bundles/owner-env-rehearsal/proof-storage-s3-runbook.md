# BUTO Proof Storage S3 Runbook

Last updated: 2026-03-10

## Objective

Move proof-photo storage from the local temporary provider to the S3-compatible provider without weakening dispute evidence integrity.

## Safety position

- Do not enable `BUTO_PROOF_STORAGE_PROVIDER=s3` until bucket access, lifecycle, and server-side verification are ready.
- Presigned PUT alone is not enough. BUTO treats proof images as dispute evidence, so the server must still verify object existence and image signature during `completeProof`.
- Do not expose a public write path that bypasses the upload session and proof completion flow.

## Required runtime env

API:

- `BUTO_PROOF_STORAGE_PROVIDER=s3`
- `BUTO_PROOF_PUBLIC_BASE_URL=https://cdn.example.com/buto-proofs`
- `BUTO_PROOF_S3_BUCKET=buto-proof-prod`
- `BUTO_PROOF_S3_REGION=ap-northeast-2`
- `BUTO_PROOF_S3_ENDPOINT=https://s3.ap-northeast-2.amazonaws.com`
- `BUTO_PROOF_S3_ACCESS_KEY_ID=...`
- `BUTO_PROOF_S3_SECRET_ACCESS_KEY=...`
- `BUTO_PROOF_S3_SIGNED_URL_TTL_SECONDS=600`

Miniapp:

- no separate proof-storage env is required
- the miniapp consumes the upload session returned by the API

## Bucket policy requirements

- Dedicated bucket for proof assets only
- Server IAM principal may:
  - generate presigned PUT URLs
  - `HEAD` and `GET` proof objects for verification
- No public list access
- Public access should be served through CDN only
- Versioning recommended
- Server-side encryption required

## Object layout

- Key pattern:
  - `{jobId}/{proofType}/{uploadSessionId}.{ext}`
- Allowed proof types:
  - `pickup`
  - `delivery`
- Allowed extensions:
  - `jpg`
  - `png`
  - `heic`
  - `heif`

## CDN requirements

- `BUTO_PROOF_PUBLIC_BASE_URL` must point to the CDN or protected asset domain
- Cache proof images conservatively
- Watermark or transformed proof URLs must still map back to the original object key for dispute reconstruction
- If signed CDN URLs are introduced later, keep `completeProof` output stable for admin evidence views

## Lifecycle policy

- Raw proof objects:
  - retain for the dispute retention period required by policy and counsel
- Do not auto-delete objects before dispute and appeal windows close
- Expire incomplete multipart uploads if multipart is enabled
- Log object delete actions separately from application deletes

## Cutover steps

1. Create bucket, IAM principal, encryption, and lifecycle policy.
2. Configure CDN or asset domain and verify `BUTO_PROOF_PUBLIC_BASE_URL`.
3. Fill `BUTO_PROOF_S3_*` env values in the API runtime.
4. Keep `BUTO_PROOF_STORAGE_PROVIDER=local` until readiness shows no storage blocker except the intentional provider mode.
5. Switch `BUTO_PROOF_STORAGE_PROVIDER=s3`.
6. Open `/admin/runtime-readiness` and confirm:
   - `proof-storage-provider=PASS`
   - `proof-urls=PASS`
   - no remaining launch blockers tied to storage
7. Run end-to-end QA:
   - pickup proof upload
   - delivery proof upload
   - invalid upload signature rejection
   - dispute detail evidence image render
8. Monitor first live uploads and keep rollback ready.

## Rollback

- Set `BUTO_PROOF_STORAGE_PROVIDER=local`
- restart API
- do not delete uploaded S3 proof objects during rollback
- re-run readiness and proof QA

## Validation checklist

- [ ] Presigned PUT upload succeeds from the miniapp
- [ ] `completeProof` succeeds only after server verification
- [ ] Wrong file type is rejected
- [ ] Oversized object is rejected
- [ ] Admin dispute detail still renders evidence image URLs
- [ ] CDN URL is not placeholder
- [ ] Proof objects are not publicly listable

## Known limits

- Current implementation verifies object presence and leading bytes, not full-image decode
- Current implementation assumes single-object upload, not multipart
- If a different object store is used, preserve the same verification guarantees before enabling it
