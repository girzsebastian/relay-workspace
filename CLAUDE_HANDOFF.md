# Relay handoff for Claude Code

Updated: 2026-09-08

## How to use this file

Read this file first when continuing work in the Relay repository. It is a handoff summary of the Codex conversation and the implemented code. The original Codex conversation is not automatically available to Claude; this file is the shared context.

Suggested first instruction:

> Read `CLAUDE_HANDOFF.md`, inspect the current repository and git status, then continue from the current state. Do not undo existing work without explaining why.

## Product

Relay is a local desktop workspace for entrepreneurs and developers who use Codex, Claude Code, OpenCode, terminals, editors, and AI chat across multiple projects. It targets macOS and Windows from one Electron codebase.

The main goal is to preserve project context and make daily AI coding work feel like a compact Cursor-style desktop app:

- Editor view with explorer, tabs, split editors, terminal panel, chat, and resizable/hideable panes.
- Agent Board / Agent Trenches showing coding agents and their sessions.
- Terminal Grid / Terminal Trenches for several persistent PTY sessions.
- Local persistence across app restarts, with explicit recovery after a computer reboot.
- Usage and build statistics without inventing provider data.

This is a local desktop alpha, not yet a hosted SaaS. It does not currently provide cloud execution, accounts, subscriptions, automatic sync, a VS Code extension host, or unattended remote agents.

## Current release

Published prerelease: [Relay 0.4.0](https://github.com/girzsebastian/relay-workspace/releases/tag/v0.4.0)

0.4.0 adds chat and agents on an installed CLI subscription, an agent chat
that streams its steps and can run real commands, approval cards, source
control across every repository in a workspace, search, containers, a
side-by-side diff with per-hunk undo, and a recovery view after a crash. The
full account of what was asked for and what remains is in `docs/REQUESTS.md`.

Repository: `https://github.com/girzsebastian/relay-workspace`

Important commits:

- `174360b` — final release documentation and isolated desktop test input.
- `eaabdbc` — asynchronous desktop view test correction.
- `2d4b989` — editor shared-buffer timing fix and Windows process cleanup.
- `11b1d7f` — agent memory, task queue, automatic CLI agent registration, and richer editor highlighting.

The installed Mac application is `/Applications/Relay.app`, version `0.3.1`. The previous app was backed up under `~/Repositories/relay-workspace/release/installed-backups/`. Workspace data was backed up before installation under `~/Library/Application Support/Relay Backups/`.

## What was implemented

### Agent board

Codex, Claude Code, and OpenCode sessions launched through Relay are automatically registered on the Agent Board. Existing saved coding sessions are migrated to agent records, and recovery links new runs to the same agent identity.

Agents support:

- Editable name and instructions.
- Manually maintained memory included in new tasks.
- Optional project `SKILL.md`.
- Persistent queued tasks.
- Run history and session links.
- Explicit task start.
- Review state after a CLI process exits.
- Explicit `Mark done` completion.
- One active run per agent to prevent duplicate sessions.

Important semantics:

- Queued tasks do not start automatically after a restart.
- A process exiting does not prove that its task is complete; the task moves to review.
- Memory is not automatically inferred from terminal output.
- Commands typed inside a general shell, or processes launched outside Relay, are not automatically indexed.
- Agents share project files. There is no worktree isolation yet.

Relevant files:

- `desktop/agent-state.cjs` — identity registration and task/session migration.
- `desktop/agents.cjs` — agent memory, instructions, task queue, and lifecycle.
- `app/AgentBoard.tsx` — board columns and agent cards.
- `app/AgentDetails.tsx` — tasks, memory, instructions, history, and review controls.
- `desktop/terminals.cjs` — PTY ownership, activity samples, recovery, and lifecycle.

### Editor

The editor uses CodeMirror and loads language parsers on demand through `@codemirror/language-data`. It has semantic colors for keywords, strings, constants, functions, comments, types, tags, attributes, operators, headings, and links.

Verified fixtures include PHP, Python, YAML, CSS, Dockerfiles, and JavaScript. File-type badges are shown in the explorer and tabs. Shared split-editor buffers preserve edits and the most recent fix prevents stale asynchronous content from overwriting rapid typing.

Relevant files:

- `app/Editor.tsx` — CodeMirror setup, themes, parser loading, and syntax colors.
- `app/languages.ts` — language detection.
- `app/FileIcon.tsx` — file-type badges.
- `app/EditorWorkspace.tsx` — tabs, splits, drafts, and saving.

### Layout and persistence

The title bar has Editor, Board, and Grid views. Explorer, editor, terminal, chat, and split-editor panes can be resized or hidden. Tabs can be opened and closed, and terminal panes can be arranged in 1/2/4 or 2/4/6 layouts depending on the view.

The Electron main process owns PTYs, so hiding a pane does not kill its terminal. Closing the window hides Relay; quitting or a crash interrupts running processes, and startup marks them interrupted for recovery. A Mac reboot cannot keep local processes running.

### Usage and builds

Relay records provider-reported API token fields when available and tracks explicit build command wall time. Terminal output is never scraped as billing data, and the status bar shows unknown CLI usage rather than fabricated numbers.

One correction to earlier notes: CLI token usage is not universally unavailable. A CLI-backed chat runs the tool non-interactively, and all three CLIs report real token counts in that mode, so those rows are measured and stored with `source: "provider-cli"`. What remains unmeasured is an _interactive_ PTY session, where no usage is emitted.

## Rakazo reference

The agent design was inspired by [Rakazo](https://github.com/elie222/rakazo), an open-source agent/computer-runtime project. Relay did not copy or embed Rakazo’s backend. See `docs/RAKAZO.md` for the comparison and boundaries.

Rakazo-inspired ideas already present locally are persistent agent identity, memory, task history, and separation between agent identity and computer/terminal runtime. Not implemented are browser/computer tools, Pi runtime integration, scheduled routines, remote sandboxes, shared team computers, and autonomous workers.

## Verification

Local checks:

```sh
npm test
npm run build
npm run test:desktop
npm run test:package
```

The test suite includes persistence, file safety, provider contracts, agent registration, task memory/context snapshots, recovery, editor tabs/splits, PTY I/O, layout changes, and forced restart behavior. No live AI model calls are made by tests.

GitHub CI passed on macOS and Windows for core tests, production build, desktop integration, PTY behavior, restart recovery, and unsigned native packaging. The Windows installer itself still needs a manual installation check on a real Windows machine.

## Development commands

Use Node.js 22.12 or newer:

```sh
npm ci
npm run dev
```

Build and package:

```sh
npm run build
npm run pack       # unsigned app directory for the current OS
npm run dist:mac
npm run dist:win
```

The provider CLIs are installed and authenticated separately. Relay launches the installed official CLI tools and does not convert a Codex, Claude, Cursor, or OpenCode subscription into interchangeable API credits.

### Chat provider selection (branch `feature/cli-provider-chat`)

Chat is no longer API-only. `settings.provider` accepts `claude-cli`, `codex-cli`, and `opencode-cli` alongside `openai` and `anthropic`. CLI providers require no API key and no model ID; they require only that the executable is on PATH, which `capabilities` already reports.

Commands are built in `desktop/cli-chat.cjs` and were verified against the installed CLIs (Claude Code 2.1.263, codex-cli 0.153.4, OpenCode 1.18.29):

- `claude -p <prompt> --output-format json --tools ""` — `--tools ""` disables every built-in tool.
- `codex exec --json --sandbox read-only --skip-git-repo-check <prompt>` — JSONL events; the reply is the last `item.completed` of type `agent_message`.
- `opencode run --format json --agent plan <prompt>` — the `plan` agent is read-only.

Each turn sends the full stored transcript, exactly as the HTTP path already does, so Relay's stored messages stay the single source of truth and a chat cannot drift from session state held inside a CLI.

Still open on this branch: worktree isolation and agent-to-agent handoff, both listed below. Handoff should not land before isolation, because two CLI agents writing the same project folder will corrupt each other's work.

## Next recommended work

1. Add a formal provider adapter layer for streamed events, approvals, thread IDs, usage, and cancellation.
2. Integrate documented Codex app-server APIs instead of relying only on CLI PTYs.
3. Add git status/diff, search, worktree isolation, and approval/event contracts before concurrent autonomous editing.
4. Add export/import and retention controls for local workspace data.
5. Design the SaaS carefully: account membership, encrypted workspace metadata, skills, usage summaries, device keys, ACLs, and optional remote execution. Keep repositories and provider credentials local by default.
6. Add live provider tests only with an explicit test account and budget.

## Safety notes for continuation

- Do not overwrite the user’s workspace state or kill running PTYs without checking current session status.
- Do not claim that provider subscription tokens are measurable unless the provider exposes an official usage event.
- Do not claim that a task is complete merely because a CLI process exited.
- Do not copy Rakazo source without preserving its Apache-2.0 license and notices.
- Check `git status` before editing; preserve unrelated user changes.
