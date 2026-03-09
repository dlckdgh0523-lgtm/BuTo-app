# BUTO Domain Map

## Core Invariants

- Adults only. Do not introduce minor recovery flows or soft age checks.
- Toss login is the baseline identity boundary.
- Sensitive actions need valid Toss face auth, not only device biometric proof.
- Payment and payout states are separate from job states.
- Chat moderation can affect both message visibility and job progression.
- Offline proof and dispute reconstruction matter more than matching speed.

## Current File Map

- `apps/miniapp/src/app.tsx`
  - Current mock UI flow for safety acknowledgement, face-auth gating, request creation, active job state, and reviews/community.
- `apps/api/src/modules/auth.service.ts`
  - Auth session summary, face-auth validity, and user verification boundary.
- `apps/api/src/modules/jobs.service.ts`
  - Job creation, offer, match, lifecycle updates.
- `apps/api/src/modules/payments.service.ts`
  - Payment initiation, held-fund semantics, payout or settlement handling.
- `apps/api/src/modules/chat.service.ts`
  - Message flow and moderation impact on job/chat state.
- `apps/api/src/modules/safety.service.ts`
  - Safety acknowledgement, emergency/reporting, and safety-specific controls.
- `apps/api/src/modules/reports.service.ts`
  - Reporting intake and evidence trail.
- `apps/api/src/modules/admin.service.ts`
  - Manual review and administrative overrides.
- `packages/contracts/src/enums.ts`
  - Job, payment, payout, moderation, auth, and risk enum values.
- `packages/contracts/src/state-machines.ts`
  - Explicit job transition rules. Update this intentionally, never implicitly.
- `packages/contracts/src/types.ts`
  - Shared request and record shapes. Preserve auditability when adding fields.
- `packages/policy/src/risk-engine.ts`
  - Pre-match request risk assessment.
- `packages/policy/src/moderation.ts`
  - Post-match chat moderation and enforcement actions.
- `packages/policy/src/payout.ts`
  - Payout release policy logic.

## High-Risk Change Areas

- Face-auth expiration, retry, or bypass behavior
- Payment capture, hold, refund, dispute, or failed settlement
- Completion proof and client confirmation
- Chat message delivery after WARN or SEVERE_BLOCK decisions
- Arrival or location proof based on weak client signals
- Admin actions that override automated policy outcomes

## Review Prompts

- What happens if the user backgrounds the app during auth?
- What happens if duplicate payment confirmation or completion requests arrive?
- Can the runner or client move the job to a later state without proof?
- Does the UI explain why the action is blocked and what the user can still do?
- Is there an audit trail for manual review, report intake, and moderation enforcement?
