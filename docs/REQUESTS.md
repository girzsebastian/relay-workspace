# What was asked for, and where it stands

Written September 8, 2026. This is the running list of everything requested for
Relay in one working session, with an honest status for each item. Anything
marked **not done** is not started, not "nearly there".

Branch: `feature/cli-provider-chat`, released as 0.4.0.

## 1. Chat and agents run on the subscription you already pay for

**Asked:** chat and agents should use the Claude Code / Codex / OpenCode
subscription rather than a separate API key, chosen in settings.

**Done.** Settings offers Claude Code CLI, Codex CLI and OpenCode alongside the
OpenAI and Anthropic APIs. A CLI provider needs no key and no model id. Chat
replies run through the installed CLI with its own login, and the token counts
those runs report are recorded as `provider-cli`.

Correcting an earlier note in the handoff: CLI usage **is** measurable in
headless mode. What stays unmeasurable is an interactive PTY session.

## 2. Bugs found while using it

| Reported                                                                         | Status                     |
| -------------------------------------------------------------------------------- | -------------------------- |
| Recover fails: "No conversation found with session ID"                           | **Done**                   |
| Terminal grids break when switching layout                                       | **Done**                   |
| No way to close a terminal tab; seven open at random                             | **Done**                   |
| No obvious "Add workspace"                                                       | **Done**                   |
| Explorer / terminal / chat toggles shown on Board and Grid where they do nothing | **Done**                   |
| `chat:create` rejected an empty model for CLI providers                          | **Done**                   |
| Git submenu opened off-screen                                                    | **Done**                   |
| Scrollbars visible everywhere                                                    | **Done** — hidden entirely |

On recover: the session id Relay generated was never written by the CLI, so
`--resume` failed inside the PTY. Relay now checks whether the transcript exists
and, when it does not, starts a fresh session carrying the agent's name,
instructions, memory, task and the tail of the previous terminal output.

## 3. Cursor parity in the workbench

**Asked:** the launcher row above the explorer should go; the sidebar should
have Explorer / Search / Source Control / Containers as tabs, not pages; file
changes should be visible in the explorer; settings should look like Cursor's.

**Done.** The launcher row moved into the terminal panel. The sidebar has four
icon tabs and the editor stays visible beside it. Git decorations mark changed
files and any folder containing them. Settings has a category rail and a search
box across every setting.

## 4. Search

**Asked:** the panel from the screenshots — replace behind a chevron, more
options behind three dots, results grouped per file and collapsible, a count
badge, the repository name, per-file replace and dismiss.

**Done.** Search covers the whole workspace: each repository through
`git ls-files`, so its own ignore rules apply, plus the loose files outside any
repository. On a real multi-repository workspace that runs to thousands of
files, with the owning repository shown next to each result.

## 5. Source control

**Asked:** repositories live in subfolders and all of them must appear; a
repository picker; per-repository branch, sync, commit, refresh and a full
"more actions" menu; compact like Cursor's.

**Done.** Repositories are discovered up to three levels deep. The picker offers
"Auto · all repositories" or one of them. Each repository is a single row until
it has something to show. The menu holds 40 commands in nine groups: Pull Push,
Commit, Changes, Branch, Remote, Stash, Tags, Worktrees, Show Git Output.

Two deliberate refusals: push never creates an upstream silently, and discard
never deletes an untracked file, because git cannot bring one back.

**Not done:** "Find Issues" — the agent review button in the reference
screenshots.

## 6. Diff review

**Asked:** clicking a change should show exactly what was added and removed,
side by side, with Keep and Undo per block.

**Done.** Two columns with line numbers on each side, an edit rendered as one
row rather than two, and a header per block showing "1 of 4" with Undo and Keep.
Undo builds a patch containing only that block and applies it in reverse, so the
rest of the file keeps its edits.

Clicking a changed file opens it in the editor as a tab; the compare icon beside
it opens this view.

## 7. The agent chat

**Asked:** it should behave like Cursor's — show what it did, run real commands,
render properly, and offer modes and model choice.

**Done:**

- Steps are streamed. "Worked for 8.9s · 3 actions" expands to each tool call,
  what it did, and its output. A tool result is folded into the call it answers.
- Replies render as markdown: headings, lists, inline code, fenced blocks.
- Three modes: Agent (edits, applied for review), Plan (reads only), Ask (no
  tools at all).
- Mode, provider and model are changeable mid-conversation.
- Run modes in Settings: Allowlist only, Auto-review, Run everything, with an
  editable allowlist.

The default allowlist uses `Bash(git *)` rather than narrower patterns, because
a multi-repo workspace is inspected with `git -C some/repo status`, which a
pattern like `Bash(git status:*)` silently refuses. That breadth includes git
commands that write, which is the trade-off for it working at all.

**Not done:**

- The approval card — Accept, Skip, Add to allowlist with Enter / Esc /
  Shift+Enter. Commands outside the allowlist are refused and named, but there
  is no interactive dialog. This needs Relay to run an MCP server that the CLI
  asks during a run (`--permission-prompt-tool`).
- Subagents: "Explored 1 search · Waiting for subagent".
- Debug and Multitask modes.
- Token-by-token text streaming; steps are live, the reply text lands whole.

## 8. Agents as a team, like Grok Bot

**Asked:** agents should work together the way Grok Bot's do.

**Done:** an agent can hand a stage to another agent. The four decisions that
make that safe are implemented and tested:

1. A hop counter capped at 6. Without it two agents can pass the same stage back
   and forth indefinitely.
2. A handoff queues work; it never starts anything. A person presses Start.
3. Peer text is escaped and framed as untrusted, with an explicit instruction
   not to follow directives inside it that conflict with the user's goals.
4. An agent cannot hand a stage to itself, and both must share a workspace.

**Not done:** the agent deciding to hand off **by itself**. That needs the MCP
server exposing `message_agent` and `handoff_to_agent`, and per-agent `git
worktree` isolation first — two agents writing one working tree corrupt each
other. See `docs/AGENT-TEAMS.md`.

## 9. Agent composer

**Asked:** the composer from the screenshots — queued messages, the file
changes card, and the ability to send with Codex, Claude Code, APIs and
different models.

**Done:** "N Queued" with start and remove per entry; the changes card showing
"N files changed +X −Y" with Keep, Undo and Review; provider and model
selectors that reach the CLI (`--model` for Claude Code, `-m` for the others);
Hand off to another agent.

**Not done:** agents backed by an API rather than a CLI. That requires Relay to
own the model loop rather than launch someone else's.

## 10. The agent panel position

**Asked:** in Agent trenches the conversation should sit on the right.

**Done.** Selecting an agent docks its panel beside the columns instead of
covering the board.

## 11. Should Relay fork VS Code?

**Asked:** Cursor is built on something public — should we do the same?

**Answered, recommended against for now.** Cursor is a fork of VS Code, which is
MIT. A fork means restarting Relay on their repository, not adding a library.
It would give search, decorations, source control and settings — all of which
now exist here for a few hundred lines each. It would not give the agent chat,
which is Cursor's own work and the expensive part either way. Full reasoning and
the conditions that would change the answer are in `docs/VSCODE-FORK.md`.

## Finished since this list was written

- **Relay lends its terminals to the agent.** A local MCP server exposes
  `start_terminal`, `read_terminal`, `list_terminals` and `stop_terminal`, so
  asking "can you run the frontend?" opens a real terminal in Relay, waits for
  the line that proves the server is up, and reports the URL. The terminal is
  visible and read-only to the agent.
- **The approval card.** A command outside the allowlist now becomes Accept /
  Skip / Always allow rather than an automatic refusal. Always allow remembers
  that one action in that one workspace; cancelling a reply cancels the
  question; pending cards never survive a restart.
- **Crash recovery you can read.** Reopening after a crash shows what was
  running, when it stopped, what it was doing, and what Recover will actually
  do. Runs with no transcript and nothing readable are retired instead of
  piling up.
- **Session picker.** Each row names the agent, workspace, state and a line
  taken from what that session printed, with the whole description on hover.

## What changed since (0.5.1)

- **You can see what the agent changed, in the file.** Opening a file the agent
  touched paints the added lines green, marks where lines were removed in red,
  puts a bar beside the line number, and draws a strip down the right edge with
  every change and every error in the whole file, including the parts scrolled
  out of sight. A line that only adds a comment gets its own, stronger green.
- **A list of every file the agent changed**, above the chat rather than buried
  in one reply. It counts the files and the lines, names the repository when a
  workspace holds more than one, and opens the side-by-side diff on click.
- **Folding works.** The gutter carried a 12px padding that CodeMirror already
  applies itself, so every line number sat half a line off its code and the
  fold gutter resolved a click to the line above it: nothing ever folded. The
  padding is gone, and the marker is now a chevron that points down when the
  block is open and right when it is closed.

## Still open, in the order worth doing

1. **Per-agent `git worktree` isolation.** `desktop/workspaces.cjs` exists but
   is deliberately not wired: an agent writing into a copy would make the
   "N files changed" card read the wrong tree. Isolation needs a way to bring
   the work back before it is turned on.
2. **Agents handing off by themselves.** The primitive, its hop limit and the
   untrusted framing are done and tested; what is missing is exposing it as an
   agent tool, which should follow isolation.
3. **Find Issues** — agent review of the current diff.
4. **Subagents** in the chat transcript.
5. **API-backed agents**, Debug and Multitask modes.

## Verification

Every change above is covered by `npm test` (57 tests), `tsc --noEmit`,
`npm run build`, and `npm run test:desktop`, which drives the real application
and fails if any panel raises an error toast.
