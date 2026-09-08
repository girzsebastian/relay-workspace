const crypto = require("node:crypto");
const files = require("./files.cjs");

class Agents {
  constructor(store, terminals) {
    this.store = store;
    this.terminals = terminals;
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
    };
    this.store.data.agents.push(agent);
    this.store.save();
    return agent;
  }
  start(id, task) {
    const agent = this.get(id),
      project = this.store.project(agent.projectId);
    if (agent.sessionId && this.terminals.running.has(agent.sessionId))
      throw new Error(
        "This agent already has a running terminal. Open it to continue or stop it before starting another task.",
      );
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
      skill
        ? `Project skill (${skill.path}):\n${skill.content.slice(0, 20000)}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    agent.lastTask = task;
    agent.stage = "ready";
    try {
      const session = this.terminals.start(agent.projectId, agent.provider, {
        agentId: agent.id,
        title: agent.name,
        instructions,
        task,
      });
      agent.sessionId = session.id;
      this.store.save();
      return session;
    } catch (error) {
      agent.stage = "review";
      this.store.save();
      throw error;
    }
  }
  mark(id, stage) {
    const agent = this.get(id);
    if (
      stage === "ready" &&
      agent.sessionId &&
      this.terminals.running.has(agent.sessionId)
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
