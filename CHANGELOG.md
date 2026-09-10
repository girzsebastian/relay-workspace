# Changelog

Relay is a pre-1.0 alpha. Versions are informative rather than a compatibility
promise, but saved workspace state is migrated forward and never silently reset.

## Unreleased

## 0.6.0 — 2026-09-10

The release that made Relay public.

### Changed

- **Licence: MIT → GNU AGPL-3.0-or-later.** Relay stays open source and anyone
  may use, modify, self-host and fork it, but a modified version offered to
  other people over a network has to publish its source. Contributions are now
  accepted under [CLA.md](CLA.md), which keeps the option of a hosted Relay
  under other terms. Everything already published under MIT stays available
  under MIT; the change applies going forward.
- **vite 6 → 8** and **@xterm/xterm 5 → 6**, with `@vitejs/plugin-react` 6 and
  the fit addon at 0.11, which is what those two majors actually needed.
  Production builds are noticeably faster and chunked the same way.
- Explorer rows tightened from 25px to 21px.

### Added

- Contributor License Agreement with a self-hosted signature workflow, CodeQL
  analysis over the code that runs with the user's privileges, and grouped
  Dependabot updates that leave `node-pty` alone because it compiles against
  the Electron ABI.
- `SECURITY.md` describing the security model plainly: what is isolated, what is
  not, and what the `everything` run mode actually hands to the CLI.
- Screenshots in the README, produced by the test runner against a temporary
  fixture project.

### Fixed

- Windows CI, red since before this work: the desktop test printed PASS and hung
  until the step timed out; fixture repositories did not pin `core.autocrlf`;
  `diff --no-index` was handed `os.devNull`, a device name git will not open;
  and the TypeScript service keyed its buffer overrides on the path it was
  given, so on Windows the override never matched and it answered about the file
  on disk instead of the unsaved edit in front of the person.

## 0.5.1

### Added

- **Inline diff decorations in the editor.** Added lines get a green wash, a
  line that only introduces a comment a stronger green, removed lines a red
  mark, changed line numbers a bar in the gutter, and the whole file an overview
  strip down the right edge covering changes, errors and warnings — including
  the parts scrolled out of view.
- **A list of every file the agent changed**, above the chat rather than buried
  inside one reply, with line counts, the repository name when a workspace holds
  several, and the side-by-side diff on a compare button.
- **TypeScript language service**: completions, diagnostics and hover types from
  the project's own `tsconfig`, answered about the buffer on screen rather than
  the file on disk.
- **Enter sends, Shift+Enter starts a new line** in the chat composer.

### Fixed

- **Code folding never worked.** The editor theme added a 12px top padding to
  the gutter that CodeMirror already applies itself, so every line number sat
  half a line off its code and the fold gutter resolved a click to the line
  above, where nothing was foldable.
- **A file the agent created read as `+0 −0` with an empty diff.** Untracked
  files are invisible to `git diff`; their lines are now counted from the file,
  and `diff --no-index` output is no longer discarded because that command exits
  non-zero precisely when it finds a difference.
- Clicking a file in either change list opens it in the editor.
- Explorer rows tightened from 25px to 21px.
- **Windows CI, red since before this work.** The desktop test printed PASS and
  then hung until the step timed out; fixture repositories did not pin
  `core.autocrlf`; `diff --no-index` was handed `os.devNull`, a device name git
  will not open; and the TypeScript service keyed its buffer overrides on the
  path it was given, so on Windows the override never matched and it answered
  about the file on disk instead of the unsaved edit.

## 0.4.x

### Added

- Chat and agents backed by an installed CLI subscription (Claude Code, Codex,
  OpenCode) rather than a separate API key.
- Streamed agent steps with "Worked for Ns", markdown replies, approval cards
  for anything outside the allowed list, and a per-reply card listing what it
  changed with a way back.
- Agent-owned read-only terminals through a loopback MCP bridge, so an agent can
  start a dev server and you can watch it.
- Multi-repository source control, side-by-side diffs with per-hunk undo,
  workspace search with globs and regular expressions, and a container view.
- Crash recovery that says what was running, when it stopped and what it was
  doing, taken from what the session actually printed.

## 0.3.1 and earlier

See the [release notes](https://github.com/girzsebastian/relay-workspace/releases)
and [docs/VALIDATION.md](docs/VALIDATION.md) for what was verified at each point.
