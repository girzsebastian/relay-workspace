const crypto = require("node:crypto");

// Decisions belong to one live request. Restart/cancellation invalidates them;
// a stale button cannot authorize a later run with the same command text.
class Approvals {
  constructor(store, publish) {
    this.store = store;
    this.publish = publish;
    this.pending = new Map();
    store.data.approvals ??= [];
    for (const item of store.data.approvals)
      if (item.status === "pending") {
        item.status = "cancelled";
        item.endedAt = Date.now();
      }
    store.data.executionRules ??= [];
  }
  key(context, tool, input) {
    return JSON.stringify([context.projectId, context.provider, tool, input]);
  }
  request(
    context,
    tool,
    input,
    {
      reason = "This action needs your approval.",
      force = false,
      canRemember = true,
    } = {},
  ) {
    if (context.signal?.aborted) return Promise.resolve("skip");
    const key = this.key(context, tool, input);
    if (
      !force &&
      canRemember &&
      this.store.data.executionRules.some((r) => r.key === key)
    )
      return Promise.resolve("accept");
    const item = {
      id: crypto.randomUUID(),
      runId: context.runId,
      projectId: context.projectId,
      chatId: context.chatId,
      agentId: context.agentId,
      provider: context.provider,
      tool,
      input,
      reason,
      canRemember,
      createdAt: Date.now(),
      status: "pending",
    };
    this.store.data.approvals.push(item);
    this.store.data.approvals = this.store.data.approvals
      .filter(
        (a) =>
          a.status === "pending" || a.createdAt > Date.now() - 7 * 86400000,
      )
      .slice(-500);
    return new Promise((resolve) => {
      const abort = () => this.resolve(item.id, "skip", "cancelled");
      const timer = setTimeout(abort, 15 * 60000);
      timer.unref?.();
      this.pending.set(item.id, { resolve, context, key, abort, timer });
      context.signal?.addEventListener("abort", abort, { once: true });
      this.store.save();
      this.publish("changed");
    });
  }
  resolve(id, decision, status) {
    if (!["accept", "skip", "remember"].includes(decision))
      throw new Error("Unknown approval decision.");
    const request = this.pending.get(id);
    const item = this.store.data.approvals.find((a) => a.id === id);
    if (!request || !item || item.status !== "pending")
      throw new Error("This approval is no longer pending.");
    if (decision === "remember" && !item.canRemember)
      throw new Error("This action can only be approved once.");
    this.pending.delete(id);
    clearTimeout(request.timer);
    request.context.signal?.removeEventListener("abort", request.abort);
    item.status = status || (decision === "skip" ? "denied" : "approved");
    item.endedAt = Date.now();
    if (
      decision === "remember" &&
      !this.store.data.executionRules.some((r) => r.key === request.key)
    )
      this.store.data.executionRules.push({
        id: crypto.randomUUID(),
        key: request.key,
        projectId: item.projectId,
        tool: item.tool,
        input: item.input,
        createdAt: Date.now(),
      });
    this.store.save();
    this.publish("changed");
    request.resolve(decision === "skip" ? "skip" : "accept");
    return item;
  }
  cancelRun(runId) {
    for (const [id, value] of [...this.pending])
      if (value.context.runId === runId) this.resolve(id, "skip", "cancelled");
  }
  shutdown() {
    for (const id of [...this.pending.keys()])
      this.resolve(id, "skip", "cancelled");
  }
}
module.exports = { Approvals };
