const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Store } = require("../desktop/store.cjs");
const files = require("../desktop/files.cjs");
const { launchSpec, Terminals } = require("../desktop/terminals.cjs");
const { nativeLaunchSpec, environment } = require("../desktop/terminals.cjs");
const { complete, parseResponse } = require("../desktop/providers.cjs");
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test("Windows npm launchers preserve literal paths and shell environment drops npm metadata", () => {
  const spec = nativeLaunchSpec(
    { file: "C:\\Users\\O'Brien & Co\\codex.cmd", args: ["resume", "exact"] },
    "win32",
  );
  assert.equal(spec.file, "powershell.exe");
  assert.equal(
    spec.args.at(-1),
    "& 'C:\\Users\\O''Brien & Co\\codex.cmd' 'resume' 'exact'",
  );
  assert.equal(
    Object.keys(environment()).some((k) => /^npm_/i.test(k)),
    false,
  );
});

test("restart preserves conversations and drafts; interrupted builds exclude downtime", (t) => {
  const dir = temp(t),
    first = new Store(dir);
  first.data.projects.push({
    id: "p",
    name: "example",
    path: dir,
    draft: { content: "unsaved work" },
  });
  first.data.sessions.push({
    id: "s",
    projectId: "p",
    status: "running",
    startedAt: 1000,
    heartbeatAt: 61000,
    kind: "build",
  });
  first.data.chats.push({
    id: "c",
    projectId: "p",
    status: "running",
    messages: [{ content: "Keep this thought" }],
  });
  first.save();
  const second = new Store(dir);
  assert.equal(second.data.sessions[0].status, "interrupted");
  assert.equal(second.data.sessions[0].endedAt, 61000);
  assert.equal(second.data.chats[0].messages[0].content, "Keep this thought");
  assert.equal(second.data.chats[0].status, "interrupted");
  assert.equal(second.data.projects[0].draft.content, "unsaved work");
  assert.ok(fs.existsSync(path.join(dir, "workspace.backup.json")));
});
test("corrupt workspace is preserved instead of silently overwritten", (t) => {
  const dir = temp(t);
  fs.writeFileSync(path.join(dir, "workspace.json"), "{broken");
  assert.throws(() => new Store(dir), /Original preserved/);
  assert.equal(
    fs.readFileSync(path.join(dir, "workspace.json"), "utf8"),
    "{broken",
  );
});
test("editor rejects traversal and symlink escapes", (t) => {
  const dir = temp(t),
    project = path.join(dir, "project");
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(dir, "outside.txt"), "private");
  assert.throws(() => files.readFile(project, "../outside.txt"), /outside/);
  assert.throws(
    () => files.readFile(project, path.join(dir, "outside.txt")),
    /relative/,
  );
  if (process.platform !== "win32") {
    fs.symlinkSync(path.join(dir, "outside.txt"), path.join(project, "escape"));
    assert.throws(() => files.readFile(project, "escape"), /outside/);
  }
});
test("editor refuses to overwrite concurrent changes, and preserves executable mode", (t) => {
  const dir = temp(t),
    target = path.join(dir, "build.sh");
  fs.writeFileSync(target, "old", { mode: 0o755 });
  const original = files.readFile(dir, "build.sh");
  fs.writeFileSync(target, "external change");
  assert.throws(
    () => files.writeFile(dir, "build.sh", "mine", original.hash),
    /changed on disk/,
  );
  assert.equal(fs.readFileSync(target, "utf8"), "external change");
  const newer = files.readFile(dir, "build.sh");
  files.writeFile(dir, "build.sh", "saved", newer.hash);
  assert.equal(fs.readFileSync(target, "utf8"), "saved");
  if (process.platform !== "win32")
    assert.equal(fs.statSync(target).mode & 0o777, 0o755);
});
test("terminal history survives a new store and remains bounded", (t) => {
  const dir = temp(t),
    store = new Store(dir),
    id = "11111111-1111-4111-8111-111111111111";
  store.appendLog(id, "x".repeat(1100000) + "history-end");
  assert.ok(fs.statSync(store.logFile(id)).size <= 512 * 1024);
  assert.ok(new Store(dir).readLog(id).endsWith("history-end"));
  assert.throws(() => store.logFile("../workspace.json"), /Invalid/);
});
test("recovery targets exact Claude ID and never guesses latest Codex session", () => {
  assert.deepEqual(
    launchSpec("claude", { recover: true, providerSessionId: "exact" }).args,
    ["--resume", "exact"],
  );
  assert.deepEqual(launchSpec("codex", { recover: true }).args, ["resume"]);
  assert.deepEqual(
    launchSpec("codex", { recover: true, providerSessionId: "exact" }).args,
    ["resume", "exact"],
  );
  assert.deepEqual(launchSpec("build", { command: "npm run build" }, "win32"), {
    file: "powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-Command", "npm run build"],
  });
});
test("terminal lifecycle records exit status and recovery creates a distinct run", (t) => {
  const dir = temp(t),
    store = new Store(dir);
  store.data.projects.push({ id: "p", path: dir });
  let onExit, onData;
  const fake = {
    spawn: () => ({
      onData: (f) => {
        onData = f;
      },
      onExit: (f) => {
        onExit = f;
      },
      kill: () => {},
      write: () => {},
      resize: () => {},
    }),
  };
  const manager = new Terminals(store, () => {}, fake);
  t.after(() => manager.shutdown());
  const s = manager.start("p", "build", { command: "echo hello" });
  onData("hello");
  onExit({ exitCode: 7 });
  assert.equal(s.status, "failed");
  assert.equal(s.exitCode, 7);
  assert.equal(store.readLog(s.id), "hello");
  const recovered = manager.recover(s.id);
  assert.notEqual(recovered.id, s.id);
  assert.equal(recovered.recoveredFrom, s.id);
  assert.equal(recovered.command, s.command);
});
test("provider accounting preserves cache semantics and missing usage", () => {
  const openai = parseResponse("openai", {
    output: [{ content: [{ type: "output_text", text: "Hello" }] }],
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      input_tokens_details: { cached_tokens: 70 },
    },
  });
  assert.equal(openai.text, "Hello");
  assert.equal(openai.usage.input, 100);
  assert.equal(openai.usage.cacheRead, 70);
  const claude = parseResponse("anthropic", {
    content: [{ type: "text", text: "Hi" }],
    usage: {
      input_tokens: 5,
      output_tokens: 8,
      cache_read_input_tokens: 90,
      cache_creation_input_tokens: 10,
    },
  });
  assert.equal(claude.usage.cacheWrite, 10);
  assert.equal(claude.usage.input, 5);
  assert.equal(parseResponse("openai", {}).usage, null);
});
test("API requests use fixed official endpoints and preserve conversation history", async () => {
  let sent;
  await complete(
    {
      provider: "anthropic",
      model: "example-model",
      role: "reviewer",
      skill: "Check invariants",
      key: "secret",
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
        { role: "user", content: "continue" },
      ],
    },
    async (url, req) => {
      sent = { url, ...req };
      return {
        ok: true,
        json: async () => ({ content: [{ type: "text", text: "done" }] }),
      };
    },
  );
  assert.equal(sent.url, "https://api.anthropic.com/v1/messages");
  assert.equal(sent.headers["x-api-key"], "secret");
  const body = JSON.parse(sent.body);
  assert.equal(body.messages.length, 3);
  assert.match(body.system, /Check invariants/);
});
test("provider failures redact the supplied key from errors", async () => {
  await assert.rejects(
    complete(
      {
        provider: "openai",
        model: "example",
        messages: [],
        role: "builder",
        key: "super-secret",
      },
      async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: "bad super-secret" } }),
      }),
    ),
    (error) =>
      error.message.includes("[redacted]") &&
      !error.message.includes("super-secret"),
  );
});

test("legacy workspaces migrate to file tabs without discarding drafts or layout", (t) => {
  const dir = temp(t),
    first = new Store(dir);
  delete first.data.agents;
  first.data.ui = { view: "overview", explorerWidth: 270, showChat: false };
  first.data.projects.push({
    id: "p",
    path: dir,
    draft: {
      path: "app.ts",
      content: "unsaved",
      hash: "a".repeat(64),
      dirty: true,
    },
  });
  first.save();
  const second = new Store(dir);
  assert.deepEqual(second.data.projects[0].editor.tabs, [
    first.data.projects[0].draft,
  ]);
  assert.equal(second.data.projects[0].editor.primary, "app.ts");
  assert.equal(second.data.ui.view, "workspace");
  assert.equal(second.data.ui.showChat, false);
  assert.equal(second.data.ui.explorerWidth, 270);
  second.data.projects[0].editor.tabs.push({
    path: "README.md",
    content: "other draft",
    hash: "b".repeat(64),
    dirty: true,
  });
  second.data.projects[0].editor.secondary = "README.md";
  second.data.ui.splitEditor = true;
  second.save();
  const third = new Store(dir);
  assert.deepEqual(
    third.data.projects[0].editor,
    second.data.projects[0].editor,
  );
  assert.equal(third.data.ui.splitEditor, true);
});
test("agent launch passes instructions as literal CLI arguments; OpenCode recovery requires an exact ID", () => {
  const task = "Explain $(touch should-not-execute) and `syntax`",
    instructions = "Be careful with quoted text.";
  const claude = launchSpec("claude", {
    task,
    instructions,
    providerSessionId: "uuid",
  });
  assert.deepEqual(claude.args, [
    "--session-id",
    "uuid",
    "--append-system-prompt",
    instructions,
    task,
  ]);
  assert.deepEqual(launchSpec("codex", { task, instructions }).args, [
    instructions + "\n\nTask:\n" + task,
  ]);
  assert.deepEqual(launchSpec("opencode", { task, instructions }).args, [
    "--prompt",
    instructions + "\n\nTask:\n" + task,
  ]);
  assert.throws(
    () => launchSpec("opencode", { recover: true }),
    /Link an OpenCode session ID/,
  );
  assert.deepEqual(
    launchSpec("opencode", { recover: true, providerSessionId: "ses_123" })
      .args,
    ["--session", "ses_123"],
  );
});
test("named agents bind skills, reject duplicate runs, and retain identity through recovery", (t) => {
  const { Agents } = require("../desktop/agents.cjs");
  const dir = temp(t),
    store = new Store(dir);
  store.data.projects.push({ id: "p", path: dir });
  fs.mkdirSync(path.join(dir, ".agents/skills/review"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".agents/skills/review/SKILL.md"),
    "# Review\nLook for regressions.",
  );
  const exits = [],
    manager = new Terminals(store, () => {}, {
      spawn: () => ({
        onData() {},
        onExit(callback) {
          exits.push(callback);
        },
        kill() {},
        resize() {},
        write() {},
      }),
    });
  t.after(() => manager.shutdown());
  let launch;
  const agents = new Agents(store, {
    running: manager.running,
    start(projectId, kind, options) {
      launch = { projectId, kind, options };
      return manager.start(projectId, "shell", options);
    },
  });
  const agent = agents.create({
    projectId: "p",
    provider: "claude",
    name: "Reviewer",
    instructions: "Explain every concern.",
    skillPath: ".agents/skills/review/SKILL.md",
  });
  const run = agents.start(agent.id, "Review this diff.");
  assert.equal(launch.kind, "claude");
  assert.match(launch.options.instructions, /Look for regressions/);
  assert.equal(launch.options.task, "Review this diff.");
  assert.equal(agent.sessionId, run.id);
  assert.throws(
    () => agents.start(agent.id, "Duplicate"),
    /already has a running terminal/,
  );
  assert.throws(
    () => agents.mark(agent.id, "ready"),
    /Stop the running terminal/,
  );
  agents.mark(agent.id, "review");
  assert.equal(manager.running.has(run.id), true);
  exits[0]({ exitCode: 0 });
  assert.equal(agent.stage, "review");
  const second = manager.recover(run.id);
  assert.equal(agent.sessionId, second.id);
  assert.equal(second.agentId, agent.id);
  assert.equal(agent.stage, "ready");
  exits[1]({ exitCode: 1 });
  const third = agents.start(agent.id, "New task");
  assert.throws(() => manager.recover(run.id), /another running session/);
  assert.equal(agent.sessionId, third.id);
  exits[2]({ exitCode: 0 });
  fs.unlinkSync(path.join(dir, ".agents/skills/review/SKILL.md"));
  assert.throws(
    () => agents.start(agent.id, "Missing skill"),
    /selected skill is missing/,
  );
  const restored = new Store(dir);
  assert.equal(restored.data.agents[0].name, "Reviewer");
  assert.equal(restored.data.agents[0].sessionId, third.id);
});
test("external editor paths remain literal on macOS and Windows", () => {
  const { editorLaunchSpec } = require("../desktop/editors.cjs");
  const project = "C:\\Users\\O'Brien & Co\\$(unsafe)";
  const spec = editorLaunchSpec(
    "code",
    project,
    "win32",
    "C:\\VS Code\\code.cmd",
  );
  assert.equal(
    Buffer.from(spec.args.at(-1), "base64").toString("utf16le"),
    "& 'C:\\VS Code\\code.cmd' 'C:\\Users\\O''Brien & Co\\$(unsafe)'",
  );
  assert.deepEqual(editorLaunchSpec("cursor", "/tmp/My Project", "darwin"), {
    file: "/usr/bin/open",
    args: ["-a", "Cursor", "/tmp/My Project"],
  });
  assert.throws(() => editorLaunchSpec("code", project, "win32"), /Install/);
});
