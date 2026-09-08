const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { migrateAgents } = require("./agent-state.cjs");

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, value);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, file);
}
function initialState() {
  return {
    version: 1,
    projects: [],
    sessions: [],
    chats: [],
    usage: [],
    agents: [],
    tasks: [],
    settings: { provider: "openai", models: { openai: "", anthropic: "" } },
    ui: {
      view: "overview",
      projectId: null,
      chatId: null,
      sessionId: null,
      theme: "dark",
      terminalLayout: 4,
      editorTerminalLayout: 1,
      gridSessionIds: [],
      gridScope: "all",
    },
  };
}
class Store {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, "workspace.json");
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.file)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      } catch {
        throw new Error(
          `Workspace data could not be read. Original preserved at ${this.file}. Restore workspace.backup.json to recover.`,
        );
      }
      if (
        this.data.version !== 1 ||
        !["projects", "sessions", "chats", "usage"].every((k) =>
          Array.isArray(this.data[k]),
        )
      )
        throw new Error(
          "Unsupported workspace format; original data preserved.",
        );
      // The last heartbeat bounds interrupted runtime; downtime is never counted.
      for (const session of this.data.sessions)
        if (session.status === "running") {
          session.status = "interrupted";
          session.endedAt = session.heartbeatAt || session.startedAt;
        }
      for (const chat of this.data.chats)
        if (chat.status === "running") {
          chat.status = "interrupted";
          chat.error =
            "The app stopped before the reply was saved. Provider usage for that request is unknown.";
        }
    } else this.data = initialState();
    migrateAgents(this.data);
    this.data.ui = { ...initialState().ui, ...this.data.ui };
    if (this.data.ui.view === "overview") this.data.ui.view = "workspace";
    for (const project of this.data.projects)
      project.editor ??= {
        tabs: project.draft ? [project.draft] : [],
        primary: project.draft?.path || null,
        secondary: null,
        focusedPane: 1,
      };
    for (const agent of this.data.agents) {
      const last = this.data.sessions.find((s) => s.id === agent.sessionId);
      if (last?.status === "interrupted") agent.stage = "review";
    }
    this.save();
  }
  save() {
    if (fs.existsSync(this.file))
      atomicWrite(
        path.join(this.directory, "workspace.backup.json"),
        fs.readFileSync(this.file),
      );
    atomicWrite(this.file, JSON.stringify(this.data, null, 2));
  }
  project(id) {
    const p = this.data.projects.find((p) => p.id === id);
    if (!p) throw new Error("Project not found.");
    return p;
  }
  session(id) {
    const s = this.data.sessions.find((s) => s.id === id);
    if (!s) throw new Error("Terminal not found.");
    return s;
  }
  chat(id) {
    const c = this.data.chats.find((c) => c.id === id);
    if (!c) throw new Error("Conversation not found.");
    return c;
  }
  logFile(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid terminal ID");
    return path.join(this.directory, "logs", `${id}.log`);
  }
  appendLog(id, data) {
    const file = this.logFile(id);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.appendFileSync(file, data, { mode: 0o600 });
    if (fs.statSync(file).size > 1024 * 1024)
      atomicWrite(file, fs.readFileSync(file).subarray(-512 * 1024));
  }
  readLog(id) {
    const f = this.logFile(id);
    return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  }
}
module.exports = { Store, atomicWrite, initialState };
