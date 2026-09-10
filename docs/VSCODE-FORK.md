# Should Relay fork VS Code?

Written September 8, 2026, after the question was raised directly.

## The factual position

Cursor is a fork of VS Code. VS Code's source is MIT-licensed and published as
Code – OSS; Cursor builds on that base and adds its own product on top. This is
why a Cursor window can still open a tab literally titled "VS Code Settings":
the underlying workbench is still there. VSCodium is another fork of the same
base.

The MIT licence permits this. Forking is legal, and it is a well-trodden path.

## What a fork is not

Code – OSS cannot be added to Relay. It is not a library; it is the entire
application, with its own build system, its own extension host, its own process
model, and a codebase in the millions of lines. A fork means starting from their
repository and porting Relay's features into it. The direction of travel is the
opposite of what "let's implement it in Relay" suggests.

So this is not an incremental step. It is a decision to restart the product on a
different foundation.

## What a fork would actually give us

Real, and not small:

- File search, including the include/exclude and regex behaviour.
- Git decorations, diff editors, and the source control panel.
- The settings infrastructure: schema, search, user/workspace scopes.
- The extension marketplace ecosystem and the Dev Containers tooling.
- Years of accumulated editor behaviour Relay would otherwise reimplement.

## What a fork would not give us

This is the part that decides the question.

**The agent chat is not in VS Code.** The panel that matters most here — the
conversation with rendered markdown, the inline diff with Keep and Undo, the
"1 File · .env +5 -5" card, the Agent/Plan/Debug/Ask modes — is Cursor's own
work, built on top of the fork. None of it comes free. Forking moves the
starting line for the editor shell; it does not move it for the feature that
prompted this whole conversation.

Nor does a fork give us Relay's own reason to exist: multiple official CLI
agents running as first-class, recoverable sessions across projects. That code
would have to be ported into an unfamiliar architecture.

## The costs, stated plainly

- The port is not a weekend. Relay's PTY ownership, agent identity, task queue,
  and recovery model would all have to be re-expressed as VS Code contributions
  or as a custom workbench layer.
- A fork inherits a large upstream. Staying current with Code – OSS is ongoing
  work, and every local modification makes merges harder.
- The product becomes "a VS Code variant". That is a crowded description, and it
  is the opposite of the positioning Relay currently has.
- Everything shipped in Relay so far — CLI-backed chat, the agent board, session
  recovery, the panels added today — would need to be rebuilt or wrapped.

## Recommendation

**Do not fork now.** Fork only if the goal changes from "a workbench for running
CLI agents" to "a full IDE".

The reasoning is narrow and practical: the four capabilities that motivated the
question — search, git decorations, source control, structured settings — are
now implemented in Relay, verified, and cost a few hundred lines each. They were
the cheap part. The expensive part is the agent chat, and a fork does not help
with it at all.

Revisit this decision if any of these become true:

1. We need the extension marketplace as a product feature, not a convenience.
2. We need a real language-server and debugger experience, not editing plus
   syntax colour.
3. Editor-shell work starts consuming more time than agent work does.

Until then, the correct next investment is the structured agent session — running
each agent through its CLI's streaming JSON output instead of a raw PTY, so the
conversation can be rendered properly and file changes can be offered as Keep,
Undo, or Review against git. That is the same amount of work in a fork as it is
here, and here it builds on the code we already own.
