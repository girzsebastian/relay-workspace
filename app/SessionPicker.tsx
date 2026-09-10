import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { ago } from "./RecoveryPanel";
import { call, type Agent, type Project, type Session } from "./types";

export const providerNames: Record<string, string> = {
  shell: "Shell",
  codex: "Codex",
  claude: "Claude Code",
  opencode: "OpenCode",
  build: "Build",
};

// Every coding session used to read "Claude Code · Claude Code", which told you
// nothing when a dozen were open. What distinguishes them is who was running,
// in which workspace, doing what, and when.
export function describeSession(
  session: Session,
  projects: Project[],
  agents: Agent[] = [],
  summary?: string,
) {
  const agent = agents.find((a) => a.id === session.agentId);
  const project = projects.find((p) => p.id === session.projectId);
  const provider = providerNames[session.kind] || session.kind;
  const label =
    session.kind === "build"
      ? session.command || session.title
      : agent?.name || session.title || provider;
  const when =
    session.status === "running"
      ? "running"
      : `${session.status} ${ago(session.endedAt || session.heartbeatAt || session.startedAt)}`;
  // Naming the provider again after a label that already is the provider
  // produced "Claude Code · … · Claude Code · running".
  const detail = [project?.name, label === provider ? null : provider, when]
    .filter(Boolean)
    .join(" · ");
  const task = agent?.lastTask || session.task || null;
  const description = summary || (task ? String(task) : null);
  return {
    label,
    detail,
    description: description
      ? description.replace(/\s+/g, " ").trim().slice(0, 160)
      : null,
    full: [label, detail, task, summary]
      .filter(Boolean)
      .join(String.fromCharCode(10)),
    running: session.status === "running",
  };
}
export default function SessionPicker({
  sessions,
  projects,
  agents,
  value,
  label,
  onChange,
  onError,
}: {
  sessions: Session[];
  projects: Project[];
  agents?: Agent[];
  value: string | null;
  label: string;
  onChange: (id: string | null) => void;
  onError?: (error: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    call<Record<string, string>>("sessions:summaries", {})
      .then(setSummaries)
      // Without descriptions the list still works, it just says less.
      .catch(() => setSummaries({}));
  }, [open]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const current = sessions.find((s) => s.id === value);
  const chosen = current
    ? describeSession(current, projects, agents, summaries[current.id])
    : { label: "Choose a session…", detail: "", full: "", running: false };
  return (
    <div className="session-picker" ref={box}>
      <button
        className="session-current"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        title={chosen.full || undefined}
        onClick={() => setOpen(!open)}
      >
        <span>{chosen.label}</span>
        {chosen.detail && <small>{chosen.detail}</small>}
        <ChevronDown size={12} />
      </button>
      {open && (
        <ul className="session-list" role="listbox" aria-label={label}>
          <li>
            <button
              role="option"
              aria-selected={!value}
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              <span className="session-label">Empty this pane</span>
            </button>
          </li>
          {sessions.map((session) => {
            const info = describeSession(
              session,
              projects,
              agents,
              summaries[session.id],
            );
            return (
              <li key={session.id} className="picker-row">
                <button
                  role="option"
                  data-session-id={session.id}
                  aria-selected={session.id === value}
                  // The whole description on hover, because a row is one line.
                  title={info.full}
                  onClick={() => {
                    onChange(session.id);
                    setOpen(false);
                  }}
                >
                  <span className={`provider-dot ${session.kind}`} />
                  <span className="session-text">
                    <span className="session-label">
                      {info.label}
                      {info.running && <i className="session-live" />}
                    </span>
                    <small>{info.detail}</small>
                    {info.description && (
                      <small className="session-task">{info.description}</small>
                    )}
                  </span>
                  {session.id === value && <Check size={13} />}
                </button>
                <button
                  className="session-dismiss"
                  aria-label={`Remove ${info.label} from this list`}
                  title={
                    info.running
                      ? "Stop this terminal before removing it from the list"
                      : "Remove from this list; its saved output is kept"
                  }
                  disabled={info.running}
                  onClick={(event) => {
                    // The list stays open so several can be cleared at once.
                    event.stopPropagation();
                    call("terminal:dismiss", { id: session.id }).catch(
                      (error) => onError?.(error),
                    );
                  }}
                >
                  <X size={12} />
                </button>
              </li>
            );
          })}
          {!sessions.length && (
            <li className="session-empty">
              No terminals in this workspace yet.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
