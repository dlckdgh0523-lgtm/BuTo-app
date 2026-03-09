# Safety UX Checklist

## Required Checks Per Screen

1. Is the user told what action is happening and why it matters?
2. Is the next step clear if auth, upload, moderation, or policy review blocks progress?
3. Are loading, retry, and timeout states visible?
4. Is destructive or risky action visually separated from the main flow?
5. Does the screen avoid encouraging off-platform contact or unsafe disclosure?

## Copy Checklist

- Replace vague words with specific action labels.
- Say what evidence or verification is required before completion.
- Say what data the user must not share in chat.
- Avoid language that overpromises enforcement or emergency response.
- Prefer short Korean sentences over translated enterprise wording.

## High-Risk Surfaces

- Request creation with money input
- Face-auth prompt and re-entry
- Chat during matched or in-progress jobs
- Proof upload and completion
- Report, dispute, or blocked-message states

## Accessibility Baseline

- Keep color contrast high on all status surfaces.
- Do not rely on color alone for blocked or warning states.
- Ensure tap targets remain comfortable in dense mobile layouts.
- Preserve readable hierarchy for older users and stressed users.

## Review Prompts

- Could the user mistake a pending review for a confirmed completion?
- Could the user send contact details or access codes before the UI warns them?
- Could the user miss the reason a CTA is disabled?
- Does the design reduce operator burden, or does it promise automation that ops cannot sustain?
