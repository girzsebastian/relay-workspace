const { readableTail } = require("./provider-sessions.cjs");

// What was running when Relay stopped. The records already exist — sessions
// become "interrupted" on startup — but nothing ever told the person, so a
// crash looked like an empty workspace.
function interruptedReport(store, { sessionExists, limit = 40 } = {}) {
  const sessions = store.data.sessions
    .filter(
      (session) => session.status === "interrupted" && !session.dismissedAt,
    )
    .sort((a, b) => (b.endedAt || b.startedAt) - (a.endedAt || a.startedAt))
    .slice(0, limit);
  return sessions.map((session) => {
    const agent = store.data.agents?.find((a) => a.id === session.agentId);
    const task = store.data.tasks?.find((t) => t.id === session.taskId);
    const project = store.data.projects.find((p) => p.id === session.projectId);
    let tail = "";
    try {
      tail = readableTail(store.readLog(session.id), 1200);
    } catch {
      // A missing log only means less detail, not a failure.
    }
    const coding = ["codex", "claude", "opencode"].includes(session.kind);
    return {
      id: session.id,
      kind: session.kind,
      title: session.title,
      projectId: session.projectId,
      project: project?.name || "unknown workspace",
      agentId: session.agentId || null,
      agent: agent?.name || null,
      task: task?.text || session.task || agent?.lastTask || null,
      taskStatus: task?.status || null,
      startedAt: session.startedAt,
      endedAt: session.endedAt || session.heartbeatAt || session.startedAt,
      // Whether the CLI kept its own transcript decides what Recover can do,
      // so the interface can say which of the two will happen.
      resumable: coding
        ? !!sessionExists?.(session.kind, session.providerSessionId)
        : false,
      recoverable:
        coding || session.kind === "shell" || session.kind === "build",
      tail,
      highlight: highlight(tail),
    };
  });
}

// A session whose CLI transcript is gone and whose output is unreadable cannot
// be continued and has nothing to tell anyone. Keeping those piles up dozens of
// identical "Claude Code" rows that only get in the way, so they are retired.
// A coding CLI redraws its screen, and a replayed log of that is a wall of
// interleaved fragments — "xaCalled", "irCalled", "movethe". Length alone does
// not separate it from real history; whole sentences do.
function sentenceLines(tail) {
  return String(tail || "")
    .split("\n")
    .filter((line) => {
      // The CLI status footer repeats on every redraw and describes the
      // interface, not the work.
      if (/shift\+tab|auto mode on|esc to interrupt|\/config\)?$/i.test(line))
        return false;
      if (/^[\u23f5\u23f4\u25b6\u25c0\u276f]/.test(line.trim())) return false;
      // The startup banner is block art, and a progress line is not history.
      if (/[\u2580-\u259f]/.test(line)) return false;
      if (/(?:working|thinking|\u2193\s?[\d.]+k?\s?tokens)/i.test(line))
        return false;
      const words = line
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 1);
      if (words.length < 4) return false;
      // Fragments from a redraw run together; real prose does not.
      const longest = Math.max(...words.map((w) => w.length));
      return longest <= 24;
    });
}
function looksInformative(tail) {
  return sentenceLines(tail).length >= 2;
}
// The most recent lines that actually say something, so nine interrupted runs
// are told apart by their work rather than by an identical status footer.
function highlight(tail) {
  // No fallback to the raw tail: the last line of a redrawn screen is usually
  // "/rc" or a stray number, and a wrong description is worse than none.
  return sentenceLines(tail).filter(Boolean).slice(-3).join("\n").slice(-400);
}

function pruneUnrecoverable(store, { sessionExists } = {}) {
  let removed = 0;
  for (const session of store.data.sessions) {
    if (session.status !== "interrupted" || session.dismissedAt) continue;
    if (!["codex", "claude", "opencode"].includes(session.kind)) continue;
    if (sessionExists?.(session.kind, session.providerSessionId)) continue;
    let tail = "";
    try {
      tail = readableTail(store.readLog(session.id), 400);
    } catch {
      tail = "";
    }
    if (looksInformative(tail)) continue;
    session.dismissedAt = Date.now();
    session.retiredReason = "No transcript to resume and no readable output.";
    removed += 1;
  }
  if (removed) store.save();
  return removed;
}

// One sentence for the banner, so the count is legible before anything opens.
function summarise(report) {
  if (!report.length) return null;
  const agents = report.filter((row) => row.agentId).length;
  const parts = [];
  if (agents) parts.push(`${agents} agent${agents === 1 ? "" : "s"}`);
  const others = report.length - agents;
  if (others) parts.push(`${others} terminal${others === 1 ? "" : "s"}`);
  return `Relay stopped while ${parts.join(" and ")} ${
    report.length === 1 ? "was" : "were"
  } running.`;
}

module.exports = {
  interruptedReport,
  summarise,
  pruneUnrecoverable,
  highlight,
  looksInformative,
};
