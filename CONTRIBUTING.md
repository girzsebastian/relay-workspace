# Contributing

Use Node 22.12+ and npm. Run `npm ci`, `npm test`, and `npm run build`. Desktop integration changes also require `npm run test:desktop` on the affected operating systems.

Keep saved user state backward compatible. Add recovery/migration tests for state changes. Never silently discard a corrupt workspace or replay interrupted commands automatically.

Keep privileged operations in the Electron main process and add explicit IPC schemas. Do not expose raw Electron, shell execution, filesystem access, or provider credentials to renderer content. Preserve provider permission prompts and do not borrow subscription credentials for third-party API calls.

Describe implemented capabilities precisely. Missing measurements should be unknown, and planned extensions should not appear installed. Screenshots with sample content must identify it as test data.

Use separate feature branches and include validation evidence in pull requests. Do not commit keys, workspace databases, terminal logs, or user repository contents.
