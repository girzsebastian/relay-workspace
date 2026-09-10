## What this changes

<!-- One paragraph. What was wrong, and what it does now. -->

## Why

<!-- If it fixes an issue, "Fixes #123". If it is a judgement call, say what you
     weighed. -->

## Evidence

<!-- Relay's contributing guide asks for validation evidence, not a promise.
     Delete the lines that do not apply. -->

- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run test:desktop` — on: <!-- macOS / Windows -->
- [ ] `npm run format:check`

<!-- A screenshot or a short recording for anything visual. A new IPC channel
     must be added to the allowlist in desktop/preload.cjs, or the renderer
     cannot call it and nothing will happen. -->

## Anything a reviewer should know

<!-- Migrations of saved state, a decision you are unsure about, follow-up work
     you deliberately left out. -->
