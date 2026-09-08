# Rakazo assessment

Reviewed September 8, 2026: [website](https://rakazo.com/), [repository and README](https://github.com/elie222/rakazo), [computer runtime documentation](https://github.com/elie222/rakazo/blob/main/docs/computer-runtime.md), and [license](https://github.com/elie222/rakazo/blob/main/LICENSE).

Rakazo is broader than a set of terminal panes: its documented design includes persistent bot identities, conversations, memory, routines, tools, and computer access. It separates the agent runtime from the computer runtime. A bot can retain identity/history while a computer provider owns the environment used by its tools. Its repository describes a React/Electron client and a backend stack that includes Postgres, Prisma, Hono, and Graphile Worker. It offers local and sandbox computer providers; a full local deployment involves more infrastructure than Relay's desktop app.

That separation is a useful design reference. Relay 0.2 introduces named agents with saved instructions, optional project skills, and linked CLI sessions. The board displays real process state, run count, elapsed time, and manual review flags. Agents are distinct from terminal tiles: hiding a tile does not destroy its process or identity. Explicit recovery creates a new run and links it back to the same agent.

Relay does not embed Rakazo or copy its source. Its repository currently uses Apache-2.0; adopting code later would require preserving the applicable license and notices. We chose independent implementation because Relay's immediate need is local CLI continuity and a desktop IDE layout. Pulling in the complete backend would expand deployment and operational requirements before those features are needed.

Not implemented from Rakazo: autonomous routines, durable long-running job queues, browser/computer tools, Pi runtime integration, shared team computers, per-bot sandbox providers, remote execution, or semantic task-state detection. Current Relay agents use the user's installed official CLIs and their approval flows. Multiple agents in one project share files; they are not isolated workers.

A future integration should introduce an AgentRuntime adapter independently of a ComputerRuntime adapter, and add per-agent git worktrees plus approval/event contracts before unattended concurrent editing. Any provider connection must use its documented interfaces; existing subscriptions cannot be treated as interchangeable API credit.
