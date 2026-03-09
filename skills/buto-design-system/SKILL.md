---
name: buto-design-system
description: Design and review BUTO mini-app and admin UI with a safety-first visual system, Korean product copy, and operationally realistic interaction patterns. Use when creating new screens, refining existing UI, writing action copy, choosing layout and visual direction, or auditing accessibility, disabled states, re-auth flows, and misuse prevention for offline-transaction product surfaces.
---

# Buto Design System

## Overview

Use this skill to design BUTO screens that feel intentional and trustworthy without hiding risk.
Prioritize clarity, statefulness, and safety copy over growth-style speed or decorative polish.

## Design Order

1. Define the user objective and the risk in the same sentence.
2. List the critical states before drawing the layout:
   - default
   - loading
   - empty
   - blocked
   - pending review
   - timeout or retry
   - completed with next action
3. Decide which action is primary, which action is dangerous, and which action must stay disabled until proof or auth is valid.
4. Write Korean copy that explains consequences plainly.
5. Only then refine typography, spacing, color, and motion.

## Visual Direction

- Keep the current BUTO tone: warm paper background, deep ink text, green-teal brand accents, rounded cards, and soft but noticeable shadows.
- Prefer interfaces that feel service-oriented and calm, not playful or gamified.
- Use high-contrast warning and danger treatments for safety and dispute actions.
- Make system banners and proof requirements visually distinct from promotional content.

Read [`buto-visual-language.md`](./references/buto-visual-language.md) for the current tokens and style cues.
Read [`safety-ux-checklist.md`](./references/safety-ux-checklist.md) when designing new flows or reviewing an existing screen.

## Interaction Rules

- Never hide a required re-auth step behind optimistic copy. Tell the user why authentication is needed and what progress will be preserved.
- For irreversible actions, show the condition first and the button second.
- For risky flows, the primary CTA should usually move the user toward proof, acknowledgement, or review, not directly toward completion.
- When moderation or policy blocks an action, explain the reason category without exposing sensitive detection details.
- Provide a visible recovery path for timeout, poor connectivity, and interrupted uploads.

## Screen Patterns

- Safety acknowledgement
  - Use stacked cards, plain language, and one unmistakable acknowledgment CTA.
- Face-auth gate
  - Explain the protected action, the reason for face auth, and whether the current draft will be preserved.
- Create-job flow
  - Break into small sections. Keep policy review, amount, and transport requirements explicit.
- Active-job flow
  - Emphasize current status, proof requirements, chat risk banner, and report entry point.
- Dispute or blocked state
  - Reduce available actions, preserve evidence affordances, and avoid celebratory visuals.

## Copy Rules

- Write in concise Korean with short sentences and concrete nouns.
- Do not imply the platform guarantees physical safety or emergency intervention.
- Avoid vague reassurance such as "안전하게 보호됩니다" without explaining the mechanism.
- Name the blocker precisely: 얼굴 인증 필요, 정책 검토 필요, 증빙 업로드 필요, 분쟁 검토 중.
- For warnings, say what not to share and why.

## Output Expectations

When using this skill for a substantial design task, prefer output in this order:

1. Objective
2. Assumptions
3. Risks found
4. Recommended visual and UX approach
5. Screen structure or component map
6. Key copy
7. State handling
8. Accessibility and misuse-prevention checks
9. What should stay deferred or manually reviewed

## References

- [`buto-visual-language.md`](./references/buto-visual-language.md): current theme tokens and stylistic guardrails
- [`safety-ux-checklist.md`](./references/safety-ux-checklist.md): mandatory state, copy, and misuse-prevention checks
