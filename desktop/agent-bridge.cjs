const http = require("node:http");
const crypto = require("node:crypto");

// Relay lends the agent its own terminals. The agent cannot spawn processes on
// its own — it asks Relay, Relay starts a real PTY the person can see, and the
// agent may only read what comes back. That is why an agent terminal is
// read-only: the process belongs to the workspace, not to the run.
class AgentBridge {
  constructor(store, terminals, publish, approvals) {
    this.approvals = approvals;
    this.store = store;
    this.terminals = terminals;
    this.publish = publish;
    this.token = crypto.randomBytes(24).toString("hex");
    this.server = null;
    this.port = null;
  }
  async start() {
    if (this.server) return this.address();
    this.server = http.createServer((request, response) =>
      this.handle(request, response),
    );
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      // Loopback only, on a port the operating system picks. Nothing outside
      // this machine can reach it, and the token is generated per launch.
      this.server.listen(0, "127.0.0.1", resolve);
    });
    this.port = this.server.address().port;
    return this.address();
  }
  address() {
    return { url: `http://127.0.0.1:${this.port}`, token: this.token };
  }
  stop() {
    this.server?.close();
    this.server = null;
  }
  async handle(request, response) {
    const send = (status, body) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.headers.authorization !== `Bearer ${this.token}`)
      return send(401, { error: "Unauthorized." });
    let raw = "";
    for await (const chunk of request) {
      raw += chunk;
      if (raw.length > 200000)
        return send(413, { error: "Request too large." });
    }
    let input;
    try {
      input = raw ? JSON.parse(raw) : {};
    } catch {
      return send(400, { error: "Malformed request." });
    }
    try {
      send(200, await this.call(request.url.replace(/^\//, ""), input));
    } catch (error) {
      send(200, { error: String(error.message).slice(0, 500) });
    }
  }
  async call(name, input) {
    if (name === "request_approval") return this.requestApproval(input);
    if (name === "start_terminal") return this.startTerminal(input);
    if (name === "read_terminal") return this.readTerminal(input);
    if (name === "list_terminals") return this.listTerminals(input);
    if (name === "stop_terminal") return this.stopTerminal(input);
    throw new Error(`Unknown tool ${name}.`);
  }
  // Claude Code asks this before running anything it is not already allowed
  // to run. Relay turns the question into a card in the interface and waits
  // for a person, which is the approval surface the run otherwise lacks.
  async requestApproval({ runId, tool, input, reason }) {
    if (!this.approvals)
      return {
        behavior: "deny",
        message: "Relay cannot ask anyone right now.",
      };
    const run = this.runs?.get(runId);
    const decision = await this.approvals.request(
      {
        runId,
        projectId: run?.projectId || this.store.data.ui.projectId,
        chatId: run?.chatId,
        agentId: run?.agentId,
        provider: run?.provider,
        signal: run?.signal,
      },
      String(tool || "unknown"),
      input ?? {},
      { reason: reason || undefined },
    );
    return decision === "accept"
      ? { behavior: "allow" }
      : { behavior: "deny", message: "You declined this action in Relay." };
  }
  // A run registers itself so an approval card can say which chat it came
  // from, and so cancelling the chat also cancels the question.
  register(runId, context) {
    this.runs ??= new Map();
    this.runs.set(runId, context);
    return () => this.runs.delete(runId);
  }
  project(projectId) {
    const project = projectId
      ? this.store.data.projects.find((p) => p.id === projectId)
      : this.store.data.projects.find(
          (p) => p.id === this.store.data.ui.projectId,
        ) || this.store.data.projects[0];
    if (!project) throw new Error("No workspace is open in Relay.");
    return project;
  }
  startTerminal({ command, name, projectId }) {
    if (!String(command || "").trim())
      throw new Error("A command is required.");
    const project = this.project(projectId);
    const session = this.terminals.start(project.id, "build", {
      command,
      title: name || command.slice(0, 60),
      agentOwned: true,
    });
    this.publish?.("changed");
    return {
      id: session.id,
      project: project.name,
      note: "Started in Relay. It keeps running after this reply; read it with read_terminal.",
    };
  }
  // Waiting for a pattern is what makes a dev server usable: the agent asks for
  // the line that proves it is up, rather than guessing how long to sleep.
  async readTerminal({ id, pattern, timeoutMs = 60000, tail = 4000 }) {
    const session = this.store.data.sessions.find((s) => s.id === id);
    if (!session) throw new Error("No such terminal.");
    const limit = Math.min(Math.max(Number(timeoutMs) || 0, 0), 180000);
    const deadline = Date.now() + limit;
    const matcher = pattern ? new RegExp(pattern, "i") : null;
    for (;;) {
      let text = "";
      try {
        text = this.store.readLog(id) || "";
      } catch {
        text = "";
      }
      const running = this.terminals.running.has(id);
      if (!matcher || matcher.test(text) || !running || Date.now() >= deadline)
        return {
          id,
          running,
          matched: matcher ? matcher.test(text) : null,
          output: text.slice(
            -Math.min(Math.max(Number(tail) || 0, 200), 20000),
          ),
        };
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  listTerminals({ projectId }) {
    const project = this.project(projectId);
    return {
      terminals: this.store.data.sessions
        .filter((s) => s.projectId === project.id && !s.dismissedAt)
        .slice(-25)
        .map((s) => ({
          id: s.id,
          title: s.title,
          kind: s.kind,
          status: s.status,
          running: this.terminals.running.has(s.id),
          agentOwned: !!s.agentOwned,
        })),
    };
  }
  stopTerminal({ id }) {
    const session = this.store.data.sessions.find((s) => s.id === id);
    if (!session) throw new Error("No such terminal.");
    // An agent may only stop what an agent started.
    if (!session.agentOwned)
      throw new Error("That terminal was not started by an agent.");
    this.terminals.stop(id);
    this.publish?.("changed");
    return { id, stopped: true };
  }
}

module.exports = { AgentBridge };
