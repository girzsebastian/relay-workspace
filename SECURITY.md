# Security

Relay runs coding agents on your own machine, with your own files and your own
provider logins. That makes its security model worth stating plainly rather than
leaving people to infer it from the code.

## Reporting a vulnerability

Use GitHub's [private vulnerability reporting](https://github.com/girzsebastian/relay-workspace/security/advisories/new)
on this repository. Please do not open a public issue for anything that would
let one person read or run something on another person's machine.

Include what you did, what happened, and the commit or release you were on. A
proof of concept is welcome; a working exploit against someone else's machine is
not needed and should not be attached.

Expect a first reply within a week. Relay is an alpha maintained by one person,
so please allow time before disclosing publicly.

## What Relay is and is not

Relay is a **local desktop application**. There is no server, no account, no
sync and no telemetry. Everything it stores stays in Electron's `userData`
directory on the machine that wrote it.

It is **not a sandbox**. Opening a project does not execute anything, but
starting a terminal or an agent runs local programs with your privileges, and
that is the point of the app. Relay does not attempt to contain what those
programs do.

## The parts worth reviewing

**Renderer isolation.** The renderer has no Node integration, runs sandboxed
under a restrictive CSP, and reaches the main process only through a preload
bridge whose channel list is an explicit allowlist in `desktop/preload.cjs`. A
channel that is not on that list does not exist as far as the renderer is
concerned. Every handler validates its payload with a zod schema and checks the
sender.

**File access** is scoped to the folder the user opened. Path traversal and
symlink escapes are rejected in `desktop/files.cjs`. Git arguments are passed as
arrays, never as a shell string, and `desktop/git-commands.cjs` rejects any
value that begins with `-` so a branch or file name cannot become a flag.

**Agent permissions.** A conversation runs in one of three modes and one of
three run modes (`desktop/cli-stream.cjs`). The default allows a fixed list of
read tools and git commands, and anything outside it becomes an approval card
the person answers. The `everything` run mode passes
`--permission-mode bypassPermissions` to Claude Code and
`--sandbox danger-full-access` to Codex — that is a deliberate, user-selected
escape hatch, and it is the one setting to understand before using Relay on a
machine that matters.

**The agent bridge.** When an agent may open terminals, Relay starts an HTTP
server bound to `127.0.0.1` only, with a bearer token generated fresh on each
launch (`desktop/agent-bridge.cjs`). Requests without that token are refused.
The agent reaches it through a small MCP server over stdio. Agent-started
terminals are read-only in the UI and only the agent that started one can stop
it.

**Credentials.** API keys are stored with Electron `safeStorage`, which uses the
OS keychain, and are never returned to the renderer. CLI providers use their own
logins; Relay never reads, copies or forwards those credentials, and never
spends one provider's subscription on another provider's API.

## What is not protected

- **Terminal output is an ordinary local file.** A program that prints a secret
  writes that secret to `logs/<uuid>.log`. Chat transcripts and editor drafts
  are ordinary local files too. Protect the device and its backups accordingly.
- **Skills and agent instructions are text, not a boundary.** A `SKILL.md` in a
  project is sent to the model. It does not constrain what a tool may do.
- **Content from a repository is untrusted input.** Relay frames handoffs and
  tool results as untrusted, but a model reading a hostile file in your project
  is a real risk in every tool of this kind, not one Relay solves.
- **Released builds are unsigned.** Until macOS notarization and Windows signing
  are in place, downloaded builds carry no proof of origin. Building from source
  is the safer path.

## Supported versions

Only the latest release. Relay is pre-1.0 and there are no maintenance branches.
