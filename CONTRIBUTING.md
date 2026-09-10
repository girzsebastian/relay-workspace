# Contributing

Use Node 22.12+ and npm. Run `npm ci`, `npm test`, and `npm run build`. Desktop integration changes also require `npm run test:desktop` on the affected operating systems.

Keep saved user state backward compatible. Add recovery/migration tests for state changes. Never silently discard a corrupt workspace or replay interrupted commands automatically.

Keep privileged operations in the Electron main process and add explicit IPC schemas. Do not expose raw Electron, shell execution, filesystem access, or provider credentials to renderer content. Preserve provider permission prompts and do not borrow subscription credentials for third-party API calls.

Describe implemented capabilities precisely. Missing measurements should be unknown, and planned extensions should not appear installed. Screenshots with sample content must identify it as test data.

Use separate feature branches and include validation evidence in pull requests. Do not commit keys, workspace databases, terminal logs, or user repository contents.

## Licensing

Relay is [AGPL-3.0-or-later](LICENSE). Opening a pull request accepts the [contributor terms](CLA.md) — there is nothing to sign and no check to satisfy. You keep the copyright to what you write; the terms grant a licence so a hosted Relay can be offered under other terms later without tracking down every contributor. Nothing you contribute leaves the AGPL version.

Anything you submit must be yours to license, including code written with an AI assistant. Work that is not your own creation belongs in a separate pull request that names its source and licence.

Adding a dependency means adding its licence to this project. Permissive licences (MIT, ISC, BSD, Apache-2.0) are fine. Anything else, raise it in an issue first.
