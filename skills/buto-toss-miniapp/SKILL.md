---
name: buto-toss-miniapp
description: Implement, review, and refactor BUTO Apps-in-Toss mini-app, API, and admin flows with Toss-specific constraints and BUTO safety rules. Use when working on Apps-in-Toss screens, mini-app state handling, Toss login or face-auth gating, project structure validation, official Toss documentation checks, or any change that touches apps/miniapp, packages/ui, packages/contracts, packages/policy, or release feasibility for the Toss channel.
---

# Buto Toss Miniapp

## Overview

Use this skill to make Apps-in-Toss changes that stay aligned with BUTO's safety posture and the likely limits of the Toss mini-app channel.
Start from product risk and release feasibility, not from component code.

## Working Order

1. Restate the user request as a real product objective.
2. Identify the risk class before editing anything:
   - offline meeting safety
   - chat abuse or privacy leakage
   - payment hold, payout, refund, or dispute handling
   - face-auth or adult-verification dependency
   - Apps-in-Toss framework or release constraint
3. Verify whether the task depends on current Toss documentation or project structure:
   - For official Toss or Apps-in-Toss guidance, open the local `docs-search` skill and retrieve the relevant docs first.
   - For project setup or `granite.config.ts` style issues, open the local `project-validator` skill and validate the app structure.
4. Map the change to the current BUTO state model before editing domain logic.
5. Implement failure paths, audit needs, and disabled states before polishing the happy path.
6. Validate with tests or targeted checks. If integration remains speculative, mark it as blocked or feature-flagged instead of pretending it is shippable.

## Non-Negotiable Constraints

- Treat BUTO as a high-risk offline transaction system, not as a generic marketplace.
- Keep adults-only and Toss-login-only assumptions intact.
- Fail closed for sensitive actions such as request creation, payment confirmation, payout release, and completion confirmation when auth state is stale or ambiguous.
- Do not replace Toss face authentication with device biometrics.
- Do not collapse financial states into `paid/unpaid`; preserve payment, hold, payout, refund, dispute, and failed-settlement semantics.
- Do not let chat moderation remain UI-only. Severe moderation outcomes must be able to freeze chat, hold progress, or push the job into dispute.
- Prefer manual review hooks over irreversible automation.

## Code Map

- `apps/miniapp/src/app.tsx`: current Toss-facing UI shell and screen flow prototype
- `apps/api/src/modules/*.ts`: backend service slices for auth, jobs, chat, payments, safety, reports, admin
- `packages/contracts/src/state-machines.ts`: explicit job transition rules
- `packages/contracts/src/types.ts`: shared DTOs and domain record shapes
- `packages/policy/src/risk-engine.ts`: request risk evaluation
- `packages/policy/src/moderation.ts`: chat moderation outcomes and enforcement intent
- `packages/ui/src/*`: mini-app visual primitives and theme tokens

Read [`buto-domain-map.md`](./references/buto-domain-map.md) when the task touches domain boundaries or state transitions.
Read [`apps-in-toss-checklist.md`](./references/apps-in-toss-checklist.md) when the task depends on Toss documentation, release assumptions, or project validation.

## Implementation Rules

- Model state transitions explicitly. If a proposed transition is not in the shared contract, add it intentionally and test it.
- Preserve idempotency around payment confirmation, completion, report submission, and payout release.
- Separate authn failure, authz failure, validation failure, moderation block, and policy review in both code and UI copy.
- Keep re-auth resumable. The job draft or in-progress action must survive a face-auth interruption without silently continuing.
- Record audit-friendly reasons for blocks, warnings, disputes, and admin actions.
- When Toss capability is uncertain, state the uncertainty and gate the feature. Do not imply official support without documentation.

## Output Expectations

When using this skill for a substantial task, prefer output in this order:

1. Objective
2. Assumptions
3. Risks or contradictions found
4. Recommended implementation approach
5. State model or flow impact
6. API, schema, UI, or code changes
7. Edge cases and abuse paths
8. Validation performed
9. What remains blocked, deferred, or feature-flagged

## Done Criteria

- Sensitive flows fail closed.
- Risk, moderation, and dispute hooks are preserved.
- The change matches the shared state machine and DTOs.
- User-facing copy explains blocked or pending states plainly.
- Tests cover at least one unhappy path, not just the happy path.
- Toss-specific assumptions are either documented from official guidance or clearly labeled as pending verification.

## References

- [`buto-domain-map.md`](./references/buto-domain-map.md): current domain files, invariants, and safety-critical touchpoints
- [`apps-in-toss-checklist.md`](./references/apps-in-toss-checklist.md): when to verify official docs, validate project structure, and block risky assumptions
