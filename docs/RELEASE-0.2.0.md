# Relay v0.2.0 — Desktop workbench alpha

A compact desktop workspace for moving between projects, files, AI conversations, and agent terminals. This release replaces the large dashboard sidebar with an IDE layout and adds agent and terminal trenches views.

## Downloads

- **Apple Silicon Mac:** `Relay-0.2.0-mac-arm64.zip`. Extract and move `Relay.app` to Applications.
- **Windows x64:** `Relay Setup 0.2.0.exe`. Run the installer and choose an installation directory.
- **Source:** `Relay-0.2.0-source.zip`, or GitHub's source archive.
- **Integrity:** `SHA256SUMS.txt` contains SHA-256 hashes of the attached application/source archives.

These are unsigned alpha builds. The Mac app is not notarized. The Windows installer was cross-built on macOS and has not yet been run on a Windows machine; its executable resource editing was disabled for cross-building. There is no Intel Mac build in this release.

## Changes

- Compact title bar, native application menus, activity rail, and dark/light themes.
- Resize and hide the explorer, editor, terminal panel, and right chat pane. Save the layout automatically or reset it.
- Persistent file tabs, two editor groups with a draggable divider, shared buffers, and nested folder navigation.
- Independent terminals in 2/4/6-pane grids, plus 1/2/4 panes below the editor. Drag grid dividers, focus a pane, and detach without stopping its process.
- Named Claude Code, Codex, and OpenCode agents with instructions, optional skills, and linked sessions. Ready / Live sessions / Review & recovery columns.
- Open a project in installed Cursor or VS Code.
- Repository status bar showing measured API tokens, running/saved agent counts, and tracked build minutes.
- Additive migration of existing saved drafts into file tabs.

## Continuity and provider support

Closing the window keeps terminal processes running while Relay and the computer stay running. Quitting or rebooting interrupts them. Saved conversations, drafts, layouts, and terminal history can be restored afterward; interrupted shell commands are not automatically replayed.

Provider CLIs must be installed and authenticated separately. Relay uses their existing configuration and approval prompts. Graphical chat uses separate OpenAI/Anthropic API keys. CLI subscription usage is unavailable in this alpha; a Cursor subscription is not interchangeable API credit. API chat has no coding tools or VS Code extension host.

Rakazo informed the separation of saved agent identity from runtime sessions; no Rakazo code is embedded. Autonomous routines, browser/computer tools, isolated agent worktrees, sync, billing, and hosted execution are not part of this release.

## Validation

- 15 core tests pass on Node 22.22.0.
- Real Electron checks pass on Apple Silicon macOS: file saving, split buffers, draggable panes, native menus, four PTYs, 4/6 grids, detach, agent records, build timing, forced process restart, and saved-layout recovery.
- The actual packaged Mac app starts successfully with renderer, preload, IPC, and native modules.
- No live provider requests or subscription tokens were used by automated tests.

See `docs/VALIDATION.md` for the full evidence and limitations.
