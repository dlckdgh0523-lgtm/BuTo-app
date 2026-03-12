# BUTO Apps-in-Toss Release Checklist

Last updated: 2026-03-10

## Runtime

- [x] SDK 2.0.1 web miniapp structure is in place.
- [x] Toss Login only flow is implemented.
- [x] One-touch re-auth is wired for sensitive actions.
- [x] TossPay create / checkout / execute / reconcile flow is wired.
- [x] Proof upload uses signed upload sessions.
- [x] Proof storage is abstracted behind a provider boundary.
- [x] S3 presigned PUT provider boundary and server-side object verification path exist.
- [x] Unlink callback endpoint exists with Basic Auth verification.
- [x] CORS allowlist is configurable with `BUTO_ALLOWED_ORIGINS`.
- [x] Admin runtime readiness summary exists for launch blockers and warnings.
- [x] Safety acknowledgement is required every login.
- [x] Admin dispute evidence view exists.
- [x] Worker heartbeat and worker failure admin alerts exist.

## Required environment placeholders

- [x] `BUTO_UPLOAD_PUBLIC_BASE_URL`
- [x] `BUTO_PROOF_PUBLIC_BASE_URL`
- [x] `BUTO_ALLOWED_ORIGINS`
- [x] `TOSS_UNLINK_BASIC_USER`
- [x] `TOSS_UNLINK_BASIC_PASSWORD`
- [x] `TOSS_PARTNER_CERT_PATH`
- [x] `TOSS_PARTNER_KEY_PATH`
- [x] `TOSS_PAY_BASE_URL`

## Still external / operational

- [ ] Business workspace and representative admin are created in Apps-in-Toss console.
- [ ] mTLS certificates are issued and deployed.
- [ ] Firewall inbound / outbound allowlists are applied.
- [ ] Toss Login scopes and unlink callback are configured in console.
- [ ] Toss certification contract and production credentials are approved.
- [ ] TossPay contract and production merchant credentials are approved.
- [ ] Real S3 bucket, presigned PUT flow, CDN domain, and object lifecycle are configured.
- [ ] Real emergency `tel:` / `sms:` destination values replace placeholders.
- [ ] Test / live origins replace placeholder Apps-in-Toss domains in `BUTO_ALLOWED_ORIGINS`.
- [ ] Functional message templates and opt-in / opt-out policy are approved.

## Submission packet

- [ ] App icon, app name, inquiry email, and keyword sheet are finalized.
- [ ] App registration narrative is prepared.
- [ ] Launch QA report includes happy path, failure path, and permission denied scenarios.
- [ ] Risk Ops runbook includes dispute, restriction, appeal, and worker failure handling.
- [ ] Privacy policy, terms, and safety notice text are reviewed by counsel.
- [x] Submission packet templates exist in `docs/submission/`.
- [x] Production env examples exist in `apps/api/.env.production.example` and `apps/miniapp/.env.production.example`.
- [x] S3 proof storage runbook exists in `docs/ops/proof-storage-s3-runbook.md`.
- [x] Runtime cutover runbook exists in `docs/ops/runtime-cutover-runbook.md`.
- [x] `pnpm runtime:readiness` can fail deployment when launch blockers remain.
- [x] `pnpm runtime:readiness:report` can generate a Markdown report for submission / release review.
- [x] `pnpm submission:bundle` can generate a submission bundle folder with core release documents and readiness outputs.
- [x] `pnpm release:preflight` can generate a release-candidate bundle and fail closed when blockers or warnings remain.

## Current placeholder values to replace before launch

- [ ] `https://apps-in-toss-sandbox.invalid`
- [ ] `https://apps-in-toss-live.invalid`
- [ ] `https://cdn-placeholder.invalid/buto-proofs`
- [ ] `tel:0000000000`
- [ ] `sms:0000000000?body=BUTO%20emergency%20placeholder`
