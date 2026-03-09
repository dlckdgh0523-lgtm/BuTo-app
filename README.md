# BUTO v1 MVP

BUTO is a location-based errand-call platform for Apps in Toss, scoped to a safety-first MVP.

## Workspace layout

- `apps/api`: in-memory API skeleton centered on auth, jobs, chat moderation, reports, payments, and admin views
- `apps/miniapp`: React miniapp shell for the Apps in Toss client experience
- `apps/admin`: React admin console shell for risk and CS workflows
- `packages/contracts`: shared enums, DTOs, API response types, and state-machine helpers
- `packages/policy`: policy engine for risk scoring, chat moderation, masking, and payout release decisions
- `packages/ui`: shared UI primitives and theme tokens
- `packages/config`: environment and product defaults

## Status

This repository is intentionally scaffold-first. It locks the product contracts and core domain rules without requiring external package installation.

## Local commands

```bash
npm run show:routes
npm run test:domain
```

`pnpm` is declared as the workspace package manager for future installation, but the current scaffold can be inspected and partially verified with the built-in Node.js runtime.

