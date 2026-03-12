# BUTO Runtime Cutover Runbook

Last updated: 2026-03-10

## Objective

Turn the current `runtime-readiness` blockers into an execution order that release owners can follow without guessing ownership.

## Execution Order

1. `INFRA`
2. `SECURITY`
3. `PARTNERSHIP`
4. `BACKEND`
5. `RISK_OPS`

This order is intentional.

- `INFRA` closes the DB, object storage, CDN, and certificate prerequisites that every later owner depends on.
- `SECURITY` closes shared-secret and callback-auth issues before real partner traffic is enabled.
- `PARTNERSHIP` injects Toss production values only after infra and security boundaries are ready.
- `BACKEND` performs final strict-env and origin hardening after real values exist.
- `RISK_OPS` is last because policy acceptance should happen against the final runtime shape, not placeholder assumptions.

## Owner Checklist

### INFRA

- Mount `TOSS_PARTNER_CERT_PATH` and `TOSS_PARTNER_KEY_PATH`.
- Set `BUTO_DATABASE_URL` and run `pnpm db:migrate`.
- Switch `BUTO_PROOF_STORAGE_PROVIDER=s3`.
- Fill `BUTO_PROOF_S3_*`, `BUTO_PROOF_PUBLIC_BASE_URL`, and real upload/CDN domains.
- Confirm bucket lifecycle, object retention, and access policy.

References:

- `apps/api/.env.production.example`
- `docs/ops/proof-storage-s3-runbook.md`
- `docs/runtime-workers.md`

### SECURITY

- Replace default `BUTO_AUTH_TOKEN_SECRET`.
- Replace default `BUTO_INTERNAL_SYSTEM_KEY`.
- Replace `TOSS_UNLINK_BASIC_USER` and `TOSS_UNLINK_BASIC_PASSWORD`.
- Verify unlink callback auth against the Apps-in-Toss console setting.

References:

- `apps/api/.env.production.example`
- `docs/runtime-env-placeholders.md`
- `docs/apps-in-toss-release-checklist.md`

### PARTNERSHIP

- Fill Toss Login production env.
- Fill Toss Certification production env.
- Fill TossPay production env and disable test mode.
- Verify console scopes, callback URLs, and contract-approved endpoints.

References:

- `apps/api/.env.production.example`
- `docs/apps-in-toss-release-checklist.md`

### BACKEND

- Replace placeholder `BUTO_ALLOWED_ORIGINS` with real sandbox/live origins.
- Enable strict runtime and strict database env gating.
- Re-run `pnpm runtime:readiness` until no `BLOCK` remains.
- Re-run `pnpm runtime:readiness -- --strict-warn` before final release candidate sign-off.

References:

- `apps/api/.env.production.example`
- `docs/runtime-workers.md`
- `docs/submission/runtime-readiness-report.md`

### RISK_OPS

- Review the final runtime-readiness report.
- Confirm dispute, appeal, restriction, and worker-failure handling coverage.
- Confirm emergency/support fallback destinations are production values.
- Sign off only after `runtime-readiness` shows `READY` or only explicitly accepted warnings.

References:

- `docs/submission/runtime-readiness-report.md`
- `docs/submission/launch-qa-report-template.md`
- `docs/submission/app-registration-packet.md`

## Preflight Command

- Run `pnpm release:preflight` before a release candidate handoff.
- Default behavior is fail-closed:
  - any `BLOCK` exits non-zero
  - any `WARN` exits non-zero
- Use only for non-release rehearsals:
  - `pnpm release:preflight -- --allow-warnings`
  - `pnpm release:preflight -- --allow-blockers --allow-warnings`
- The command always writes a submission bundle under `docs/submission/bundles/<bundle-label>/`.
