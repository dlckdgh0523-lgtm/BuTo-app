# BUTO Launch QA Report Template

Last updated: 2026-03-10

## Build under review

- Environment:
- API base URL:
- Miniapp bundle version:
- Reviewer:
- Test date:

## Happy paths

- [ ] Toss Login succeeds and returns session
- [ ] Safety acknowledgement is required after login
- [ ] Client can create job only after re-auth
- [ ] TossPay auth + execute flow succeeds
- [ ] Runner can accept and proceed to delivery
- [ ] Signed proof upload and proof completion succeed
- [ ] Client confirmation completes job

## Failure and safety paths

- [ ] Face auth mismatch is rejected
- [ ] Duplicate payment confirmation is rejected or idempotent
- [ ] Risk-review jobs do not appear in nearby list before review
- [ ] Restriction state blocks sensitive actions
- [ ] Appeal submission succeeds for restricted account
- [ ] Worker failure is visible in admin dashboard and admin notifications
- [ ] Runtime readiness screen shows no unresolved launch blockers
- [ ] Invalid proof upload signature is rejected
- [ ] Permission denial for location still leaves app usable
- [ ] Permission denial for camera/photos still leaves app usable

## Cancellation and dispute

- [ ] Client cancellation before pickup requires runner response
- [ ] Idle auto-cancel only applies before arrival
- [ ] Arrival status disables idle auto-cancel
- [ ] Pickup-after dispute path escalates to admin review instead of auto-cancel
- [ ] Failed transaction refund is only allowed for pre-pickup failed deals

## External / operational checks

- [ ] mTLS certs are mounted and readable by the API runtime
- [ ] Allowed CORS origins match sandbox/live Apps-in-Toss domains
- [ ] Unlink callback Basic Auth matches console configuration
- [ ] Proof asset public URL points to production CDN or storage domain
- [ ] Emergency `tel:` / `sms:` links are production values

## Review notes

- Blocking issues:
- Non-blocking issues:
- Attachments:
  - `docs/submission/runtime-readiness-report.md`
  - `docs/submission/bundles/<environment-date>/README.md`
  - `docs/submission/bundles/<environment-date>/owner-action-plan.md`
  - `docs/submission/bundles/<environment-date>/owner-env-handoff.md`
