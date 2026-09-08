const crypto = require("node:crypto");
const files = require("./files.cjs");

class Agents {
  constructor(store, terminals) {
    this.store = store;
    this.terminals = terminals;
    this.store.data.tasks ??= [];
  }
  get(id) {
    const agent = this.store.data.agents.find((a) => a.id === id);
    if (!agent) throw new Error("Agent not found.");
    return agent;
  }
  create(input) {
    this.store.project(input.projectId);
    const agent = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      stage: "ready",
      sessionId: null,
      memory: "",
      origin: "named",
    };
    this.store.data.agents.push(agent);
    this.store.save();
    return agent;
  }
  update(id, changes) {
    const agent = this.get(id);
    Object.assign(agent, changes, { updatedAt: Date.now() });
    this.store.save();
    return agent;
  }
  queue(id, text) {
    this.get(id);
    const task = {
      id: crypto.randomUUID(),
      agentId: id,
      text,
      status: "queued",
      createdAt: Date.now(),
      sessionId: null,
    };
    this.store.data.tasks.push(task);
    this.store.save();
    return task;
  }
  task(id) {
    const task = this.store.data.tasks.find((t) => t.id === id);
    if (!task) throw new Error("Task not found.");
    return task;
  }
  start(id, text) {
    this.assertIdle(this.get(id));
    const task = this.queue(id, text);
    return this.startTask(task.id);
  }
  assertIdle(agent) {
    if (
      this.store.data.sessions.some(
        (s) => s.agentId === agent.id && this.terminals.running.has(s.id),
      )
    )
      throw new Error(
        "This agent already has a running terminal. Open it to continue or stop it before starting another task.",
      );
  }
  startTask(id) {
    const task = this.task(id),
      agent = this.get(task.agentId),
      project = this.store.project(agent.projectId);
    if (task.status !== "queued")
      throw new Error(
        "Only queued tasks can be started. Add a new task to run this again.",
      );
    this.assertIdle(agent);
    const skill = agent.skillPath
      ? files.skills(project.path).find((s) => s.path === agent.skillPath)
      : null;
    if (agent.skillPath && !skill)
      throw new Error(
        "The selected skill is missing. Restore its SKILL.md before starting this agent.",
      );
    const instructions = [
      `Your agent name is ${agent.name}.`,
      agent.instructions,
      agent.memory ? `Saved agent memory:\n${agent.memory}` : "",
      skill
        ? `Project skill (${skill.path}):\n${skill.content.slice(0, 20000)}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    task.status = "starting";
    task.startedAt = Date.now();
    task.context = {
      instructions: agent.instructions,
      memory: agent.memory || "",
      skillPath: agent.skillPath || null,
    };
    agent.lastTask = task.text;
    agent.stage = "ready";
    this.store.save();
    try {
      const session = this.terminals.start(agent.projectId, agent.provider, {
        agentId: agent.id,
        title: agent.name,
        instructions,
        task: task.text,
        taskId: task.id,
      });
      agent.sessionId = session.id;
      task.sessionId = session.id;
      task.status = session.status === "running" ? "running" : "review";
      this.store.save();
      return session;
    } catch (error) {
      agent.stage = "review";
      task.status = "failed";
      task.error = error.message;
      task.endedAt = Date.now();
      this.store.save();
      throw error;
    }
  }
  resolveTask(id, status) {
    const task = this.task(id);
    if (["running", "starting"].includes(task.status))
      throw new Error("Stop the task's terminal before resolving it.");
    if (status === "cancelled" && task.status !== "queued")
      throw new Error("Only queued tasks can be cancelled.");
    if (
      status === "done" &&
      !["review", "interrupted", "failed"].includes(task.status)
    )
      throw new Error("Only reviewed tasks can be marked done.");
    task.status = status;
    task.endedAt = Date.now();
    this.store.save();
    return task;
  }
  mark(id, stage) {
    const agent = this.get(id);
    if (
      stage === "ready" &&
      this.store.data.sessions.some(
        (s) => s.agentId === agent.id && this.terminals.running.has(s.id),
      )
    )
      throw new Error(
        "Stop the running terminal before marking this agent ready for another task.",
      );
    agent.stage = stage;
    this.store.save();
    return agent;
  }
}
module.exports = { Agents };
