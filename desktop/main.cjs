const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  Tray,
  Menu,
  nativeImage,
  session: electronSession,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { z } = require("zod");
const { Store, atomicWrite } = require("./store.cjs");
const files = require("./files.cjs");
const { Terminals, executable } = require("./terminals.cjs");
const { complete, roles } = require("./providers.cjs");
const git = require("./git.cjs");
const { search, replaceInFiles } = require("./search.cjs");
const containers = require("./containers.cjs");
const {
  isCliProvider,
  cliExecutable,
  cliLabel,
  cliPrompt,
} = require("./cli-chat.cjs");
const {
  modeList,
  runModeList,
  DEFAULT_ALLOWLIST,
  runStream,
} = require("./cli-stream.cjs");
const { AgentBridge } = require("./agent-bridge.cjs");
const { Approvals } = require("./approvals.cjs");
const {
  interruptedReport,
  summarise,
  pruneUnrecoverable,
  highlight,
} = require("./recovery.cjs");
const {
  providerSessionExists,
  readableTail,
} = require("./provider-sessions.cjs");
const { icon } = require("./icon.cjs");
const { Agents } = require("./agents.cjs");
const { openEditor } = require("./editors.cjs");
let agents;

if (
  process.env.RELAY_DATA_DIR ||
  (!app.isPackaged && process.env.RELAY_TEST_DIR)
)
  app.setPath(
    "userData",
    process.env.RELAY_DATA_DIR || process.env.RELAY_TEST_DIR,
  );
app.setName("Relay");
let win,
  tray,
  store,
  terminals,
  bridge,
  approvals,
  quitting = false;
const requests = new Map();
const id = z.string().uuid();
const provider = z.enum([
  "openai",
  "anthropic",
  "claude-cli",
  "codex-cli",
  "opencode-cli",
]);
const text = z.string().max(100000);
const ipc = (name, schema, handler) =>
  ipcMain.handle(`relay:${name}`, async (event, input) => {
    const url = event.senderFrame?.url;
    const expected =
      (!app.isPackaged && process.env.RELAY_DEV_URL) ||
      pathToFileURL(path.join(__dirname, "../dist/index.html")).href;
    if (
      !win ||
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame ||
      url !== expected
    )
      throw new Error("Untrusted application frame.");
    return handler(schema.parse(input ?? {}));
  });
function publish(type, payload = {}) {
  if (win && !win.isDestroyed())
    win.webContents.send("relay:event", { type, ...payload });
}

// The agent reaches Relay through a loopback bridge with a per-launch token, so
// a process it starts is a terminal the person can see rather than something
// hidden inside the run.
async function relayMcpConfig(runId) {
  if (!bridge) return null;
  const { url, token } = await bridge.start();
  return {
    mcpServers: {
      relay: {
        command: process.execPath,
        args: [path.join(__dirname, "mcp-relay.cjs")],
        env: {
          ELECTRON_RUN_AS_NODE: "1",
          RELAY_BRIDGE_URL: url,
          RELAY_BRIDGE_TOKEN: token,
          ...(runId ? { RELAY_RUN_ID: runId } : {}),
        },
      },
    },
  };
}

function save() {
  store.save();
  publish("changed");
}
function keyFile() {
  return path.join(store.directory, "credentials.json");
}
function credentials() {
  return fs.existsSync(keyFile())
    ? JSON.parse(fs.readFileSync(keyFile(), "utf8"))
    : {};
}
function snapshot() {
  return {
    ...store.data,
    capabilities: {
      codex: !!executable("codex"),
      claude: !!executable("claude"),
      opencode: !!executable("opencode"),
      secureStorage: safeStorage.isEncryptionAvailable(),
      configured: Object.keys(credentials()),
      platform: process.platform,
    },
  };
}

function register() {
  const draftSchema = z.object({
    path: z.string().max(4096),
    content: z.string().max(2 * 1024 * 1024),
    hash: z.string().length(64),
    dirty: z.boolean(),
  });
  ipc(
    "editor:state",
    z.object({
      projectId: id,
      editor: z
        .object({
          tabs: z.array(draftSchema).max(20),
          primary: z.string().nullable(),
          secondary: z.string().nullable(),
          focusedPane: z.union([z.literal(1), z.literal(2)]),
        })
        .refine(
          (e) =>
            new Set(e.tabs.map((t) => t.path)).size === e.tabs.length &&
            [e.primary, e.secondary].every(
              (p) => p === null || e.tabs.some((t) => t.path === p),
            ) &&
            e.tabs.reduce((n, t) => n + t.content.length, 0) <= 8 * 1024 * 1024,
          "Invalid editor tabs or drafts exceed 8 MB.",
        ),
    }),
    (a) => {
      const p = store.project(a.projectId);
      p.editor = a.editor;
      p.draft =
        a.editor.tabs.find(
          (t) =>
            t.path ===
            (a.editor.focusedPane === 2
              ? a.editor.secondary
              : a.editor.primary),
        ) || null;
      save();
    },
  );
  ipc(
    "editor:confirm-discard",
    z.object({ projectId: id, path: z.string().max(4096) }),
    async (a) => {
      const p = store.project(a.projectId),
        draft = p.editor?.tabs.find((t) => t.path === a.path);
      if (!draft?.dirty) return true;
      const result = await dialog.showMessageBox(win, {
        type: "question",
        message: `Discard unsaved changes to ${path.basename(a.path)}?`,
        detail: "The file on disk will stay unchanged.",
        buttons: ["Keep editing", "Discard draft"],
        defaultId: 0,
        cancelId: 0,
      });
      return result.response === 1;
    },
  );
  ipc(
    "project:open-editor",
    z.object({ projectId: id, editor: z.enum(["cursor", "code"]) }),
    (a) => openEditor(a.editor, store.project(a.projectId).path),
  );
  ipc(
    "project:tree",
    z.object({
      projectId: id,
      expandedPaths: z.array(z.string().max(4096)).max(500),
    }),
    (a) => {
      store.project(a.projectId).expandedPaths = a.expandedPaths;
      save();
    },
  );
  ipc(
    "agent:update",
    z.object({
      id,
      changes: z.object({
        name: z.string().trim().min(1).max(60),
        instructions: z.string().max(20000),
        memory: z.string().max(20000),
        skillPath: z.string().max(4096).nullable().optional(),
        // Which installed CLI runs this agent, and on which model.
        provider: z.enum(["codex", "claude", "opencode"]).optional(),
        model: z.string().trim().max(100).optional(),
      }),
    }),
    (a) => {
      const result = agents.update(a.id, a.changes);
      publish("changed");
      return result;
    },
  );
  ipc(
    "agent:queue",
    z.object({ id, task: z.string().trim().min(1).max(20000) }),
    (a) => {
      const result = agents.queue(a.id, a.task);
      publish("changed");
      return result;
    },
  );
  // The snapshot is taken before the CLI runs, so what it changes can be told
  // apart from what was already modified in the workspace.
  const startWithSnapshot = async (projectId, run) => {
    const taken = await git
      .snapshot(store.project(projectId).path)
      .catch(() => null);
    try {
      const session = run();
      if (taken) {
        session.snapshot = taken;
        save();
      }
      return session;
    } finally {
      publish("changed");
    }
  };
  ipc("task:start", z.object({ id }), (a) => {
    const task = agents.task(a.id);
    return startWithSnapshot(agents.get(task.agentId).projectId, () =>
      agents.startTask(a.id),
    );
  });
  ipc(
    "task:resolve",
    z.object({ id, status: z.enum(["done", "cancelled"]) }),
    (a) => {
      const result = agents.resolveTask(a.id, a.status);
      publish("changed");
      return result;
    },
  );
  ipc(
    "agent:create",
    z.object({
      projectId: id,
      name: z.string().trim().min(1).max(60),
      provider: z.enum(["codex", "claude", "opencode"]),
      instructions: z.string().trim().min(1).max(20000),
      skillPath: z.string().max(4096).optional(),
    }),
    (a) => {
      const result = agents.create(a);
      publish("changed");
      return result;
    },
  );
  ipc(
    "agent:start",
    z.object({ id, task: z.string().trim().min(1).max(20000) }),
    (a) =>
      startWithSnapshot(agents.get(a.id).projectId, () =>
        agents.start(a.id, a.task),
      ),
  );
  ipc(
    "agent:mark",
    z.object({ id, stage: z.enum(["ready", "review"]) }),
    (a) => {
      const result = agents.mark(a.id, a.stage);
      publish("changed");
      return result;
    },
  );
  ipc(
    "files:reload",
    z.object({ projectId: id, path: z.string().max(4096).optional() }),
    async (a) => {
      const project = store.project(a.projectId);
      const draft = a.path
        ? project.editor?.tabs.find((t) => t.path === a.path)
        : project.draft;
      if (!draft) return null;
      if (draft.dirty) {
        const result = await dialog.showMessageBox(win, {
          type: "question",
          title: "Reload file from disk?",
          message:
            "Discard this unsaved draft and reload the current file from disk?",
          buttons: ["Keep draft", "Reload from disk"],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response !== 1) return null;
      }
      const file = files.readFile(project.path, draft.path);
      project.draft = { ...file, dirty: false };
      if (project.editor)
        project.editor.tabs = project.editor.tabs.map((t) =>
          t.path === draft.path ? project.draft : t,
        );
      save();
      return project.draft;
    },
  );
  ipc("state", z.object({}), () => snapshot());
  ipc("project:add", z.object({}), async () => {
    const selected =
      !app.isPackaged && process.env.RELAY_TEST_PROJECT
        ? [process.env.RELAY_TEST_PROJECT]
        : (
            await dialog.showOpenDialog(win, {
              title: "Open a project in Relay",
              properties: ["openDirectory"],
            })
          ).filePaths;
    if (!selected?.length) return null;
    const root = fs.realpathSync(selected[0]);
    let project = store.data.projects.find((p) => p.path === root);
    if (!project) {
      project = {
        id: crypto.randomUUID(),
        name: path.basename(root),
        path: root,
        createdAt: Date.now(),
      };
      store.data.projects.push(project);
    }
    store.data.ui.projectId = project.id;
    save();
    return project;
  });
  ipc(
    "ui:update",
    z
      .object({
        view: z
          .enum([
            "overview",
            "workspace",
            "agents",
            "usage",
            "integrations",
            "settings",
            "board",
            "terminal-grid",
          ])
          .optional(),
        projectId: id.nullable().optional(),
        chatId: id.nullable().optional(),
        sessionId: id.nullable().optional(),
        terminalSizing: z
          .object({
            column: z.number().min(20).max(80),
            first: z.number().min(15).max(65),
            second: z.number().min(35).max(85),
            row: z.number().min(20).max(80),
          })
          .refine((v) => v.second - v.first >= 15)
          .optional(),
        theme: z.enum(["light", "dark"]).optional(),
        terminalLayout: z
          .union([z.literal(2), z.literal(4), z.literal(6)])
          .optional(),
        editorTerminalLayout: z
          .union([z.literal(1), z.literal(2), z.literal(4)])
          .optional(),
        gridSessionIds: z
          .array(id.nullable())
          .max(6)
          .refine((ids) => {
            const filled = ids.filter(Boolean);
            return new Set(filled).size === filled.length;
          }, "Each pane must have a different terminal.")
          .optional(),
        gridScope: z.union([z.literal("all"), id]).optional(),
        editorSessionIds: z
          .array(id.nullable())
          .max(4)
          .refine((ids) => {
            const filled = ids.filter(Boolean);
            return new Set(filled).size === filled.length;
          })
          .optional(),
        showExplorer: z.boolean().optional(),
        sidebarPanel: z
          .enum(["explorer", "search", "source-control", "containers"])
          .optional(),
        showChat: z.boolean().optional(),
        showTerminal: z.boolean().optional(),
        splitEditor: z.boolean().optional(),
        explorerWidth: z.number().int().min(140).max(600).optional(),
        chatWidth: z.number().int().min(240).max(800).optional(),
        terminalHeight: z.number().int().min(100).max(800).optional(),
        editorSplit: z.number().int().min(20).max(80).optional(),
      })
      .strict(),
    (patch) => {
      Object.assign(store.data.ui, patch);
      store.save();
    },
  );
  ipc(
    "files:list",
    z.object({ projectId: id, path: z.string().max(4096).default(".") }),
    (a) => files.listFiles(store.project(a.projectId).path, a.path),
  );
  ipc(
    "files:read",
    z.object({ projectId: id, path: z.string().max(4096) }),
    (a) => files.readFile(store.project(a.projectId).path, a.path),
  );
  ipc(
    "files:save",
    z.object({
      projectId: id,
      path: z.string().max(4096),
      content: z.string().max(2 * 1024 * 1024),
      hash: z.string().length(64),
    }),
    (a) =>
      files.writeFile(
        store.project(a.projectId).path,
        a.path,
        a.content,
        a.hash,
      ),
  );
  ipc(
    "draft:save",
    z.object({
      projectId: id,
      draft: z
        .object({
          path: z.string().max(4096),
          content: z.string().max(2 * 1024 * 1024),
          hash: z.string().length(64),
          dirty: z.boolean(),
        })
        .nullable(),
    }),
    (a) => {
      store.project(a.projectId).draft = a.draft;
      save();
    },
  );
  ipc("skills:list", z.object({ projectId: id }), (a) =>
    files.skills(store.project(a.projectId).path),
  );
  ipc(
    "terminal:start",
    z
      .object({
        projectId: id,
        kind: z.enum(["shell", "codex", "claude", "opencode", "build"]),
        command: z.string().trim().min(1).max(2000).optional(),
      })
      .refine(
        (a) => a.kind !== "build" || !!a.command,
        "A build command is required.",
      ),
    (a) =>
      terminals.start(
        a.projectId,
        a.kind,
        a.command ? { command: a.command } : {},
      ),
  );
  ipc("terminal:recover", z.object({ id }), (a) => terminals.recover(a.id));
  ipc(
    "terminal:bind",
    z.object({
      id,
      providerSessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/),
    }),
    (a) => {
      const s = store.session(a.id);
      if (!["codex", "opencode"].includes(s.kind))
        throw new Error(
          "Only Codex and OpenCode terminals support manually linking an ID.",
        );
      if (s.kind === "codex") id.parse(a.providerSessionId);
      s.providerSessionId = a.providerSessionId;
      save();
    },
  );
  ipc(
    "terminal:write",
    z.object({ id, data: z.string().max(1024 * 1024) }),
    (a) => {
      // An agent terminal is the agent's output, not a shell to type into.
      if (store.session(a.id).agentOwned)
        throw new Error(
          "Agent terminals are read-only. Open a new shell to run something yourself.",
        );
      return terminals.write(a.id, a.data);
    },
  );
  ipc(
    "terminal:resize",
    z.object({
      id,
      cols: z.number().int().min(2).max(500),
      rows: z.number().int().min(1).max(250),
    }),
    (a) => terminals.resize(a.id, a.cols, a.rows),
  );
  ipc("terminal:stop", z.object({ id }), (a) => terminals.stop(a.id));
  ipc("terminal:dismiss", z.object({ id }), (a) => terminals.dismiss(a.id));
  ipc("terminal:log", z.object({ id }), (a) => {
    const s = store.session(a.id);
    return { data: store.readLog(a.id), sequence: s.sequence || 0 };
  });
  ipc(
    "chat:create",
    z.object({
      projectId: id,
      provider,
      // A CLI provider runs on its own default model, so an empty value is
      // valid there; an API provider still needs an explicit model id.
      model: z.string().trim().max(100),
      role: z.enum(["builder", "architect", "reviewer", "product"]),
      mode: z.enum(["agent", "plan", "ask"]).optional(),
      skillPath: z.string().max(4096).optional(),
    }),
    (a) => {
      if (!isCliProvider(a.provider) && !a.model)
        throw new Error("Set a model ID in Settings before starting a chat.");
      const project = store.project(a.projectId);
      const skill = a.skillPath
        ? files.skills(project.path).find((s) => s.path === a.skillPath)
        : null;
      if (a.skillPath && !skill)
        throw new Error("Project skill could not be found.");
      const chat = {
        ...a,
        id: crypto.randomUUID(),
        title: "New conversation",
        messages: [],
        status: "idle",
        createdAt: Date.now(),
        skill: skill?.content?.slice(0, 30000),
      };
      store.data.chats.push(chat);
      store.data.ui.chatId = chat.id;
      save();
      return chat;
    },
  );
  ipc("chat:send", z.object({ id, message: text.trim().min(1) }), async (a) => {
    const chat = store.chat(a.id);
    if (requests.has(chat.id))
      throw new Error("A reply is already in progress.");
    const usesCli = isCliProvider(chat.provider);
    let key = null;
    if (usesCli) {
      if (!executable(cliExecutable(chat.provider)))
        throw new Error(
          cliLabel(chat.provider) +
            " is not installed or not on PATH. Install it, or choose an API provider in Settings.",
        );
    } else {
      const encrypted = credentials()[chat.provider];
      if (!encrypted)
        throw new Error("Add an API key in Settings before sending.");
      if (!safeStorage.isEncryptionAvailable())
        throw new Error("OS credential encryption is unavailable.");
      key = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    }
    const message = {
      id: crypto.randomUUID(),
      role: "user",
      content: a.message,
      createdAt: Date.now(),
    };
    chat.messages.push(message);
    if (chat.messages.length === 1) chat.title = a.message.slice(0, 56);
    chat.status = "running";
    delete chat.error;
    const controller = new AbortController();
    requests.set(chat.id, controller);
    const startedAt = Date.now();
    const timeout = setTimeout(() => controller.abort(), 180000);
    save();
    const streams =
      usesCli &&
      chat.provider !== "opencode-cli" &&
      (chat.mode || "agent") !== "ask";
    try {
      if (streams) {
        // The card needs to say which conversation is asking, and cancelling
        // the reply has to cancel the question with it.
        const runId = crypto.randomUUID();
        const unregister = bridge?.register(runId, {
          projectId: chat.projectId,
          chatId: chat.id,
          provider: chat.provider,
          signal: controller.signal,
        });
        controller.signal.addEventListener(
          "abort",
          () => approvals?.cancelRun(runId),
          { once: true },
        );
        // Built before the empty reply is appended, so the model is never
        // shown its own blank turn.
        const system =
          (roles[chat.role] || roles.builder) +
          (chat.skill ? "\n\nUser-selected project skill:\n" + chat.skill : "");
        const prompt = cliPrompt(
          chat.messages.map((m) => ({ role: m.role, content: m.content })),
        );
        const reply = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          steps: [],
          createdAt: Date.now(),
        };
        chat.messages.push(reply);
        let lastPublish = 0;
        const stream = await runStream(
          {
            provider: chat.provider,
            model: chat.model,
            mode: chat.mode || "agent",
            runMode: store.data.settings.runMode || "auto-review",
            allowlist: store.data.settings.allowlist,
            mcp: await relayMcpConfig(runId),
            system,
            prompt,
            cwd: store.project(chat.projectId).path,
            signal: controller.signal,
          },
          (steps) => {
            reply.steps = steps;
            const text = steps.filter((s) => s.kind === "text").at(-1);
            if (text) reply.content = text.text;
            // Publishing on every event would redraw faster than anyone can
            // read; a few times a second is enough to feel live.
            const now = Date.now();
            if (now - lastPublish > 220) {
              lastPublish = now;
              save();
            }
          },
        );
        reply.steps = stream.steps;
        reply.content = stream.text || reply.content || "";
        reply.durationMs = Date.now() - startedAt;
        chat.status = "idle";
        store.data.usage.push({
          id: crypto.randomUUID(),
          projectId: chat.projectId,
          chatId: chat.id,
          provider: chat.provider,
          model: chat.model,
          createdAt: Date.now(),
          durationMs: reply.durationMs,
          source: "provider-cli",
          ...stream.usage,
          measured: !!stream.usage,
        });
        clearTimeout(timeout);
        requests.delete(chat.id);
        unregister?.();
        save();
        return chat;
      }
      const result = await complete({
        provider: chat.provider,
        model: chat.model,
        messages: chat.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        role: chat.role,
        skill: chat.skill,
        key,
        cwd: store.project(chat.projectId).path,
        signal: controller.signal,
      });
      chat.messages.push({
        id: crypto.randomUUID(),
        role: "assistant",
        content: result.text || "The provider returned no text.",
        createdAt: Date.now(),
      });
      chat.status = "idle";
      store.data.usage.push({
        id: crypto.randomUUID(),
        projectId: chat.projectId,
        chatId: chat.id,
        provider: chat.provider,
        model: chat.model,
        createdAt: Date.now(),
        durationMs: Date.now() - startedAt,
        source: usesCli ? "provider-cli" : "provider-api",
        ...result.usage,
        measured: !!result.usage,
      });
    } catch (error) {
      chat.status = "failed";
      chat.error = controller.signal.aborted
        ? "Request cancelled or timed out. The provider may have processed it; its usage is unknown."
        : error.message;
    } finally {
      clearTimeout(timeout);
      requests.delete(chat.id);
      save();
    }
    return chat;
  });
  ipc(
    "chat:configure",
    z.object({
      id,
      provider: provider.optional(),
      model: z.string().trim().max(100).optional(),
      role: z.enum(["builder", "architect", "reviewer", "product"]).optional(),
      mode: z.enum(["agent", "plan", "ask"]).optional(),
    }),
    (a) => {
      const chat = store.chat(a.id);
      if (requests.has(chat.id))
        throw new Error("Wait for the current reply before changing this.");
      if (a.provider !== undefined) chat.provider = a.provider;
      if (a.model !== undefined) chat.model = a.model;
      if (a.role !== undefined) chat.role = a.role;
      if (a.mode !== undefined) chat.mode = a.mode;
      if (!isCliProvider(chat.provider) && !chat.model)
        throw new Error("An API provider needs a model ID.");
      save();
      return chat;
    },
  );
  ipc("chat:cancel", z.object({ id }), (a) => requests.get(a.id)?.abort());
  ipc(
    "settings:save",
    z.object({
      provider,
      model: z.string().trim().max(100),
      key: z.string().trim().max(1000).optional(),
    }),
    (a) => {
      if (isCliProvider(a.provider) && a.key)
        throw new Error(
          "CLI providers sign in with their own tool. No API key is needed here.",
        );
      if (a.key !== undefined) {
        const keys = credentials();
        if (a.key) {
          if (!safeStorage.isEncryptionAvailable())
            throw new Error(
              "OS credential encryption is unavailable. Your key was not saved.",
            );
          keys[a.provider] = safeStorage
            .encryptString(a.key)
            .toString("base64");
        } else delete keys[a.provider];
        atomicWrite(keyFile(), JSON.stringify(keys));
      }
      store.data.settings.provider = a.provider;
      store.data.settings.models[a.provider] = a.model;
      save();
    },
  );
  const repo = (projectId, relative) =>
    git.resolveRepository(store.project(projectId).path, relative);
  const target = z.object({
    projectId: id,
    repo: z.string().max(4096).optional(),
  });
  ipc("git:repos", z.object({ projectId: id }), (a) =>
    git.statuses(store.project(a.projectId).path),
  );
  ipc("git:status", target, (a) => git.status(repo(a.projectId, a.repo)));
  ipc(
    "git:log",
    target.extend({ limit: z.number().int().min(1).max(200).optional() }),
    (a) => git.log(repo(a.projectId, a.repo), a.limit),
  );
  ipc("git:diff", target.extend({ file: z.string().min(1).max(4096) }), (a) =>
    git.fileDiff(repo(a.projectId, a.repo), a.file),
  );
  ipc(
    "git:commit",
    target.extend({
      message: z.string().trim().min(1).max(4000),
      paths: z.array(z.string().max(4096)).max(2000).optional(),
    }),
    (a) => git.commit(repo(a.projectId, a.repo), a.message, a.paths),
  );
  ipc("git:push", target.extend({ setUpstream: z.boolean().optional() }), (a) =>
    git.push(repo(a.projectId, a.repo), { setUpstream: a.setUpstream }),
  );
  ipc(
    "git:discard",
    target.extend({ paths: z.array(z.string().max(4096)).min(1).max(2000) }),
    (a) => git.discard(repo(a.projectId, a.repo), a.paths),
  );
  ipc("git:agent-changes", z.object({ projectId: id, sessionId: id }), (a) =>
    git.changesSince(
      store.project(a.projectId).path,
      store.session(a.sessionId).snapshot,
    ),
  );
  ipc(
    "agent:handoff",
    z.object({
      fromId: id,
      toId: id,
      text: z.string().trim().min(1).max(20000),
      sourceTaskId: id.optional(),
    }),
    (a) => {
      const task = agents.handoff(a);
      publish("changed");
      return task;
    },
  );
  ipc("git:hunks", target.extend({ file: z.string().min(1).max(4096) }), (a) =>
    git.fileHunks(repo(a.projectId, a.repo), a.file),
  );
  ipc(
    "git:revert-hunk",
    target.extend({
      file: z.string().min(1).max(4096),
      index: z.number().int().min(0).max(5000),
    }),
    (a) => git.revertHunk(repo(a.projectId, a.repo), a.file, a.index),
  );
  ipc(
    "approval:resolve",
    z.object({
      id,
      decision: z.enum(["accept", "skip", "remember"]),
    }),
    (a) => approvals.resolve(a.id, a.decision),
  );
  // A one-line description per session, taken from what it actually printed,
  // so a dozen runs of the same tool are told apart by their work.
  ipc("sessions:summaries", z.object({ projectId: id.optional() }), (a) => {
    const summaries = {};
    for (const session of store.data.sessions) {
      if (a.projectId && session.projectId !== a.projectId) continue;
      if (session.dismissedAt) continue;
      try {
        const line = highlight(readableTail(store.readLog(session.id), 4000))
          .split("\n")
          .filter(Boolean)
          .slice(-1)[0];
        if (line) summaries[session.id] = line.slice(0, 200);
      } catch {
        // A missing log only means no description.
      }
    }
    return summaries;
  });
  ipc("recovery:report", z.object({}), () => {
    const report = interruptedReport(store, {
      sessionExists: providerSessionExists,
    });
    return { report, summary: summarise(report) };
  });
  ipc("chat:modes", z.object({}), () => ({
    modes: modeList(),
    runModes: runModeList(),
    defaultAllowlist: DEFAULT_ALLOWLIST,
  }));
  ipc(
    "settings:execution",
    z.object({
      runMode: z.enum(["allowlist", "auto-review", "everything"]),
      allowlist: z.array(z.string().trim().max(200)).max(200),
    }),
    (a) => {
      store.data.settings.runMode = a.runMode;
      store.data.settings.allowlist = a.allowlist.filter(Boolean);
      save();
      return store.data.settings;
    },
  );
  ipc("git:menu", z.object({}), () => git.menu());
  ipc(
    "git:run",
    target.extend({
      command: z.string().min(1).max(64),
      input: z.string().max(2000).optional(),
    }),
    (a) => git.runCommand(repo(a.projectId, a.repo), a.command, a.input),
  );
  ipc("git:fetch", target, (a) => git.fetch(repo(a.projectId, a.repo)));
  ipc("git:pull", target, (a) => git.pull(repo(a.projectId, a.repo)));
  ipc("git:sync", target, (a) => git.sync(repo(a.projectId, a.repo)));
  ipc("git:branches", target, (a) => git.branches(repo(a.projectId, a.repo)));
  ipc(
    "git:checkout",
    target.extend({ branch: z.string().min(1).max(400) }),
    (a) => git.checkout(repo(a.projectId, a.repo), a.branch),
  );
  ipc("git:stash", target.extend({ pop: z.boolean().optional() }), (a) =>
    git.stash(repo(a.projectId, a.repo), { pop: a.pop }),
  );
  ipc(
    "search:files",
    z.object({
      projectId: id,
      query: z.string().max(500),
      regex: z.boolean().optional(),
      caseSensitive: z.boolean().optional(),
      wholeWord: z.boolean().optional(),
      include: z.string().max(500).optional(),
      exclude: z.string().max(500).optional(),
    }),
    (a) => search(repo(a.projectId), a),
  );
  ipc("containers:list", z.object({}), () =>
    containers.list(store.data.projects),
  );
  ipc(
    "containers:logs",
    z.object({
      id: z.string().min(1).max(128),
      tail: z.number().int().min(1).max(2000).optional(),
    }),
    (a) => containers.logs(a.id, a.tail),
  );
  ipc("containers:stop", z.object({ id: z.string().min(1).max(128) }), (a) =>
    containers.stop(a.id),
  );
  ipc(
    "search:replace",
    z.object({
      projectId: id,
      query: z.string().min(1).max(500),
      replacement: z.string().max(2000),
      regex: z.boolean().optional(),
      caseSensitive: z.boolean().optional(),
      wholeWord: z.boolean().optional(),
      include: z.string().max(500).optional(),
      exclude: z.string().max(500).optional(),
      files: z.array(z.string().max(4096)).max(5000).optional(),
    }),
    (a) => replaceInFiles(store.project(a.projectId).path, a),
  );
  ipc("usage:export", z.object({ projectId: id.optional() }), async (a) => {
    const rows = store.data.usage.filter(
      (u) => !a.projectId || u.projectId === a.projectId,
    );
    const result = await dialog.showSaveDialog(win, {
      defaultPath: "relay-usage.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.filePath)
      atomicWrite(
        result.filePath,
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            usage: rows,
            builds: store.data.sessions.filter(
              (s) =>
                s.kind === "build" &&
                (!a.projectId || s.projectId === a.projectId),
            ),
          },
          null,
          2,
        ),
      );
    return !result.canceled;
  });
}
function show() {
  if (!win || win.isDestroyed()) createWindow();
  win.show();
  win.focus();
}
function createWindow() {
  win = new BrowserWindow({
    width: 1510,
    height: 960,
    minWidth: 1050,
    minHeight: 720,
    backgroundColor: "#18191c",
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 13 } }
      : {}),
    title: "Relay",
    icon: nativeImage.createFromBuffer(icon()),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  const dev = !app.isPackaged && process.env.RELAY_DEV_URL;
  if (dev) win.loadURL(dev);
  else win.loadFile(path.join(__dirname, "../dist/index.html"));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", show);
  app.whenReady().then(() => {
    try {
      store = new Store(app.getPath("userData"));
      terminals = new Terminals(store, publish, require("node-pty"));
      agents = new Agents(store, terminals);
      pruneUnrecoverable(store, { sessionExists: providerSessionExists });
      approvals = new Approvals(store, publish);
      bridge = new AgentBridge(store, terminals, publish, approvals);
      electronSession.defaultSession.setPermissionRequestHandler(
        (_wc, _permission, callback) => callback(false),
      );
      register();
      createWindow();
      tray = new Tray(
        nativeImage.createFromBuffer(icon()).resize({ width: 20, height: 20 }),
      );
      tray.setToolTip("Relay — terminals continue in the background");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "Open Relay", click: show },
          { type: "separator" },
          {
            label: "Quit Relay (interrupt running work)",
            click: () => app.quit(),
          },
        ]),
      );
      tray.on("double-click", show);
      const command = (label, action, accelerator) => ({
        label,
        accelerator,
        click: () => {
          show();
          publish("command", { command: action });
        },
      });
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          ...(process.platform === "darwin"
            ? [
                {
                  label: "Relay",
                  submenu: [
                    { role: "about" },
                    command("Settings…", "settings", "CmdOrCtrl+,"),
                    { type: "separator" },
                    { role: "hide" },
                    { role: "hideOthers" },
                    { role: "unhide" },
                    { type: "separator" },
                    { role: "quit" },
                  ],
                },
              ]
            : []),
          {
            label: "File",
            submenu: [
              command("Open Folder…", "open-project", "CmdOrCtrl+O"),
              command("Save File", "save-file", "CmdOrCtrl+S"),
              command("Close Editor Tab", "close-tab", "CmdOrCtrl+W"),
              { type: "separator" },
              { label: "Hide Window", click: () => win.hide() },
              { role: "quit" },
            ],
          },
          { role: "editMenu" },
          { label: "Selection", submenu: [{ role: "selectAll" }] },
          {
            label: "View",
            submenu: [
              command("Editor", "view-workspace", "CmdOrCtrl+1"),
              command("Agent Board", "view-board", "CmdOrCtrl+2"),
              command("Terminal Grid", "view-terminal-grid", "CmdOrCtrl+3"),
              { type: "separator" },
              command("Toggle Explorer", "toggle-explorer", "CmdOrCtrl+B"),
              command(
                "Toggle Terminal Panel",
                "toggle-terminal",
                "CmdOrCtrl+J",
              ),
              command("Toggle Chat", "toggle-chat", "CmdOrCtrl+Alt+B"),
              command("Split Editor", "split-editor", "CmdOrCtrl+\\"),
              command("Switch Theme", "theme"),
              command("Reset Layout", "reset-layout"),
              { type: "separator" },
              { role: "resetZoom" },
              { role: "zoomIn" },
              { role: "zoomOut" },
              { role: "togglefullscreen" },
              { role: "toggleDevTools" },
            ],
          },
          {
            label: "Go",
            submenu: [
              command("Next File Tab", "next-tab", "Ctrl+Tab"),
              command("Previous File Tab", "previous-tab", "Ctrl+Shift+Tab"),
              command("Usage", "view-usage"),
              command("Integrations", "view-integrations"),
            ],
          },
          {
            label: "Run",
            submenu: [
              command("Run Build…", "build"),
              command("Open Agent Board", "view-board"),
            ],
          },
          {
            label: "Terminal",
            submenu: [
              command("New Terminal", "new-shell", "Ctrl+Shift+`"),
              command("New Codex Session", "new-codex"),
              command("New Claude Code Session", "new-claude"),
              command("New OpenCode Session", "new-opencode"),
            ],
          },
          { role: "windowMenu" },
          {
            label: "Help",
            submenu: [
              command("Providers & Integrations", "view-integrations"),
              {
                label: "About Relay",
                click: () =>
                  dialog.showMessageBox(win, {
                    message: `Relay ${app.getVersion()}`,
                    detail:
                      "Persistent local projects, file drafts, agent conversations, and terminal history. Closing the window keeps processes alive. Quitting or restarting interrupts them.",
                  }),
              },
            ],
          },
        ]),
      );
    } catch (error) {
      dialog.showErrorBox("Relay could not start", error.message);
      app.quit();
    }
  });
  app.on("activate", show);
  app.on("before-quit", () => {
    quitting = true;
    for (const controller of requests.values()) controller.abort();
    terminals?.shutdown();
  });
  app.on("window-all-closed", () => {});
}
