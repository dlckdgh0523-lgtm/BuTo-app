# BUTO App Registration Packet

Last updated: 2026-03-10

## App identity

- App name: `BUTO`
- Category: `Location-based errand / matched transaction`
- Inquiry email: `placeholder-support@buto.invalid`
- Keywords:
  - `심부름`
  - `위치 기반 매칭`
  - `안전 거래`
  - `토스 로그인`

## Reviewer summary

BUTO is an adults-only Apps-in-Toss miniapp for offline errand matching with held-payment, re-authentication for sensitive actions, moderation, dispute handling, and operator review controls.

## Core flows implemented

- Toss Login only
- Safety acknowledgement required on every login
- One-touch re-auth for high-risk actions
- Held-payment request and execution flow
- Proof upload session + signed upload route + proof completion
- Agreement-based cancellation before pickup
- Automatic idle cancellation only before arrival
- Post-pickup dispute escalation
- Restriction / appeal / reinstatement flows
- Admin dispute evidence review and worker health monitoring

## Platform-sensitive notes

- No iframe-based product features are used.
- Light-mode-first UI is used for Apps-in-Toss review friendliness.
- Apps-in-Toss framework and Toss SDK integrations remain in use for login, payment, permissions, and navigation.
- Heavy TDS runtime components were removed from the hot path to keep the initial bundle smaller; this is a performance decision, not a removal of Toss platform integration.
- External links are limited to emergency / support fallback paths only.
- Emergency `tel:` / `sms:` links are placeholder values in development and must be replaced before launch.
- Proof asset URLs currently use placeholder CDN values and must be replaced with production storage/CDN settings.

## Still external before submission

- Real business workspace and representative admin
- mTLS certificate deployment
- Firewall allowlists
- Toss Login / Toss Certification / TossPay production credentials
- Real support email and real Kakao support channel URL

## Evidence to attach

- Login flow screenshots
- Safety acknowledgement screen
- Permission rationale screens for location / camera / photos
- Request creation -> payment -> proof -> completion path
- Cancellation agreement and dispute escalation screens
- Restriction / appeal screen
- Admin dispute evidence screen
- Admin runtime readiness screen
- Generated runtime readiness report: `docs/submission/runtime-readiness-report.md`
- Generated submission bundle folder: `docs/submission/bundles/<environment-date>/`
- Generated owner action plan: `docs/submission/bundles/<environment-date>/owner-action-plan.md`
- Generated owner env handoff: `docs/submission/bundles/<environment-date>/owner-env-handoff.md`
