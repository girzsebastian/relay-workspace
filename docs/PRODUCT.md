# Product direction

## The problem

Entrepreneurs and developers use several AI coding tools across multiple repositories. Their mental context is split across terminal windows, editors, CLI histories, and chat applications. A restart makes that fragmentation visible: which project, which conversation, which command, and what happened last?

Relay is a durable home for that work. The first promise is **return to a project with its context intact**. The second is **understand which tool is doing what and what usage is actually known**.

“Claude workspace” refers to the user's Claude workflow, not a cloud-hosted computer. Remote machines and always-on cloud agents are not necessary for this first product.

## Primary user journey

1. Open an existing project folder.
2. Launch Codex or Claude Code with the user's official CLI login.
3. Edit files, keep terminals visible, and use graphical chat for planning or review.
4. Run a build explicitly to record elapsed duration and exit status.
5. Close the window; continue in the background on the same running computer.
6. Return after a quit/reboot; see saved output, drafts, chats, and recovery controls.
7. Review repository usage with a clear distinction between known values and missing provider telemetry.

## Views

| View            | Job                                                                               |
| --------------- | --------------------------------------------------------------------------------- |
| Agent board     | Dense Ready / Live sessions / Review & recovery columns for named CLI agents.     |
| Terminal grid   | Independent Claude / Codex / OpenCode / shell panes with resizable 2/4/6 layouts. |
| Workspace       | Work across files, terminals, and chat without changing applications.             |
| Agents & skills | Choose a chat role and attach reusable project instructions.                      |
| Usage           | Inspect attributable API usage and build duration; export records.                |
| Integrations    | Understand official CLI support, MCP configuration, and available capabilities.   |
| Settings        | Configure provider API keys and model IDs.                                        |

The default is a compact desktop IDE with file tabs, two editor groups, resizable and hideable panes, native menus, and a bottom repository status bar. Board and grid views share the same sessions. A git diff/review pane is a future addition. The board reports process lifecycle rather than inferring task completion; it does not provide unattended orchestration or per-agent worktree isolation.

## Subscription and API boundaries

“Bring your subscriptions” means running official tools through supported interfaces, not pooling tokens or extracting their OAuth credentials. Anthropic currently restricts third-party products from offering Claude.ai login or routing user requests through subscription credentials. Custom Claude chat therefore uses the user's API key. See [official policy](https://code.claude.com/docs/en/legal-and-compliance).

Codex's [app server](https://learn.chatgpt.com/docs/app-server) provides a documented path to deeper custom-client integration. The current alpha uses its CLI in a PTY; the next integration can provide exact thread ownership, streamed events, and approval UI after contract testing.

Do not promise that a Cursor subscription supplies model tokens to Relay. Do not promise a universal “remaining tokens” number: quota, billing units, cache semantics, and subscription limits differ between providers.

## Proposed pricing, not a live offer

Start with a useful free local app and test a **$10/month Personal Plus** plan. Price per person, with unlimited local project folders. A small founder should not pay a new subscription every time they start a repository.

| Plan hypothesis               | Proposed value                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Free local                    | Project workspace, terminal continuity, local conversation recovery, basic usage, BYO CLI/API.                                              |
| Personal Plus — $10/month     | Optional encrypted workspace backup/sync, portable named layout profiles, richer usage trends and export, portable agent/skill collections. |
| Team — price after interviews | Shared skill catalogs, workspace membership, permission policies, aggregate usage, organization billing.                                    |

API usage remains billed directly by each provider. No model tokens or compute are included in this proposed $10. Sync excludes credentials by default and needs deliberate encryption, conflict resolution, retention, and account-recovery design. Do not sell sync before those exist.

A SaaS backend is justified by account and collaboration features, even when all code execution stays on the user's device. Billing, authentication, sync, metering limits, taxes, support costs, and customer acquisition are not implemented in the alpha.

Illustrative sensitivity, not a cost forecast: a $10 subscriber leaves $8, $6, or $3 before acquisition and development if payment/support/storage overhead totals $2, $4, or $7 respectively. Validate actual vendor rates and real support time before settling the price.

## Differentiation to validate

The opportunity is continuity across providers and projects. A full clone of Cursor, VS Code, ChatGPT, and Claude is too broad for an initial product. Validate whether people repeatedly return to Relay because it reconstructs their working context with less effort.

Interview 10–15 users who already pay for multiple coding tools. Give them the local recovery workflow for two weeks. Measure opt-in signals: time to resume work, recoveries per week, projects returned to, and willingness to pay for backup and coordination. Do not collect repository contents or prompts as product analytics by default.

## Release gates

1. **Private alpha:** stable terminal lifecycle, draft recovery, crash tests, honest usage, both OSes tested.
2. **Public free beta:** signed releases, updates, backup/restore UI, deletion/export controls, documented CLI compatibility matrix, keyboard/accessibility polish.
3. **Integrated agents:** Codex app-server adapter with exact thread IDs, streaming, approvals, cancellation; Claude API tool execution only after a reviewed permission design; per-agent git worktrees.
4. **Paid beta:** actual account service, encryption design, sync conflict tests, subscription entitlements, billing lifecycle, customer support path.
5. **Extension ecosystem:** decide between an editor platform with a real extension host or a narrower Relay plugin API. Review marketplace access and licensing before claiming VS Code compatibility.

## Explicit open questions

- Which named layout presets save the most time after the default editor view?
- Do users value local context recovery enough to adopt another workspace?
- Which Rakazo-style runtime capabilities are useful enough to justify orchestration and isolation complexity? See [Rakazo assessment](RAKAZO.md).
- Are shareable skills or encrypted cross-device backups the strongest paid feature?
- Should users bring an existing editor and use Relay only for coordination?

These questions do not prevent testing the local desktop alpha.
