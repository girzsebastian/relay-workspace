const crypto = require("node:crypto");
const codingProviders = new Set(["codex", "claude", "opencode"]);
const providerNames = {
  codex: "Codex",
  claude: "Claude Code",
  opencode: "OpenCode",
};

// One persistent identity owns a conversation's runs, regardless of its visible pane.
function registerSession(data, session) {
  if (!codingProviders.has(session.kind)) return null;
  data.agents ??= [];
  let agent = data.agents.find((a) => a.id === session.agentId);
  if (!agent && session.recoveredFrom) {
    const previous = data.sessions.find((s) => s.id === session.recoveredFrom);
    agent = data.agents.find((a) => a.id === previous?.agentId);
  }
  if (!agent) {
    const names = new Set(
      data.agents
        .filter((a) => a.projectId === session.projectId)
        .map((a) => a.name),
    );
    const base = session.title || providerNames[session.kind];
    let name = base,
      suffix = 2;
    while (names.has(name)) name = `${base} ${suffix++}`;
    agent = {
      id: crypto.randomUUID(),
      projectId: session.projectId,
      provider: session.kind,
      name,
      instructions: session.instructions || "",
      memory: "",
      origin: "terminal",
      createdAt: session.startedAt,
      stage: "ready",
      sessionId: null,
    };
    data.agents.push(agent);
  }
  session.agentId = agent.id;
  // A late exit of an old run must never replace the active session reference.
  const current = data.sessions.find((s) => s.id === agent.sessionId);
  if (
    !current ||
    (current.startedAt <= session.startedAt && current.status !== "running") ||
    current.id === session.id ||
    session.recoveredFrom === current.id ||
    session.status === "running"
  ) {
    agent.sessionId = session.id;
    if (session.status !== "running") agent.stage = "review";
  }
  return agent;
}
function migrateAgents(data) {
  data.agents ??= [];
  data.tasks ??= [];
  for (const agent of data.agents) {
    agent.memory ??= "";
    agent.origin ??= "named";
  }
  for (const session of [...data.sessions].sort(
    (a, b) => a.startedAt - b.startedAt,
  )) {
    // Preserve manually set board stages for existing agent records.
    if (!session.agentId || !data.agents.some((a) => a.id === session.agentId))
      registerSession(data, session);
  }
  for (const task of data.tasks)
    if (task.status === "running" || task.status === "starting") {
      const run = data.sessions.find((s) => s.id === task.sessionId);
      if (!run || run.status !== "running") {
        task.status = "interrupted";
        task.endedAt = run?.endedAt || Date.now();
      }
    }
}
function recordTaskExit(data, session) {
  const task = data.tasks?.find(
    (t) => t.sessionId === session.id || t.id === session.taskId,
  );
  if (task && ["starting", "running"].includes(task.status)) {
    task.sessionId = session.id;
    task.status = session.status === "interrupted" ? "interrupted" : "review";
    task.endedAt = session.endedAt || Date.now();
    task.exitCode = session.exitCode;
  }
}
module.exports = {
  registerSession,
  migrateAgents,
  recordTaskExit,
  codingProviders,
};
