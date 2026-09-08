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
const { complete } = require("./providers.cjs");
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
  quitting = false;
const requests = new Map();
const id = z.string().uuid();
const provider = z.enum(["openai", "anthropic"]);
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
    (a) => {
      try {
        return agents.start(a.id, a.task);
      } finally {
        publish("changed");
      }
    },
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
    (a) => terminals.write(a.id, a.data),
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
  ipc("terminal:log", z.object({ id }), (a) => {
    const s = store.session(a.id);
    return { data: store.readLog(a.id), sequence: s.sequence || 0 };
  });
  ipc(
    "chat:create",
    z.object({
      projectId: id,
      provider,
      model: z.string().trim().min(1).max(100),
      role: z.enum(["builder", "architect", "reviewer", "product"]),
      skillPath: z.string().max(4096).optional(),
    }),
    (a) => {
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
    const encrypted = credentials()[chat.provider];
    if (!encrypted)
      throw new Error("Add an API key in Settings before sending.");
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("OS credential encryption is unavailable.");
    const key = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
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
    try {
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
        source: "provider-api",
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
  ipc("chat:cancel", z.object({ id }), (a) => requests.get(a.id)?.abort());
  ipc(
    "settings:save",
    z.object({
      provider,
      model: z.string().trim().max(100),
      key: z.string().trim().max(1000).optional(),
    }),
    (a) => {
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
