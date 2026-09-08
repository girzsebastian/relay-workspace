# Relay 0.3.0 — agents and editor color

Coding sessions launched through Relay now appear automatically on the agent board. Existing saved Codex, Claude Code, and OpenCode sessions are migrated into board entries, and recovery preserves the same agent identity.

Agents have a Details panel with editable names and instructions, saved memory, a persistent task queue, and session history. New tasks receive the saved context. Starting work remains explicit; exiting a CLI session moves its task to review, and completion requires Mark done. These features are independently implemented with inspiration from [Rakazo](https://github.com/elie222/rakazo); Relay does not embed its full backend.

The editor now loads language parsers on demand, with distinct colors for keywords, strings, constants, functions, comments, and types. PHP, Python, YAML, CSS, Dockerfiles, and JavaScript are covered by desktop checks. File-type badges, provider accents, measured terminal-output activity, and subtle transitions give the workbench more visual detail. The explanatory banners under Agent trenches and Terminal trenches have been removed.

## Downloads

- `Relay-0.3.0-mac-arm64.zip`: Apple Silicon Mac app. Quit Relay after finishing active work, extract the ZIP, and replace Relay in Applications.
- `Relay.Setup.0.3.0.exe`: Windows x64 installer, cross-built on macOS.
- `Relay-0.3.0-source.zip`: source at this release tag.
- `SHA256SUMS.txt`: checksums for these downloads.

Existing local workspace data is migrated additively. Quitting interrupts running terminal processes; saved conversations and recovery records remain available. Commands typed inside a general shell or launched outside Relay are not automatically indexed on the board.

## Validation and limits

17 core tests pass, including Node 22.22.0. Mac desktop checks pass for editing, layouts, real PTY I/O, task/memory persistence, forced-restart recovery, and syntax colors. The packaged Mac application also passes startup and PHP language-chunk loading checks. Tests use temporary fixtures and make no live model requests.

This remains an unsigned desktop alpha. Windows packaging succeeds, but a complete Windows runtime pass is still outstanding. No CLI token collection, unattended scheduling, browser/computer agent tools, VS Code extension host, or hosted subscription service is included. See [validation](VALIDATION.md) and [Rakazo assessment](RAKAZO.md) for details.
