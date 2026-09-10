const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { registerSession, recordTaskExit } = require("./agent-state.cjs");
const {
  providerSessionExists,
  readableTail,
  recoveredContext,
} = require("./provider-sessions.cjs");

function environment() {
  const env = { ...process.env, TERM: "xterm-256color" };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CLAUDECODE;
  // npm's launcher metadata conflicts with nvm when opening a login shell.
  for (const key of Object.keys(env)) if (/^npm_/i.test(key)) delete env[key];
  if (process.platform !== "win32")
    env.PATH = [
      path.join(os.homedir(), ".local/bin"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      env.PATH,
    ]
      .filter(Boolean)
      .join(path.delimiter);
  return env;
}
function nativeLaunchSpec(spec, platform = process.platform) {
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(spec.file)) return spec;
  const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
  return {
    file: "powershell.exe",
    args: [
      "-NoLogo",
      "-NoProfile",
      "-Command",
      `& ${[spec.file, ...spec.args].map(literal).join(" ")}`,
    ],
  };
}
function executable(name, env = environment()) {
  const extensions =
    process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of (env.PATH || env.Path || "").split(path.delimiter))
    for (const ext of extensions) {
      const file = path.join(dir, name + ext);
      try {
        fs.accessSync(
          file,
          process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK,
        );
        if (fs.statSync(file).isFile()) return file;
      } catch {}
    }
  return null;
}
function launchSpec(kind, options = {}, platform = process.platform) {
  const shell =
    platform === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/zsh";
  if (kind === "shell")
    return { file: shell, args: platform === "win32" ? ["-NoLogo"] : ["-l"] };
  if (kind === "build")
    return {
      file: shell,
      args:
        platform === "win32"
          ? ["-NoLogo", "-NoProfile", "-Command", options.command]
          : ["-lc", options.command],
    };
  if (kind === "claude")
    return {
      file: "claude",
      args: options.recover
        ? ["--resume", options.providerSessionId]
        : [
            "--session-id",
            options.providerSessionId,
            ...(options.model ? ["--model", options.model] : []),
            ...(options.instructions
              ? ["--append-system-prompt", options.instructions]
              : []),
            ...(options.task ? [options.task] : []),
          ],
    };
  if (kind === "codex")
    return {
      file: "codex",
      args: options.recover
        ? [
            "resume",
            ...(options.providerSessionId ? [options.providerSessionId] : []),
          ]
        : options.task
          ? [
              ...(options.model ? ["-m", options.model] : []),
              [options.instructions, options.task]
                .filter(Boolean)
                .join("\n\nTask:\n"),
            ]
          : [],
    };
  if (kind === "opencode") {
    if (options.recover && !options.providerSessionId)
      throw new Error(
        "Link an OpenCode session ID before recovering. Find the ID with opencode session list in a shell.",
      );
    return {
      file: "opencode",
      args: options.recover
        ? ["--session", options.providerSessionId]
        : options.task
          ? [
              ...(options.model ? ["-m", options.model] : []),
              "--prompt",
              [options.instructions, options.task]
                .filter(Boolean)
                .join("\n\nTask:\n"),
            ]
          : [],
    };
  }
  throw new Error("Unsupported terminal type.");
}
class Terminals {
  constructor(store, publish, pty, options = {}) {
    this.store = store;
    this.publish = publish;
    this.pty = pty;
    this.resolveExecutable = options.resolveExecutable || executable;
    this.sessionExists = options.sessionExists || providerSessionExists;
    this.running = new Map();
    this.heartbeat = setInterval(() => {
      if (this.running.size) {
        for (const id of this.running.keys())
          store.session(id).heartbeatAt = Date.now();
        store.save();
        this.publish("changed");
      }
    }, 5000);
    this.heartbeat.unref();
  }
  start(projectId, kind, options = {}) {
    const project = this.store.project(projectId);
    if (this.running.size >= 24)
      throw new Error(
        "Close a terminal before opening more (24 active maximum).",
      );
    if (!fs.statSync(project.path).isDirectory())
      throw new Error("Project folder is unavailable.");
    if (kind === "claude" && !options.providerSessionId)
      options.providerSessionId = crypto.randomUUID();
    const spec = launchSpec(kind, options);
    if (["codex", "claude", "opencode"].includes(kind)) {
      const found = this.resolveExecutable(spec.file);
      if (!found)
        throw new Error(
          `Install ${spec.file} and sign in using its official CLI first, then reopen Relay.`,
        );
      spec.file = found;
    }
    const record = {
      id: crypto.randomUUID(),
      projectId,
      kind,
      title:
        kind === "build"
          ? options.command
          : {
              shell: "Terminal",
              codex: "Codex",
              claude: "Claude Code",
              opencode: "OpenCode",
            }[kind],
      status: "running",
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
      ...options,
    };
    const task = this.store.data.tasks?.find((t) => t.id === record.taskId);
    if (task) {
      task.sessionId = record.id;
      task.status = "running";
    }
    this.store.data.sessions.push(record);
    const owner =
      registerSession(this.store.data, record) ||
      this.store.data.agents?.find((a) => a.id === record.agentId);
    if (owner) {
      owner.sessionId = record.id;
      owner.stage = "ready";
    }
    this.store.save();
    try {
      const native = nativeLaunchSpec(spec);
      const child = this.pty.spawn(native.file, native.args, {
        name: "xterm-256color",
        cols: 100,
        rows: 28,
        cwd: project.path,
        env: environment(),
      });
      this.running.set(record.id, child);
      child.onData((data) => {
        record.lastOutputAt = Date.now();
        const bucket = Math.floor(record.lastOutputAt / 5000) * 5000;
        record.activity ??= [];
        if (record.activity.at(-1)?.at !== bucket)
          record.activity.push({ at: bucket, bytes: 0 });
        record.activity.at(-1).bytes += Buffer.byteLength(data);
        record.activity = record.activity
          .filter((p) => p.at >= bucket - 115000)
          .slice(-24);
        record.sequence = (record.sequence || 0) + 1;
        try {
          this.store.appendLog(record.id, data);
        } catch (error) {
          this.publish("error", {
            message: `Terminal history could not be saved: ${error.message}`,
          });
        }
        this.publish("terminal-data", {
          id: record.id,
          data,
          sequence: record.sequence,
        });
      });
      child.onExit(({ exitCode }) => {
        this.running.delete(record.id);
        record.endedAt = Date.now();
        record.exitCode = exitCode;
        if (record.status === "running")
          record.status = exitCode === 0 ? "completed" : "failed";
        const agent = this.store.data.agents?.find(
          (a) => a.id === record.agentId && a.sessionId === record.id,
        );
        if (agent) agent.stage = "review";
        recordTaskExit(this.store.data, record);
        this.store.save();
        this.publish("changed");
      });
    } catch (error) {
      if (owner) owner.stage = "review";
      record.status = "failed";
      record.endedAt = Date.now();
      recordTaskExit(this.store.data, record);
      this.store.save();
      throw error;
    }
    this.publish("changed");
    return record;
  }
  recover(id) {
    const old = this.store.session(id);
    if (this.running.has(id)) return old;
    const existing = this.store.data.sessions.find(
      (s) => s.recoveredFrom === id && this.running.has(s.id),
    );
    if (existing) return existing;
    const owner = this.store.data.agents?.find((a) => a.id === old.agentId);
    if (owner?.sessionId && this.running.has(owner.sessionId))
      throw new Error(
        "This agent has another running session. Stop it before recovering earlier work.",
      );
    const task = this.store.data.tasks?.find(
      (t) =>
        t.id === old.taskId && ["review", "interrupted"].includes(t.status),
    );
    const coding = ["codex", "claude", "opencode"].includes(old.kind);
    // Resuming a session the CLI never wrote fails inside the PTY. When the
    // history is gone, start a fresh one carrying the context Relay did keep.
    const resumable =
      coding && this.sessionExists(old.kind, old.providerSessionId);
    return this.start(old.projectId, old.kind, {
      ...(task ? { taskId: task.id } : {}),
      command: old.command,
      ...(resumable ? { providerSessionId: old.providerSessionId } : {}),
      recover: resumable,
      recoveredFrom: id,
      ...(coding && !resumable
        ? {
            historyLost: true,
            instructions: this.recoveredInstructions(old, task),
            ...(task?.text ? { task: task.text } : {}),
          }
        : {}),
      ...(old.agentId ? { agentId: old.agentId, title: old.title } : {}),
    });
  }
  recoveredInstructions(session, task) {
    const agent = this.store.data.agents?.find((a) => a.id === session.agentId);
    let log = "";
    try {
      log = readableTail(this.store.readLog(session.id));
    } catch {
      // A missing or unreadable log only means less context, not a failure.
    }
    return recoveredContext({
      agent,
      task: task?.text || session.task,
      log,
    });
  }
  dismiss(id) {
    const session = this.store.session(id);
    if (this.running.has(id))
      throw new Error(
        "Stop this terminal before removing it from the session list.",
      );
    session.dismissedAt = Date.now();
    this.store.save();
    this.publish("changed");
    return session;
  }
  write(id, data) {
    const p = this.running.get(id);
    if (!p) throw new Error("Terminal is no longer running.");
    p.write(data);
  }
  resize(id, cols, rows) {
    this.running.get(id)?.resize(cols, rows);
  }
  stop(id) {
    const p = this.running.get(id);
    if (p) {
      const s = this.store.session(id);
      s.status = "stopped";
      s.endedAt = Date.now();
      this.store.save();
      p.kill();
    }
  }
  shutdown() {
    clearInterval(this.heartbeat);
    for (const [id, p] of this.running) {
      const s = this.store.session(id);
      s.status = "interrupted";
      s.endedAt = Date.now();
      recordTaskExit(this.store.data, s);
      p.kill();
    }
    this.store.save();
  }
}
module.exports = {
  Terminals,
  launchSpec,
  executable,
  nativeLaunchSpec,
  environment,
};
