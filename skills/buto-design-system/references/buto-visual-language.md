# BUTO Visual Language

## Current Tokens

From `packages/ui/src/theme.ts`:

- `ink`: `#132238`
- `brand`: `#0f766e`
- `brandSoft`: `#ccfbf1`
- `danger`: `#dc2626`
- `caution`: `#b45309`
- `sky`: `#e0f2fe`
- `paper`: `#fffdf8`
- `line`: `#d6d3d1`
- `radius.card`: `24`
- `radius.pill`: `999`
- `shadow`: `0 18px 60px rgba(15, 118, 110, 0.12)`

## Style Principles

- Use `paper` as the default app background to keep the experience warmer than a generic white app.
- Use `ink` for headings and high-signal labels.
- Use `brand` for active tabs, positive status, and primary progression.
- Use `brandSoft` or `sky` for supporting surfaces, never for critical warnings.
- Use `danger` and `caution` sparingly and only when the user should pause or reconsider.
- Keep cards large and rounded. The product should feel calm, not dense.

## Component Cues

- Status chips should communicate state quickly, not decorate the screen.
- Safety cards should have strong title hierarchy and plain explanatory body copy.
- Primary CTA buttons should be visually disabled when the prerequisite is missing, not hidden.
- Layouts should favor stacked mobile sections over crowded dashboards.

## Avoid

- Neon gradients or nightlife colors
- Hyperplayful illustrations in safety-critical screens
- Tiny helper text that carries legal or safety meaning
- Multiple competing primary CTAs on one screen
- Ambiguous success states when money or proof is still pending
