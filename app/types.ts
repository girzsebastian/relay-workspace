export type View =
  | "overview"
  | "workspace"
  | "agents"
  | "usage"
  | "integrations"
  | "settings"
  | "board"
  | "terminal-grid";
export type Provider = "openai" | "anthropic";
export type Role = "builder" | "architect" | "reviewer" | "product";
export type Draft = {
  path: string;
  content: string;
  hash: string;
  dirty: boolean;
};
export type EditorState = {
  tabs: Draft[];
  primary: string | null;
  secondary: string | null;
  focusedPane: 1 | 2;
};
export type Project = {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  draft?: Draft | null;
  expandedPaths?: string[];
  editor?: EditorState;
};
export type Session = {
  id: string;
  projectId: string;
  kind: "shell" | "codex" | "claude" | "opencode" | "build";
  title: string;
  status: string;
  startedAt: number;
  heartbeatAt: number;
  endedAt?: number;
  exitCode?: number;
  command?: string;
  providerSessionId?: string;
  recoveredFrom?: string;
  agentId?: string;
  lastOutputAt?: number;
  activity?: { at: number; bytes: number }[];
};
export type AgentTask = {
  id: string;
  agentId: string;
  text: string;
  status:
    | "queued"
    | "starting"
    | "running"
    | "review"
    | "done"
    | "failed"
    | "interrupted"
    | "cancelled";
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  sessionId: string | null;
  exitCode?: number;
  error?: string;
};
export type Agent = {
  memory?: string;
  origin?: "terminal" | "named";
  id: string;
  name: string;
  projectId: string;
  provider: "codex" | "claude" | "opencode";
  instructions: string;
  skillPath?: string;
  createdAt: number;
  stage: "ready" | "review";
  sessionId: string | null;
  lastTask?: string;
};
export type TerminalSizing = {
  column: number;
  first: number;
  second: number;
  row: number;
};
export type Preferences = {
  terminalSizing: TerminalSizing;
  theme: "light" | "dark";
  terminalLayout: 2 | 4 | 6;
  editorTerminalLayout: 1 | 2 | 4;
  gridSessionIds: (string | null)[];
  editorSessionIds: (string | null)[];
  gridScope: string;
  showExplorer: boolean;
  showChat: boolean;
  showTerminal: boolean;
  splitEditor: boolean;
  explorerWidth: number;
  chatWidth: number;
  terminalHeight: number;
  editorSplit: number;
};
export const defaultPreferences: Preferences = {
  terminalSizing: { column: 50, first: 33, second: 67, row: 50 },
  theme: "dark",
  terminalLayout: 4,
  editorTerminalLayout: 1,
  gridSessionIds: [],
  editorSessionIds: [],
  gridScope: "all",
  showExplorer: true,
  showChat: true,
  showTerminal: true,
  splitEditor: false,
  explorerWidth: 230,
  chatWidth: 350,
  terminalHeight: 260,
  editorSplit: 50,
};
export type Chat = {
  id: string;
  projectId: string;
  title: string;
  provider: Provider;
  model: string;
  role: Role;
  status: string;
  error?: string;
  skillPath?: string;
  messages: {
    id: string;
    role: "user" | "assistant";
    content: string;
    createdAt: number;
  }[];
};
export type Usage = {
  id: string;
  projectId: string;
  chatId: string;
  provider: Provider;
  model: string;
  createdAt: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  measured: boolean;
  durationMs: number;
};
export type State = {
  projects: Project[];
  sessions: Session[];
  chats: Chat[];
  usage: Usage[];
  agents: Agent[];
  tasks: AgentTask[];
  settings: { provider: Provider; models: Record<Provider, string> };
  ui: Partial<Preferences> & {
    view: View;
    projectId: string | null;
    chatId: string | null;
    sessionId: string | null;
  };
  capabilities: {
    codex: boolean;
    claude: boolean;
    opencode: boolean;
    secureStorage: boolean;
    configured: string[];
    platform: string;
  };
};
export type FileEntry = { name: string; path: string; directory: boolean };
export type Skill = { name: string; path: string; content: string };
export type RelayEvent = {
  type: string;
  id?: string;
  data?: string;
  message?: string;
  sequence?: number;
  command?: string;
};
declare global {
  interface Window {
    relay?: {
      call: (name: string, args?: unknown) => Promise<any>;
      subscribe: (cb: (event: RelayEvent) => void) => () => void;
    };
  }
}
export async function call<T = any>(name: string, args?: unknown): Promise<T> {
  if (!window.relay)
    throw new Error(
      "Open Relay as a desktop app with npm start. Browser previews cannot access your computer.",
    );
  return window.relay.call(name, args);
}
