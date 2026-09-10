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

---

By opening this pull request you accept the [contributor terms](../blob/main/CLA.md): you keep your copyright, and you grant a licence broad enough that a hosted Relay can be offered under other terms later. Nothing you contribute leaves the AGPL version. Nothing to sign.
