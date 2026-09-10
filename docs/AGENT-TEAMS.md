# Agent teams — the next step

Status: design agreed, not implemented. Written September 8, 2026.

This is the plan for letting Relay agents work as a team instead of as isolated
single-agent sessions. It is the agreed next feature after CLI-backed chat.

## Where the design comes from

Two sources, read on September 8, 2026:

- **Grok Bot** ([overview](https://docs.x.ai/grok-bot/overview),
  [collaboration](https://docs.x.ai/grok-bot/chat-and-collaboration)) — the
  product shape: 2–6 bots in a group chat, `@` to address one, bots message each
  other and pass ownership, one shared computer per account. Their own guidance
  is to keep **a single owner per stage** rather than a coordinator bot, because
  parallel handoffs duplicate work.
- **Rakazo** ([repository](https://github.com/elie222/rakazo), Apache-2.0) — the
  engineering. `packages/core/src/bot-messages.ts` and
  `packages/adapters/src/group-handoff.ts` solve the hard parts.

Relay implements these ideas independently. Rakazo's code is Apache-2.0; adopting
any of it verbatim would require preserving its license and notices, and its
architecture (Postgres, Prisma transactions, a Graphile Worker queue) does not
map onto a local Electron app. See `docs/RAKAZO.md` for the wider comparison.

## The seven decisions worth copying

1. **A hop counter.** Rakazo caps bot-started deliveries at
   `BOT_MESSAGE_MAX_HOPS = 6`; a message from a person resets the chain to 0.
   Their comment is the whole argument: messaging is fire-and-forget, so nothing
   otherwise stops two agents replying to each other forever. Without this, two
   agents can burn a subscription overnight. Nothing else on this list matters
   until this exists.
2. **Two verbs, not one.** `message_bot` is asynchronous, does not end the
   sender's turn, and expects the sender to continue its own work.
   `handoff_to_bot` transfers ownership of a distinct next stage and is valid
   only inside a group. Collapsing them into one verb is what produces duplicated
   work.
3. **Typed intents** — `request | result | question | status | fyi` — which
   change the recipient's obligation. `fyi` may be answered with silence;
   `result` and `status` must be relayed with their actual substance, not
   acknowledged.
4. **An explicit ownership rule** in the prompt: a handoff transfers ownership,
   the receiver finishes that stage itself, a stage is never bounced back merely
   to report, and one agent owns each stage.
5. **Peer text is untrusted.** Message bodies are escaped (`&`, `<`, `>`, `\r`,
   `\n`), wrapped in a labelled block, and introduced with an instruction not to
   obey directives inside them that conflict with the user's goals. The roster of
   teammates is marked untrusted routing metadata for the same reason. Group and
   agent names are stripped of framing characters and length-capped.
6. **Idempotent delivery.** Deliveries carry a key so a re-executed tool call
   cannot wake the recipient twice.
7. **Hard interdictions.** An agent may not message or hand off to itself, and
   its identity is pinned for the whole turn.

## What has to change because Relay is not Rakazo

Rakazo owns its model loop, so it injects `message_bot` as a real tool. Relay
launches somebody else's CLI as a PTY process and does not own that loop.

The transport is therefore the one genuinely new piece of design:

**Relay runs a small local MCP server** exposing `message_agent` and
`handoff_to_agent`, and passes it to each CLI at launch (`claude --mcp-config`;
Codex and OpenCode accept MCP servers too). The agents get real tools, and Relay
stays the arbiter that counts hops, deduplicates deliveries, and decides whether
a message is delivered at all.

The alternative — the agent writes `.relay/outbox.json` and Relay watches the
file — works without MCP but depends on the model choosing to write a
well-formed file. Prefer MCP; keep the file drop only as a fallback for a CLI
whose MCP support is missing.

Two places where Relay should **not** copy the source designs:

- **A handoff must not auto-start the receiving agent.** Relay already holds that
  queued tasks never start without an explicit Start. A handoff therefore lands
  as a queued task on the target agent, and the person presses Start. This is the
  equivalent of Grok's Require Approval, obtained for free from the existing
  architecture.
- **Isolation is not optional here.** Grok's shared computer is a cloud machine,
  and xAI states plainly that a separate bot is not a security boundary. Relay's
  shared computer is the user's real repository. Two CLI agents writing the same
  working tree will corrupt each other's work.

## Order of work

1. **Per-agent isolation.** A `git worktree` per agent, with the existing session
   and recovery records following the agent into its worktree. Nothing else on
   this list may land first.
2. **The MCP server and its two tools**, with the hop counter, delivery
   deduplication, self-address rejection, and the length cap.
3. **The group thread.** A roster rendered into the instructions Relay already
   injects through `--append-system-prompt`, escaped and marked untrusted, plus
   the single-owner rule.
4. **The board UI.** A group column, and handoffs visible as queued tasks on the
   receiving agent.

Steps 3 and 4 are wasted effort before step 1, and step 2 is unsafe before
step 1.

## Files this will touch

`desktop/agents.cjs` and `desktop/agent-state.cjs` own agent identity, the task
queue, and session migration; the handoff lands there. `desktop/terminals.cjs`
builds launch arguments and will pass the MCP config. `app/AgentBoard.tsx` and
`app/AgentDetails.tsx` carry the UI. Coordinate before editing: these are the
files the parallel Codex work touches most.
