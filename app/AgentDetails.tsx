import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  Clock3,
  ListTodo,
  Play,
  Save,
  Settings2,
  TerminalSquare,
  X,
} from "lucide-react";
import { call, type Agent, type Session, type State } from "./types";
import { providerNames } from "./TerminalDeck";

export default function AgentDetails({
  agent,
  state,
  onClose,
  onOpen,
  onError,
}: {
  agent: Agent;
  state: State;
  onClose: () => void;
  onOpen: (session: Session) => void;
  onError: (error: unknown) => void;
}) {
  const [tab, setTab] = useState("tasks"),
    [text, setText] = useState(""),
    [name, setName] = useState(agent.name),
    [instructions, setInstructions] = useState(agent.instructions),
    [memory, setMemory] = useState(agent.memory || ""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const panel = useRef<HTMLElement>(null),
    requestClose = useRef<() => void>(() => {});
  const tasks = state.tasks.filter((t) => t.agentId === agent.id),
    runs = state.sessions
      .filter((s) => s.agentId === agent.id)
      .slice()
      .reverse(),
    running = runs.some((s) => s.status === "running"),
    dirty =
      name !== agent.name ||
      instructions !== agent.instructions ||
      memory !== (agent.memory || "");
  const attempt = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    if (!dirty || window.confirm("Discard unsaved agent settings?")) onClose();
  };
  requestClose.current = close;
  useEffect(() => {
    const root = panel.current!;
    const elements = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input,textarea,select,[tabindex='0']",
        ),
      ).filter((e) => e.offsetParent !== null);
    elements()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        requestClose.current();
      }
      if (e.key === "Tab") {
        const nodes = elements(),
          first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    root.addEventListener("keydown", key);
    return () => root.removeEventListener("keydown", key);
  }, []);
  const openSession = (session: Session) => {
    if (
      !dirty ||
      window.confirm("Discard unsaved agent settings and open this session?")
    )
      onOpen(session);
  };
  return (
    <div className="agent-detail-backdrop">
      <section
        ref={panel}
        className="agent-detail"
        role="dialog"
        aria-modal="true"
        aria-label={`${agent.name} details`}
      >
        <header>
          <div className={`agent-avatar ${agent.provider}`}>
            <TerminalSquare size={21} />
          </div>
          <div>
            <h2>{agent.name}</h2>
            <span>
              {providerNames[agent.provider]} ·{" "}
              {state.projects.find((p) => p.id === agent.projectId)?.name}
            </span>
          </div>
          <button title="Close agent details" onClick={close}>
            <X size={18} />
          </button>
        </header>
        <div className="detail-tabs" role="tablist" aria-label="Agent details">
          {[
            { id: "tasks", name: "Tasks", icon: ListTodo },
            { id: "memory", name: "Memory", icon: BookOpen },
            { id: "history", name: "History", icon: Clock3 },
            { id: "settings", name: "Instructions", icon: Settings2 },
          ].map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              <t.icon size={14} />
              {t.name}
              {t.id === "tasks" && (
                <span>{tasks.filter((t) => t.status === "queued").length}</span>
              )}
            </button>
          ))}
        </div>
        <div className="detail-body">
          {tab === "tasks" && (
            <>
              <form
                className="task-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void attempt(async () => {
                    await call("agent:queue", { id: agent.id, task: text });
                    setText("");
                  });
                }}
              >
                <textarea
                  aria-label="Queued task"
                  placeholder="Add a task…"
                  required
                  maxLength={20000}
                  rows={3}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <button
                  className="button primary"
                  disabled={busy || !text.trim()}
                  type="submit"
                >
                  Add to queue
                </button>
              </form>
              <div className="task-list">
                {[...tasks]
                  .sort(
                    (a, b) =>
                      Number(b.status === "queued") -
                        Number(a.status === "queued") ||
                      b.createdAt - a.createdAt,
                  )
                  .map((task) => (
                    <article className="task-item" key={task.id}>
                      <div>
                        <span className={`task-status ${task.status}`}>
                          {task.status === "review"
                            ? "Needs review"
                            : task.status}
                        </span>
                        <time>
                          {new Date(task.createdAt).toLocaleDateString()}
                        </time>
                      </div>
                      <p>{task.text}</p>
                      {task.error && (
                        <small className="inline-error">{task.error}</small>
                      )}
                      <footer>
                        {task.status === "queued" && (
                          <>
                            <button
                              disabled={busy}
                              onClick={() =>
                                void attempt(async () => {
                                  await call("task:resolve", {
                                    id: task.id,
                                    status: "cancelled",
                                  });
                                })
                              }
                            >
                              <X size={12} />
                              Remove
                            </button>
                            <button
                              disabled={busy || running}
                              title={
                                running
                                  ? "Stop the current session first"
                                  : "Start task"
                              }
                              onClick={() =>
                                void attempt(async () => {
                                  const session = await call<Session>(
                                    "task:start",
                                    { id: task.id },
                                  );
                                  openSession(session);
                                })
                              }
                            >
                              <Play size={12} />
                              Start
                            </button>
                          </>
                        )}
                        {task.sessionId && (
                          <button
                            onClick={() => {
                              const s = state.sessions.find(
                                (s) => s.id === task.sessionId,
                              );
                              if (s) openSession(s);
                            }}
                          >
                            <TerminalSquare size={12} />
                            Open session
                          </button>
                        )}
                        {["review", "interrupted", "failed"].includes(
                          task.status,
                        ) && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void attempt(async () => {
                                await call("task:resolve", {
                                  id: task.id,
                                  status: "done",
                                });
                              })
                            }
                          >
                            <Check size={12} />
                            Mark done
                          </button>
                        )}
                      </footer>
                    </article>
                  ))}
              </div>
              {!tasks.length && (
                <div className="detail-empty">
                  <ListTodo size={24} />
                  <p>No tasks yet</p>
                </div>
              )}
            </>
          )}
          {tab === "memory" && (
            <div className="agent-field">
              <label htmlFor="agent-memory">Memory</label>
              <p>Notes and decisions included with this agent’s new tasks.</p>
              <textarea
                id="agent-memory"
                rows={16}
                maxLength={20000}
                value={memory}
                onChange={(e) => {
                  setMemory(e.target.value);
                  setSaved(false);
                }}
                placeholder="Project decisions, conventions, things to remember…"
              />
            </div>
          )}
          {tab === "settings" && (
            <>
              <div className="agent-field">
                <label htmlFor="agent-name">Name</label>
                <input
                  id="agent-name"
                  maxLength={60}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setSaved(false);
                  }}
                />
              </div>
              <div className="agent-field">
                <label htmlFor="agent-instructions">Instructions</label>
                <textarea
                  id="agent-instructions"
                  maxLength={20000}
                  rows={12}
                  value={instructions}
                  onChange={(e) => {
                    setInstructions(e.target.value);
                    setSaved(false);
                  }}
                />
              </div>
            </>
          )}
          {tab === "history" && (
            <div className="run-history">
              {runs.map((run) => (
                <button key={run.id} onClick={() => openSession(run)}>
                  <TerminalSquare size={16} />
                  <div>
                    <strong>{run.title}</strong>
                    <span>
                      {new Date(run.startedAt).toLocaleString()} ·{" "}
                      {Math.max(
                        0,
                        ((run.endedAt || run.heartbeatAt) - run.startedAt) /
                          60000,
                      ).toFixed(1)}
                      m
                    </span>
                    {run.recoveredFrom && <small>Recovered session</small>}
                  </div>
                  <span className={`task-status ${run.status}`}>
                    {run.status}
                  </span>
                </button>
              ))}
              {!runs.length && (
                <div className="detail-empty">
                  <Clock3 size={24} />
                  <p>No sessions yet</p>
                </div>
              )}
            </div>
          )}
        </div>
        {(tab === "memory" || tab === "settings") && (
          <footer className="detail-save">
            <span>
              {saved && !dirty ? "Saved" : dirty ? "Unsaved changes" : ""}
            </span>
            <button
              className="button primary"
              disabled={busy || !dirty || !name.trim()}
              onClick={() =>
                void attempt(async () => {
                  await call("agent:update", {
                    id: agent.id,
                    changes: { name, instructions, memory },
                  });
                  setSaved(true);
                })
              }
            >
              <Save size={13} />
              Save agent
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}
