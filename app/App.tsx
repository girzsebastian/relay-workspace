import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Command,
  Cpu,
  FileCode2,
  Folder,
  FolderOpen,
  GitBranch,
  Layers3,
  LayoutDashboard,
  MessageSquare,
  MoreHorizontal,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Search,
  RotateCcw,
  Save,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  TerminalSquare,
  X,
  Zap,
  type LucideIcon,
  PanelsTopLeft,
  KanbanSquare,
  Sun,
  Moon,
} from "lucide-react";
import {
  call,
  type Chat,
  type Draft,
  type FileEntry,
  type Project,
  type Provider,
  type Role,
  type Session,
  type Skill,
  type State,
  type View,
  type Preferences,
  defaultPreferences,
  type ChatMode,
} from "./types";
import {
  apiProviderLabels,
  cliInstalled,
  cliProviders,
  isCliProvider,
  providerBlockedReason,
  providerLabel,
  providerReady,
} from "./providers";
import SettingsView from "./SettingsView";
import ChatSteps from "./ChatSteps";
import Markdown from "./Markdown";
import ApprovalCard from "./ApprovalCard";
import RecoveryPanel from "./RecoveryPanel";
import Editor from "./Editor";
import TerminalDeck, { LayoutButtons } from "./TerminalDeck";
import AgentBoard from "./AgentBoard";
import EditorWorkspace from "./EditorWorkspace";
import ResizeHandle from "./ResizeHandle";

const roleInfo: {
  id: Role;
  name: string;
  icon: LucideIcon;
  color: string;
  description: string;
  prompt: string;
}[] = [
  {
    id: "builder",
    name: "Builder",
    icon: Code2,
    color: "green",
    description: "Turn your next idea into a concrete implementation plan.",
    prompt:
      "Help me build the next feature. Start by asking what outcome I need and what code you should see.",
  },
  {
    id: "architect",
    name: "Architect",
    icon: Layers3,
    color: "blue",
    description: "Make technical decisions that stay simple as you grow.",
    prompt:
      "Help me choose an architecture. Ask about my users, constraints, and existing stack.",
  },
  {
    id: "reviewer",
    name: "Reviewer",
    icon: ShieldCheck,
    color: "orange",
    description: "Find the bugs and edge cases before your users do.",
    prompt:
      "Review the code I share for correctness, security, and missing coverage.",
  },
  {
    id: "product",
    name: "Product partner",
    icon: Sparkles,
    color: "purple",
    description:
      "Shape the problem, map the journey, and define the next step.",
    prompt:
      "Help me turn my idea into a focused product brief and first experiment.",
  },
];
const nav: { id: View; name: string; icon: LucideIcon }[] = [
  { id: "workspace", name: "Workspace", icon: TerminalSquare },
  { id: "board", name: "Agent board", icon: KanbanSquare },
  { id: "terminal-grid", name: "Terminal grid", icon: PanelsTopLeft },
  { id: "agents", name: "Profiles & skills", icon: Bot },
  { id: "usage", name: "Usage", icon: Zap },
  { id: "integrations", name: "Integrations", icon: Plug },
];
const blank: State = {
  projects: [],
  sessions: [],
  chats: [],
  usage: [],
  agents: [],
  tasks: [],
  settings: { provider: "openai", models: { openai: "", anthropic: "" } },
  ui: { view: "workspace", projectId: null, chatId: null, sessionId: null },
  capabilities: {
    codex: false,
    claude: false,
    opencode: false,
    secureStorage: false,
    configured: [],
    platform: "",
  },
};
const compact = (value: number) =>
  Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
const ago = (at: number) => {
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
  return minutes < 1
    ? "Just now"
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : `${Math.floor(minutes / 1440)}d ago`;
};
const duration = (s: Session) =>
  Math.max(0, ((s.endedAt || s.heartbeatAt) - s.startedAt) / 60000);
function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      <span />
      {status === "running"
        ? "Running"
        : status === "interrupted"
          ? "Ready to recover"
          : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
function Empty({
  icon: Icon = FolderOpen,
  title,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={27} strokeWidth={1.4} />
      </div>
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<State>(blank),
    [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("workspace"),
    [projectId, setProjectId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null),
    [chatId, setChatId] = useState<string | null>(null);
  const [toast, setToast] = useState(""),
    [search, setSearch] = useState(""),
    [role, setRole] = useState<Role>("builder"),
    [chatMode, setChatMode] = useState<ChatMode>("agent");
  const [composer, setComposer] = useState(""),
    [modal, setModal] = useState<"build" | "bind" | null>(null),
    [command, setCommand] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]),
    [skillPath, setSkillPath] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [preferences, setPreferences] =
    useState<Preferences>(defaultPreferences);
  const updatePreferences = (patch: Partial<Preferences>) =>
    setPreferences((p) => ({ ...p, ...patch }));
  const showError = useCallback(
    (e: unknown) =>
      setToast(
        e instanceof Error
          ? e.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              "",
            )
          : String(e),
      ),
    [],
  );
  const commandHandler = useRef<(command: string) => void>(() => {});
  const refresh = useCallback(async () => {
    try {
      setState(await call<State>("state"));
    } catch (e) {
      showError(e);
    }
  }, [showError]);
  useEffect(() => {
    call<State>("state")
      .then((s) => {
        setState(s);
        setView(s.ui.view);
        setProjectId(s.ui.projectId);
        setSessionId(s.ui.sessionId);
        setPreferences(
          Object.fromEntries(
            Object.entries(defaultPreferences).map(([key, value]) => [
              key,
              s.ui[key as keyof typeof s.ui] ?? value,
            ]),
          ) as Preferences,
        );
        setChatId(s.ui.chatId);
      })
      .catch(showError)
      .finally(() => setReady(true));
    return window.relay?.subscribe((e) => {
      if (e.type === "command" && e.command) commandHandler.current(e.command);
      if (e.type === "changed") void refresh();
      if (e.type === "error") showError(e.message);
    });
  }, [refresh, showError]);
  useEffect(() => {
    if (ready)
      call("ui:update", {
        view,
        projectId,
        sessionId,
        chatId,
        ...preferences,
      }).catch(showError);
  }, [view, projectId, sessionId, chatId, preferences, ready, showError]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 10000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    setSkillPath("");
    setSkills([]);
    if (projectId) {
      let cancelled = false;
      call<Skill[]>("skills:list", { projectId })
        .then((s) => {
          if (!cancelled) setSkills(s);
        })
        .catch(showError);
      return () => {
        cancelled = true;
      };
    }
  }, [projectId, showError]);
  const project = state.projects.find((p) => p.id === projectId);
  const [openRequest, setOpenRequest] = useState<{
    path: string;
    token: number;
  } | null>(null);
  const pendingApprovals = (state.approvals || []).filter(
    (a) => a.status === "pending" && (!chatId || a.chatId === chatId),
  );
  const projectSessions = state.sessions.filter(
    (s) => s.projectId === projectId && !s.dismissedAt,
  );
  const terminalTabs = projectSessions.filter((s) => s.kind !== "build");
  const projectChats = state.chats.filter((c) => c.projectId === projectId);
  const selectedSession =
    projectSessions.find((s) => s.id === sessionId) || projectSessions.at(-1);
  const selectedChat = projectChats.find((c) => c.id === chatId);
  const running = state.sessions.filter((s) => s.status === "running");
  const interrupted = state.sessions.filter(
    (s) =>
      s.status === "interrupted" &&
      !state.sessions.some((n) => n.recoveredFrom === s.id),
  );
  const measured = state.usage.filter((u) => u.measured);
  const totalTokens = measured.reduce(
    (sum, u) =>
      sum +
      (u.input || 0) +
      (u.output || 0) +
      (u.provider === "anthropic"
        ? (u.cacheRead || 0) + (u.cacheWrite || 0)
        : 0),
    0,
  );
  const addProject = async () => {
    try {
      const p = await call<Project | null>("project:add");
      if (p) {
        setProjectId(p.id);
        await refresh();
        setView("workspace");
      }
    } catch (e) {
      showError(e);
    }
  };
  const openProject = (id: string) => {
    setProjectId(id);
    setSessionId(null);
    setChatId(null);
    setView("workspace");
  };
  const startTerminal = async (kind: Session["kind"], cmd?: string) => {
    if (!projectId) {
      setToast("Open a project first.");
      return;
    }
    try {
      const s = await call<Session>("terminal:start", {
        projectId,
        kind,
        ...(cmd ? { command: cmd } : {}),
      });
      setSessionId(s.id);
      updatePreferences({
        showTerminal: true,
        editorSessionIds: [
          s.id,
          ...preferences.editorSessionIds.filter((id) => id !== s.id),
        ].slice(0, 4),
      });
      setView("workspace");
      await refresh();
    } catch (e) {
      showError(e);
    }
  };
  const recover = async (s: Session) => {
    try {
      const next = await call<Session>("terminal:recover", { id: s.id });
      setProjectId(s.projectId);
      setSessionId(next.id);
      setView("workspace");
      await refresh();
    } catch (e) {
      showError(e);
    }
  };
  const send = async () => {
    if (!project || !composer.trim() || chatBusy) return;
    setChatBusy(true);
    const message = composer;
    try {
      let chat = selectedChat;
      if (!chat) {
        const provider = state.settings.provider,
          model = state.settings.models[provider] || "";
        if (!providerReady(state, provider)) {
          setToast(
            providerBlockedReason(state, provider) ||
              "Choose a chat provider in Settings first.",
          );
          setView("settings");
          return;
        }
        chat = await call<Chat>("chat:create", {
          projectId,
          provider,
          model,
          role,
          mode: chatMode,
          ...(skillPath ? { skillPath } : {}),
        });
        setChatId(chat.id);
      }
      setComposer("");
      await call("chat:send", { id: chat.id, message });
      await refresh();
    } catch (e) {
      setComposer(message);
      showError(e);
    } finally {
      setChatBusy(false);
    }
  };
  const agentChat = (r: Role) => {
    setRole(r);
    setChatId(null);
    setComposer(roleInfo.find((a) => a.id === r)!.prompt);
    setView("workspace");
  };

  const openGrid = (session: Session) => {
    setProjectId(session.projectId);
    setSessionId(session.id);
    updatePreferences({
      gridScope: "all",
      gridSessionIds: [
        session.id,
        ...preferences.gridSessionIds.filter((id) => id !== session.id),
      ].slice(0, 6),
    });
    setView("terminal-grid");
  };
  commandHandler.current = (command) => {
    if (command === "open-project") void addProject();
    else if (command.startsWith("view-")) setView(command.slice(5) as View);
    else if (command === "settings") setView("settings");
    else if (command.startsWith("new-"))
      void startTerminal(command.slice(4) as Session["kind"]);
    else if (command === "build") {
      setCommand("npm run build");
      setModal("build");
    } else if (command === "toggle-explorer")
      updatePreferences({ showExplorer: !preferences.showExplorer });
    else if (command === "toggle-chat")
      updatePreferences({ showChat: !preferences.showChat });
    else if (command === "toggle-terminal")
      updatePreferences({ showTerminal: !preferences.showTerminal });
    else if (command === "split-editor")
      updatePreferences({ splitEditor: !preferences.splitEditor });
    else if (command === "theme")
      updatePreferences({
        theme: preferences.theme === "dark" ? "light" : "dark",
      });
    else if (command === "reset-layout")
      setPreferences({ ...defaultPreferences, theme: preferences.theme });
    else
      window.dispatchEvent(
        new CustomEvent("relay-command", { detail: command }),
      );
  };
  const projectTokens = measured
    .filter((u) => u.projectId === projectId)
    .reduce(
      (n, u) =>
        n +
        (u.input || 0) +
        (u.output || 0) +
        (u.provider === "anthropic"
          ? (u.cacheRead || 0) + (u.cacheWrite || 0)
          : 0),
      0,
    );
  return (
    <div
      className="app-shell"
      data-theme={preferences.theme}
      data-platform={state.capabilities.platform}
      data-ready={ready}
    >
      <aside className="activity-rail">
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={view === n.id ? "active" : ""}
              title={n.name}
              aria-label={n.name}
              onClick={() => setView(n.id)}
            >
              <n.icon size={21} strokeWidth={1.6} />
            </button>
          ))}
        </nav>
        <button
          className={
            view === "settings" ? "active rail-settings" : "rail-settings"
          }
          title="Settings & providers"
          aria-label="Settings & providers"
          onClick={() => setView("settings")}
        >
          <Settings2 size={21} />
        </button>
      </aside>
      <div className="main-shell">
        <header className="ide-titlebar">
          <div className="project-switch">
            <button title="Add workspace" onClick={addProject}>
              <FolderOpen size={16} />
            </button>
            <select
              aria-label="Current project"
              value={projectId || ""}
              onChange={(e) => openProject(e.target.value)}
            >
              <option value="" disabled>
                Open a project
              </option>
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="window-document" title={project?.path}>
            {project?.name || "Relay"}
            <span> / </span>
            {nav.find((n) => n.id === view)?.name || "Settings"}
          </div>
          <div className="view-switcher">
            {(
              [
                { id: "workspace", title: "Editor view", icon: Code2 },
                { id: "board", title: "Board view", icon: KanbanSquare },
                {
                  id: "terminal-grid",
                  title: "Grid view",
                  icon: PanelsTopLeft,
                },
              ] as const
            ).map((v) => (
              <button
                key={v.id}
                className={view === v.id ? "selected" : ""}
                title={v.title}
                aria-label={v.title}
                onClick={() => setView(v.id)}
              >
                <v.icon size={14} />
                <span>{v.title.split(" ")[0]}</span>
              </button>
            ))}
          </div>
          <div className="layout-controls">
            {view === "workspace" &&
              (
                [
                  {
                    key: "showExplorer",
                    title: "Toggle explorer",
                    icon: Folder,
                  },
                  {
                    key: "showTerminal",
                    title: "Toggle terminal panel",
                    icon: TerminalSquare,
                  },
                  {
                    key: "showChat",
                    title: "Toggle chat panel",
                    icon: MessageSquare,
                  },
                  {
                    key: "splitEditor",
                    title: "Split editor",
                    icon: PanelsTopLeft,
                  },
                ] as const
              ).map((control) => (
                <button
                  key={control.key}
                  title={control.title}
                  aria-pressed={preferences[control.key]}
                  onClick={() =>
                    updatePreferences({
                      [control.key]: !preferences[control.key],
                    })
                  }
                >
                  <control.icon size={15} />
                </button>
              ))}
            {view === "workspace" && (
              <button
                title="Reset layout"
                onClick={() => commandHandler.current("reset-layout")}
              >
                <RotateCcw size={14} />
              </button>
            )}
            <button
              title="Toggle light / dark theme"
              onClick={() => commandHandler.current("theme")}
            >
              {preferences.theme === "dark" ? (
                <Sun size={15} />
              ) : (
                <Moon size={15} />
              )}
            </button>
          </div>
        </header>
        <RecoveryPanel onOpen={openGrid} onError={showError} />
        <main
          className={
            (view === "workspace" && project) ||
            view === "terminal-grid" ||
            view === "board"
              ? "main-content workbench-content"
              : "main-content"
          }
        >
          {view === "board" && (
            <AgentBoard
              state={state}
              projectId={projectId}
              onOpen={openGrid}
              onError={showError}
            />
          )}
          {view === "terminal-grid" && (
            <div className="terminal-grid-page">
              <div className="command-heading">
                <div>
                  <div className="command-title">
                    <PanelsTopLeft size={21} />
                    <h1>Terminal trenches</h1>
                    <span className="board-count">{running.length} live</span>
                  </div>
                </div>
                <div className="command-heading-actions">
                  <select
                    aria-label="Filter terminal grid by project"
                    value={preferences.gridScope}
                    onChange={(e) =>
                      updatePreferences({
                        gridScope: e.target.value,
                        gridSessionIds: [],
                      })
                    }
                  >
                    <option value="all">All projects</option>
                    {state.projects.map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <LayoutButtons
                    value={preferences.terminalLayout}
                    options={[2, 4, 6]}
                    onChange={(value) =>
                      updatePreferences({ terminalLayout: value as 2 | 4 | 6 })
                    }
                  />
                </div>
              </div>
              <TerminalDeck
                sizing={preferences.terminalSizing}
                onSizing={(terminalSizing) =>
                  updatePreferences({ terminalSizing })
                }
                sessions={state.sessions.filter(
                  (s) =>
                    !s.dismissedAt &&
                    (preferences.gridScope === "all" ||
                      s.projectId === preferences.gridScope),
                )}
                projects={state.projects.filter(
                  (p) =>
                    preferences.gridScope === "all" ||
                    p.id === preferences.gridScope,
                )}
                agents={state.agents}
                count={preferences.terminalLayout}
                pinned={preferences.gridSessionIds}
                onPins={(ids) => updatePreferences({ gridSessionIds: ids })}
                onError={showError}
              />
            </div>
          )}
          {view === "overview" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">YOUR WORK, CONTINUED</span>
                  <h1>
                    Pick up where you left off<span>.</span>
                  </h1>
                  <p>
                    All your projects, agents, and conversations. One place to
                    come back to.
                  </p>
                </div>
                <button className="button primary" onClick={addProject}>
                  <Plus size={16} />
                  Add workspace
                </button>
              </div>
              <div className="stats-grid">
                <Stat
                  label="Projects"
                  value={String(state.projects.length)}
                  note="A home for every idea"
                  icon={Folder}
                />
                <Stat
                  label="Active terminals"
                  value={String(running.length).padStart(2, "0")}
                  note={
                    running.length
                      ? "Running on this computer"
                      : "Ready when you are"
                  }
                  icon={TerminalSquare}
                />
                <Stat
                  label="API tokens used"
                  value={compact(totalTokens)}
                  note="Measured here · All time"
                  icon={Zap}
                />
                <Stat
                  label="Build time"
                  value={`${state.sessions
                    .filter((s) => s.kind === "build")
                    .reduce((sum, s) => sum + duration(s), 0)
                    .toFixed(1)}`}
                  suffix="min"
                  note="Tracked commands · All time"
                  icon={Clock3}
                />
              </div>
              <div className="continuity-banner">
                <div className="continuity-symbol">
                  <RotateCcw size={23} />
                </div>
                <div>
                  <b>
                    {interrupted.length
                      ? `${interrupted.length} terminal${interrupted.length === 1 ? "" : "s"} ready to recover`
                      : "A fresh start shouldn’t mean starting over."}
                  </b>
                  <p>
                    {interrupted.length
                      ? "Your history is saved. Choose a session below to continue."
                      : "Close the window to keep working in the background. Restart, then recover saved work."}
                  </p>
                </div>
                <span className="subtle-pill">
                  Continuity built in
                  <Check size={13} />
                </span>
              </div>
              <div className="section-title">
                <div>
                  <h2>
                    Your projects <span>{state.projects.length}</span>
                  </h2>
                  <p>Less setup. More making things.</p>
                </div>
                <label className="search-field">
                  <Search size={15} />
                  <input
                    aria-label="Search projects"
                    placeholder="Find a project…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              </div>
              <div className="project-grid">
                {state.projects
                  .filter((p) =>
                    p.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((p, i) => {
                    const active = state.sessions.filter(
                      (s) => s.projectId === p.id && s.status === "running",
                    ).length;
                    const chats = state.chats.filter(
                      (c) => c.projectId === p.id,
                    ).length;
                    return (
                      <button
                        className="project-card"
                        key={p.id}
                        onClick={() => openProject(p.id)}
                      >
                        <div className="project-card-top">
                          <span className={`folder-tile tile-${i % 4}`}>
                            <Folder size={21} />
                          </span>
                          <ArrowUpRight size={17} />
                        </div>
                        <h3>{p.name}</h3>
                        <p className="project-path">{p.path}</p>
                        <div className="project-card-footer">
                          <span>
                            <MessageSquare size={13} />
                            {chats} conversations
                          </span>
                          <span>
                            {active ? (
                              <>
                                <span className="live-dot" />
                                {active} active
                              </>
                            ) : (
                              "Open workspace →"
                            )}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                <button
                  className="project-card add-project"
                  onClick={addProject}
                >
                  <span className="add-circle">
                    <Plus size={24} />
                  </span>
                  <h3>Bring your next idea</h3>
                  <p>Open a folder. Keep everything together.</p>
                </button>
              </div>
              <div className="overview-bottom">
                <section className="panel session-panel">
                  <div className="panel-heading">
                    <h2>Recent sessions</h2>
                    <span className="muted">Saved automatically</span>
                  </div>
                  {!state.sessions.length ? (
                    <Empty
                      icon={TerminalSquare}
                      title="Your next session starts here"
                    >
                      <p>
                        Open a project and launch Codex, Claude Code, or a
                        terminal.
                      </p>
                    </Empty>
                  ) : (
                    [...state.sessions]
                      .reverse()
                      .slice(0, 5)
                      .map((s) => (
                        <button
                          className="session-row"
                          key={s.id}
                          onClick={() => {
                            setProjectId(s.projectId);
                            setSessionId(s.id);
                            setView("workspace");
                          }}
                        >
                          <span className={`session-icon ${s.kind}`}>
                            <TerminalSquare size={17} />
                          </span>
                          <span className="session-description">
                            <b>{s.title}</b>
                            <small>
                              {
                                state.projects.find((p) => p.id === s.projectId)
                                  ?.name
                              }{" "}
                              · {ago(s.startedAt)}
                            </small>
                          </span>
                          <Badge status={s.status} />
                          <ChevronRight size={15} />
                        </button>
                      ))
                  )}
                </section>
                <section className="get-started-panel">
                  <span className="eyebrow">A LITTLE LESS FRICTION</span>
                  <h2>
                    Your tools.
                    <br />A better place to work.
                  </h2>
                  <p>
                    Keep the CLI tools you know. Add an editor, saved chats, and
                    a clear view of your usage.
                  </p>
                  <div className="provider-chips">
                    <span>◉ Codex</span>
                    <span>✳ Claude Code</span>
                    <span>
                      <TerminalSquare size={12} />
                      Shell
                    </span>
                  </div>
                  <button onClick={() => setView("integrations")}>
                    Explore integrations
                    <ArrowRight size={16} />
                  </button>
                </section>
              </div>
            </>
          )}

          {view === "workspace" &&
            (!project ? (
              <Empty title="Give your work a home">
                <p>
                  Open a local project folder to use the editor, AI chat, and
                  terminals.
                </p>
                <button className="button primary" onClick={addProject}>
                  <FolderOpen size={16} />
                  Add workspace
                </button>
              </Empty>
            ) : (
              <>
                <div
                  className={`workbench ${preferences.showChat ? "" : "chat-hidden"} ${preferences.showTerminal ? "" : "terminal-hidden"}`}
                  style={
                    {
                      "--chat-width": `${preferences.chatWidth}px`,
                      "--terminal-height": `${preferences.terminalHeight}px`,
                    } as React.CSSProperties
                  }
                >
                  <EditorWorkspace
                    key={project.id}
                    project={project}
                    projects={state.projects}
                    openRequest={openRequest}
                    onError={showError}
                    preferences={preferences}
                    onPreferences={updatePreferences}
                  />
                  {preferences.showChat && (
                    <>
                      <ResizeHandle
                        axis="x"
                        label="Resize chat"
                        value={preferences.chatWidth}
                        min={240}
                        max={Math.min(800, window.innerWidth * 0.45)}
                        reverse
                        onChange={(chatWidth) =>
                          updatePreferences({ chatWidth })
                        }
                      />
                      <section className="chat-pane">
                        <div className="pane-heading">
                          <span>
                            <MessageSquare size={15} />
                            AI chat
                          </span>
                          <button
                            title="New conversation"
                            onClick={() => {
                              setChatId(null);
                              setComposer("");
                            }}
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                        <div className="chat-controls">
                          <select
                            aria-label="Conversation"
                            value={selectedChat?.id || ""}
                            onChange={(e) => setChatId(e.target.value || null)}
                          >
                            <option value="">New conversation</option>
                            {[...projectChats].reverse().map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.title}
                              </option>
                            ))}
                          </select>
                          <div className="chat-agent">
                            <span className="agent-mini">
                              <Bot size={15} />
                            </span>
                            <select
                              aria-label="Agent profile"
                              disabled={!!selectedChat}
                              value={selectedChat?.role || role}
                              onChange={(e) => setRole(e.target.value as Role)}
                            >
                              {roleInfo.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name}
                                </option>
                              ))}
                            </select>
                            <span className="api-badge">API</span>
                          </div>
                          {!selectedChat && skills.length > 0 && (
                            <select
                              aria-label="Project skill"
                              value={skillPath}
                              onChange={(e) => setSkillPath(e.target.value)}
                            >
                              <option value="">
                                No project skill attached
                              </option>
                              {skills.map((s) => (
                                <option key={s.path} value={s.path}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                        <div className="chat-messages">
                          {!selectedChat?.messages.length ? (
                            <div className="chat-welcome">
                              <h3>New conversation</h3>
                              <p>Ask a question or paste code to review.</p>
                              <div className="prompt-options">
                                {[
                                  "Help me plan my next feature",
                                  "Review code I paste here",
                                  "Turn my idea into a product brief",
                                ].map((p) => (
                                  <button
                                    key={p}
                                    onClick={() => setComposer(p)}
                                  >
                                    {p}
                                    <ArrowUpRight size={13} />
                                  </button>
                                ))}
                              </div>
                              <small>
                                Chat uses your API key. Paste code to share
                                context; it cannot read or edit files.
                              </small>
                            </div>
                          ) : (
                            selectedChat.messages.map((m) => (
                              <div
                                key={m.id}
                                className={`chat-message ${m.role}`}
                              >
                                <div className="message-author">
                                  {m.role === "user" ? (
                                    <span className="tiny-avatar">Y</span>
                                  ) : (
                                    <Bot size={15} />
                                  )}
                                  <b>
                                    {m.role === "user"
                                      ? "You"
                                      : roleInfo.find(
                                          (r) => r.id === selectedChat.role,
                                        )?.name}
                                  </b>
                                </div>
                                {m.steps && m.steps.length > 0 && (
                                  <ChatSteps
                                    steps={m.steps}
                                    durationMs={m.durationMs}
                                    running={
                                      selectedChat.status === "running" &&
                                      m ===
                                        selectedChat.messages[
                                          selectedChat.messages.length - 1
                                        ]
                                    }
                                  />
                                )}
                                <div className="message-text">
                                  {m.role === "assistant" ? (
                                    <Markdown text={m.content} />
                                  ) : (
                                    m.content
                                  )}
                                </div>
                              </div>
                            ))
                          )}
                          {pendingApprovals.map((approval) => (
                            <ApprovalCard
                              key={approval.id}
                              approval={approval}
                              onError={showError}
                            />
                          ))}
                          {selectedChat?.status === "running" &&
                            !pendingApprovals.length && (
                              <div className="thinking">
                                <span className="live-dot" />
                                Thinking…
                              </div>
                            )}
                          {selectedChat?.error && (
                            <div className="inline-error">
                              {selectedChat.error}
                            </div>
                          )}
                        </div>
                        <div className="composer-area">
                          <div className="composer">
                            <textarea
                              aria-label="Message your agent"
                              placeholder="What are we working on?"
                              value={composer}
                              onChange={(e) => setComposer(e.target.value)}
                              onKeyDown={(e) => {
                                if (
                                  e.key === "Enter" &&
                                  (e.metaKey || e.ctrlKey)
                                ) {
                                  e.preventDefault();
                                  void send();
                                }
                              }}
                            />
                            <div className="composer-actions">
                              <select
                                aria-label="Agent mode"
                                title="What this conversation is allowed to do"
                                value={selectedChat?.mode || chatMode}
                                onChange={(e) => {
                                  const next = e.target.value as ChatMode;
                                  if (selectedChat)
                                    call("chat:configure", {
                                      id: selectedChat.id,
                                      mode: next,
                                    })
                                      .then(refresh)
                                      .catch(showError);
                                  else setChatMode(next);
                                }}
                              >
                                <option value="agent">Agent</option>
                                <option value="plan">Plan</option>
                                <option value="ask">Ask</option>
                              </select>
                              <select
                                aria-label="Chat mode"
                                value={selectedChat?.role || role}
                                onChange={(e) => {
                                  const next = e.target.value as Role;
                                  if (selectedChat)
                                    call("chat:configure", {
                                      id: selectedChat.id,
                                      role: next,
                                    })
                                      .then(refresh)
                                      .catch(showError);
                                  else setRole(next);
                                }}
                              >
                                {roleInfo.map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.name}
                                  </option>
                                ))}
                              </select>
                              <select
                                aria-label="Chat provider"
                                value={
                                  selectedChat?.provider ||
                                  state.settings.provider
                                }
                                onChange={(e) => {
                                  const next = e.target.value as Provider;
                                  if (selectedChat)
                                    call("chat:configure", {
                                      id: selectedChat.id,
                                      provider: next,
                                      model: state.settings.models[next] || "",
                                    })
                                      .then(refresh)
                                      .catch(showError);
                                  else
                                    call("settings:save", {
                                      provider: next,
                                      model: state.settings.models[next] || "",
                                    })
                                      .then(refresh)
                                      .catch(showError);
                                }}
                              >
                                <optgroup label="Installed CLI">
                                  {Object.entries(cliProviders).map(
                                    ([value, cli]) => (
                                      <option
                                        key={value}
                                        value={value}
                                        disabled={
                                          !cliInstalled(
                                            state,
                                            value as Provider,
                                          )
                                        }
                                      >
                                        {cli.label}
                                      </option>
                                    ),
                                  )}
                                </optgroup>
                                <optgroup label="API key">
                                  {Object.entries(apiProviderLabels).map(
                                    ([value, label]) => (
                                      <option key={value} value={value}>
                                        {label}
                                      </option>
                                    ),
                                  )}
                                </optgroup>
                              </select>
                              <input
                                aria-label="Chat model"
                                className="composer-model"
                                placeholder="Auto"
                                defaultValue={
                                  selectedChat?.model ||
                                  state.settings.models[
                                    state.settings.provider
                                  ] ||
                                  ""
                                }
                                key={selectedChat?.id || "defaults"}
                                onBlur={(e) => {
                                  const next = e.target.value.trim();
                                  if (selectedChat) {
                                    if (next === (selectedChat.model || ""))
                                      return;
                                    call("chat:configure", {
                                      id: selectedChat.id,
                                      model: next,
                                    })
                                      .then(refresh)
                                      .catch(showError);
                                  } else
                                    call("settings:save", {
                                      provider: state.settings.provider,
                                      model: next,
                                    })
                                      .then(refresh)
                                      .catch(showError);
                                }}
                              />
                              {selectedChat?.status === "running" ? (
                                <button
                                  title="Cancel reply"
                                  onClick={() =>
                                    call("chat:cancel", {
                                      id: selectedChat.id,
                                    }).catch(showError)
                                  }
                                >
                                  <Square size={13} />
                                </button>
                              ) : (
                                <button
                                  title="Send message"
                                  disabled={!composer.trim() || chatBusy}
                                  onClick={send}
                                >
                                  <Send size={15} />
                                </button>
                              )}
                            </div>
                          </div>
                          <p className="composer-note">
                            Saved locally · ⌘ / Ctrl + Enter to send
                          </p>
                        </div>
                      </section>
                    </>
                  )}
                  {preferences.showTerminal && (
                    <>
                      <ResizeHandle
                        axis="y"
                        label="Resize terminal"
                        value={preferences.terminalHeight}
                        min={100}
                        max={Math.min(800, window.innerHeight * 0.65)}
                        reverse
                        onChange={(terminalHeight) =>
                          updatePreferences({ terminalHeight })
                        }
                      />
                      <section className="terminal-pane editor-terminals">
                        <div className="terminal-toolbar">
                          <span>
                            <TerminalSquare size={14} />
                            TERMINALS
                          </span>
                          <LayoutButtons
                            value={preferences.editorTerminalLayout}
                            options={[1, 2, 4]}
                            onChange={(value) =>
                              updatePreferences({
                                editorTerminalLayout: value as 1 | 2 | 4,
                              })
                            }
                          />
                          <div className="terminal-tools">
                            <button
                              title="New shell"
                              onClick={() => startTerminal("shell")}
                            >
                              <Plus size={13} />
                              New shell
                            </button>
                            <select
                              className="external-editor-select"
                              aria-label="Start a coding agent in this project"
                              value=""
                              onChange={(e) => {
                                if (e.target.value)
                                  startTerminal(
                                    e.target.value as Session["kind"],
                                  );
                                e.target.value = "";
                              }}
                            >
                              <option value="">Start agent…</option>
                              <option value="codex">Codex</option>
                              <option value="claude">Claude Code</option>
                              <option value="opencode">OpenCode</option>
                            </select>
                            <button
                              title="Run a build command"
                              onClick={() => {
                                setCommand("npm run build");
                                setModal("build");
                              }}
                            >
                              <Play size={13} />
                              Build
                            </button>
                            <select
                              className="external-editor-select"
                              aria-label="Open project in external editor"
                              value=""
                              onChange={(e) => {
                                if (e.target.value)
                                  call("project:open-editor", {
                                    projectId,
                                    editor: e.target.value,
                                  }).catch(showError);
                                e.target.value = "";
                              }}
                            >
                              <option value="">Open in…</option>
                              <option value="cursor">Cursor</option>
                              <option value="code">VS Code</option>
                            </select>
                            <button
                              title="Expand terminal workspace"
                              onClick={() => {
                                if (selectedSession) openGrid(selectedSession);
                                else setView("terminal-grid");
                              }}
                            >
                              <ArrowUpRight size={13} />
                              Expand
                            </button>
                          </div>
                        </div>
                        <div
                          className="terminal-session-tabs"
                          role="tablist"
                          aria-label="Terminal sessions"
                        >
                          {terminalTabs.map((s) => (
                            <span className="terminal-session-tab" key={s.id}>
                              <button
                                role="tab"
                                aria-selected={
                                  (preferences.editorSessionIds[0] ||
                                    selectedSession?.id) === s.id
                                }
                                title={`${s.title} · ${s.status}`}
                                onClick={() => {
                                  setSessionId(s.id);
                                  updatePreferences({
                                    editorSessionIds: [
                                      s.id,
                                      ...preferences.editorSessionIds.filter(
                                        (id) => id !== s.id,
                                      ),
                                    ].slice(0, 4),
                                  });
                                }}
                              >
                                <span className={`provider-dot ${s.kind}`} />
                                {s.title}
                              </button>
                              <button
                                className="tab-dismiss"
                                aria-label={`Remove ${s.title} from this list`}
                                title={
                                  s.status === "running"
                                    ? "Stop this terminal before removing it"
                                    : "Remove from this list (saved output is kept)"
                                }
                                disabled={s.status === "running"}
                                onClick={() =>
                                  call("terminal:dismiss", { id: s.id })
                                    .then(refresh)
                                    .catch(showError)
                                }
                              >
                                <X size={11} />
                              </button>
                            </span>
                          ))}
                        </div>
                        <TerminalDeck
                          sizing={preferences.terminalSizing}
                          onSizing={(terminalSizing) =>
                            updatePreferences({ terminalSizing })
                          }
                          sessions={terminalTabs}
                          projects={[project]}
                          agents={state.agents}
                          count={preferences.editorTerminalLayout}
                          pinned={preferences.editorSessionIds}
                          preferred={selectedSession?.id}
                          onPins={(ids) =>
                            updatePreferences({ editorSessionIds: ids })
                          }
                          onError={showError}
                          onExpand={(id) => {
                            const s = state.sessions.find((s) => s.id === id);
                            if (s) openGrid(s);
                          }}
                        />
                      </section>
                    </>
                  )}
                </div>
              </>
            ))}

          {view === "agents" && (
            <>
              <PageHeading
                eyebrow="THE RIGHT MIND FOR THE MOMENT"
                title="Meet your thinking partners."
                description="Give every conversation a focus. Bring your own project skills."
              />
              <div className="info-strip">
                <CircleHelp size={17} />
                <span>
                  These are chat profiles. Coding agents with tools run in your
                  Codex and Claude Code terminals.
                </span>
              </div>
              <div className="agent-grid">
                {roleInfo.map((a) => (
                  <article className="agent-card" key={a.id}>
                    <div className={`agent-tile ${a.color}`}>
                      <a.icon size={24} />
                    </div>
                    <span className="subtle-pill">Built-in profile</span>
                    <h2>{a.name}</h2>
                    <p>{a.description}</p>
                    <button
                      className="button"
                      disabled={!project}
                      onClick={() => agentChat(a.id)}
                    >
                      Start a conversation
                      <ArrowUpRight size={15} />
                    </button>
                  </article>
                ))}
              </div>
              <section className="panel skills-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Project skills</h2>
                    <p className="muted">
                      {project?.name || "Select a project in the sidebar"}
                    </p>
                  </div>
                  <span className="subtle-pill">SKILL.md</span>
                </div>
                {skills.length ? (
                  skills.map((s) => (
                    <div className="skill-row" key={s.path}>
                      <Braces size={19} />
                      <div>
                        <b>{s.name}</b>
                        <small>{s.path}</small>
                      </div>
                      <span className="muted">Available in new chats</span>
                    </div>
                  ))
                ) : (
                  <Empty icon={Braces} title="Your expertise, made reusable">
                    <p>
                      Add a SKILL.md under .agents/skills/name/ or
                      .claude/skills/name/ in your project. Re-select the
                      project to refresh. Select a skill when starting a new
                      chat.
                    </p>
                  </Empty>
                )}
              </section>
            </>
          )}

          {view === "usage" && <UsageView state={state} onError={showError} />}
          {view === "integrations" && (
            <>
              <PageHeading
                eyebrow="BRING THE TOOLS YOU TRUST"
                title="Everything has its place."
                description="Official coding tools in your terminal. Your API keys for chat."
              />
              <div className="integration-grid">
                {[
                  {
                    name: "Codex",
                    icon: Cpu,
                    installed: state.capabilities.codex,
                    description:
                      "Run the official Codex CLI using its own authentication, skills, MCP servers, and session recovery.",
                  },
                  {
                    name: "Claude Code",
                    icon: Sparkles,
                    installed: state.capabilities.claude,
                    description:
                      "Use the official Claude Code CLI with your existing login, permission prompts, plugins, and project configuration.",
                  },
                ].map((i) => (
                  <article className="panel integration-card" key={i.name}>
                    <div className="integration-card-heading">
                      <i.icon size={25} />
                      <span
                        className={`badge ${i.installed ? "completed" : "interrupted"}`}
                      >
                        <span />
                        {i.installed ? "CLI detected" : "Install CLI"}
                      </span>
                    </div>
                    <h2>{i.name}</h2>
                    <p>{i.description}</p>
                    <small>
                      Detection checks installation, not account access.
                    </small>
                    <button
                      className="button"
                      disabled={!project}
                      onClick={() =>
                        startTerminal(i.name === "Codex" ? "codex" : "claude")
                      }
                    >
                      Open in terminal
                      <ArrowUpRight size={14} />
                    </button>
                  </article>
                ))}
              </div>
              <div className="integration-grid secondary">
                <article className="panel integration-card">
                  <Plug size={25} />
                  <h2>MCP servers</h2>
                  <p>
                    Your official CLI tools load their own MCP settings. Edit
                    project configuration files in the workspace, then manage
                    connections inside the CLI.
                  </p>
                  <code>
                    Claude: .mcp.json
                    <br />
                    Codex: .codex/config.toml
                  </code>
                  <small>
                    The API chat does not execute MCP tools in this alpha.
                  </small>
                </article>
                <article className="panel integration-card">
                  <Layers3 size={25} />
                  <h2>Editor extensions</h2>
                  <p>
                    Relay includes a code editor with syntax highlighting. VS
                    Code extensions require a separate extension host and are on
                    the roadmap.
                  </p>
                  <span className="subtle-pill">Planned · Not installed</span>
                  <small>
                    Cursor subscriptions are not shared API credit. You can
                    continue using Cursor alongside Relay.
                  </small>
                </article>
              </div>
              <div className="info-strip">
                <ShieldCheck size={17} />
                <span>
                  Relay doesn’t copy subscription credentials. Manage CLI logins
                  in the official tool; add separate API keys in Settings.
                </span>
              </div>
            </>
          )}
          {view === "settings" && (
            <SettingsView
              state={state}
              preferences={preferences}
              onPreferences={updatePreferences}
              onCommand={(command) => commandHandler.current(command)}
              onError={showError}
              onSaved={async () => {
                await refresh();
                setToast("Provider settings saved.");
              }}
            />
          )}
        </main>
        <footer className="statusbar">
          <span>
            <GitBranch size={12} />
            {project?.name || "No project"}
          </span>
          <span>
            {projectSessions.filter((s) => s.status === "running").length}{" "}
            terminals running
          </span>
          <span className="statusbar-right">
            <button
              title="Provider-reported API tokens for this repository. CLI subscription usage is not collected."
              onClick={() => setView("usage")}
            >
              <Zap size={12} />
              {compact(projectTokens)} API tokens · CLI —
            </button>
            <button
              title="Running agent processes / saved agents in this repository"
              onClick={() => setView("board")}
            >
              <Bot size={13} />
              Agents:{" "}
              {
                state.agents.filter(
                  (a) =>
                    a.projectId === projectId &&
                    state.sessions.some(
                      (s) => s.id === a.sessionId && s.status === "running",
                    ),
                ).length
              }
              /{state.agents.filter((a) => a.projectId === projectId).length}
            </button>
            <button
              title="Elapsed time of tracked build commands in this repository"
              onClick={() => setView("usage")}
            >
              <Clock3 size={12} />
              {projectSessions
                .filter((s) => s.kind === "build")
                .reduce((n, s) => n + duration(s), 0)
                .toFixed(1)}
              m builds
            </button>
          </span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="alert">
          <CircleHelp size={18} />
          <span>{toast}</span>
          <button title="Dismiss notification" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {modal && (
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={async (e) => {
              e.preventDefault();
              if (modal === "build") await startTerminal("build", command);
              else if (selectedSession) {
                try {
                  await call("terminal:bind", {
                    id: selectedSession.id,
                    providerSessionId: command,
                  });
                  await refresh();
                } catch (error) {
                  showError(error);
                  return;
                }
              }
              setModal(null);
            }}
          >
            <button
              className="modal-close"
              type="button"
              title="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={18} />
            </button>
            <span className="eyebrow">
              {modal === "build"
                ? "TRACK A BUILD"
                : "EXACT CONVERSATION RECOVERY"}
            </span>
            <h2>
              {modal === "build"
                ? "Run it. Measure it."
                : "Link your Codex session."}
            </h2>
            <p>
              {modal === "build"
                ? `This command runs in ${project?.path}. Relay records elapsed wall time and exit status.`
                : "Paste the conversation UUID shown by Codex’s /status command. Recovery will use this exact ID."}
            </p>
            <label>
              {modal === "build" ? "Shell command" : "Conversation UUID"}
              <input
                autoFocus
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                required
              />
            </label>
            <button className="button primary" type="submit">
              {modal === "build" ? "Run command" : "Save session ID"}
              <ArrowRight size={15} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  );
}
function Stat({
  label,
  value,
  note,
  icon: Icon,
  suffix,
}: {
  label: string;
  value: string;
  note: string;
  icon: LucideIcon;
  suffix?: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">
        {label}
        <Icon size={16} />
      </div>
      <div className="stat-value">
        {value}
        <small>{suffix}</small>
      </div>
      <span className="stat-note">{note}</span>
    </div>
  );
}

function UsageView({
  state,
  onError,
}: {
  state: State;
  onError: (error: unknown) => void;
}) {
  const [filter, setFilter] = useState("");
  const rows = state.usage.filter((u) => !filter || u.projectId === filter),
    measured = rows.filter((u) => u.measured);
  const input = measured.reduce(
    (n, r) =>
      n +
      (r.input || 0) +
      (r.provider === "anthropic"
        ? (r.cacheRead || 0) + (r.cacheWrite || 0)
        : 0),
    0,
  );
  const output = measured.reduce((n, r) => n + (r.output || 0), 0);
  const builds = state.sessions.filter(
    (s) => s.kind === "build" && (!filter || s.projectId === filter),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">KNOW WHAT GOES INTO YOUR WORK</span>
          <h1>A little more visibility.</h1>
          <p>
            Actual API usage and tracked build time, attributed to each project.
          </p>
        </div>
        <button
          className="button"
          onClick={() =>
            call("usage:export", filter ? { projectId: filter } : {}).catch(
              onError,
            )
          }
        >
          <ArrowDownToLine size={15} />
          Export JSON
        </button>
      </div>
      <div className="usage-filters">
        <select
          aria-label="Filter usage by project"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">All projects</option>
          {state.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="subtle-pill">All time</span>
      </div>
      <div className="stats-grid">
        <Stat
          label="Input tokens"
          value={compact(input)}
          note="Includes cache reads and writes"
          icon={ArrowRight}
        />
        <Stat
          label="Output tokens"
          value={compact(output)}
          note="Provider-reported tokens"
          icon={Zap}
        />
        <Stat
          label="API replies"
          value={String(rows.length)}
          note={`${measured.length} with usage reported`}
          icon={MessageSquare}
        />
        <Stat
          label="Build time"
          value={builds.reduce((n, s) => n + duration(s), 0).toFixed(1)}
          suffix="min"
          note="Elapsed time, not CPU minutes"
          icon={Clock3}
        />
      </div>
      <div className="info-strip">
        <CircleHelp size={17} />
        <span>
          CLI subscription tokens are not collected yet. Missing usage is
          unknown, not zero. API charges are billed by your provider; Relay does
          not estimate a dollar total.
        </span>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>API activity</h2>
          <span className="muted">Measured in Relay</span>
        </div>
        {!rows.length ? (
          <Empty
            icon={Zap}
            title="Clarity starts with your first conversation."
          >
            <p>
              API responses will add real input, output, and cache counts here.
            </p>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Project / model</th>
                  <th>Provider</th>
                  <th>Input</th>
                  <th>Output</th>
                  <th>Cache read</th>
                  <th>Cache write</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => (
                  <tr key={r.id}>
                    <td>
                      <b>
                        {state.projects.find((p) => p.id === r.projectId)?.name}
                      </b>
                      <small>{r.model}</small>
                    </td>
                    <td>{r.provider}</td>
                    <td>{r.measured ? compact(r.input || 0) : "Unknown"}</td>
                    <td>{r.measured ? compact(r.output || 0) : "—"}</td>
                    <td>{r.measured ? compact(r.cacheRead || 0) : "—"}</td>
                    <td>{r.measured ? compact(r.cacheWrite || 0) : "—"}</td>
                    <td>{ago(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel build-history">
        <div className="panel-heading">
          <h2>Build history</h2>
          <span className="muted">Only commands launched with Run build</span>
        </div>
        {!builds.length ? (
          <p className="panel-empty">
            Run a build from the workspace toolbar to record its duration and
            exit status.
          </p>
        ) : (
          builds
            .slice()
            .reverse()
            .map((s) => (
              <div className="session-row" key={s.id}>
                <Play size={16} />
                <div className="session-description">
                  <b>{s.command}</b>
                  <small>
                    {state.projects.find((p) => p.id === s.projectId)?.name} ·{" "}
                    {duration(s).toFixed(2)} min{" "}
                    {s.exitCode !== undefined ? `· Exit ${s.exitCode}` : ""}
                  </small>
                </div>
                <Badge status={s.status} />
              </div>
            ))
        )}
      </section>
    </>
  );
}
