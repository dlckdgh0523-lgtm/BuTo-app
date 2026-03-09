# Apps-in-Toss Checklist

## When to Open Official Documentation

Open the `docs-search` skill first when the task depends on any of these:

- current Apps-in-Toss APIs, capabilities, or lifecycle behavior
- Toss design system or component usage guidance
- release, deployment, permission, or packaging requirements
- authentication, payments, or mini-app bridge assumptions

Do not rely on memory for Toss platform behavior when a current document could change the answer.

## When to Validate the Project

Open the `project-validator` skill when the task involves:

- mini-app project structure or missing required files
- framework choice or package validation
- `granite.config.ts` and related configuration
- release-readiness checks for an Apps-in-Toss app

## Channel-Specific Cautions

- Treat Toss face-auth as a release dependency for sensitive BUTO flows. If the exact integration path is undocumented, block shipment rather than inventing a fallback.
- Do not assume unrestricted background behavior, web APIs, or native capabilities without documentation.
- Do not claim escrow behavior unless the actual payment product and legal flow are confirmed.
- Avoid promising emergency intervention or automated external escalation.

## Implementation Checklist

1. Verify the requested capability exists in official Toss guidance if it is channel-specific.
2. Preserve BUTO safety gates even if they add friction.
3. Feature-flag or hard-block flows whose Toss dependency is still uncertain.
4. Keep user-visible pending or blocked states explicit.
5. Add validation for retry, timeout, stale auth, and duplicate event handling.

## Release Readiness Questions

- Can the flow still fail safely if the Toss-side auth or payment step times out?
- Is the mini-app UI clear on what happened and what the user must do next?
- Does the backend reject stale or replayed client actions?
- Can ops reconstruct the event sequence from logs and stored decision reasons?
