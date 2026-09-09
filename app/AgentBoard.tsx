import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Bot,
  Check,
  CircleHelp,
  Clock3,
  FileCode2,
  Folder,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Square,
  TerminalSquare,
  X,
} from "lucide-react";
import {
  call,
  type Agent,
  type Session,
  type Skill,
  type State,
} from "./types";
import AgentDetails from "./AgentDetails";
import { providerNames } from "./TerminalDeck";

function columnFor(agent: Agent, session?: Session) {
  if (agent.stage === "review") return "review";
  if (session?.status === "running") return "running";
  return "ready";
}
function elapsed(session?: Session) {
  if (!session) return "No runs";
  const seconds = Math.max(
    0,
    Math.floor(
      ((session.endedAt || session.heartbeatAt) - session.startedAt) / 1000,
    ),
  );
  return seconds < 60
    ? `${seconds}s elapsed`
    : `${Math.floor(seconds / 60)}m elapsed`;
}
export default function AgentBoard({
  state,
  projectId,
  onOpen,
  onError,
}: {
  state: State;
  projectId: string | null;
  onOpen: (session: Session) => void;
  onError: (error: unknown) => void;
}) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all"),
    [queries, setQueries] = useState<Record<string, string>>({});
  const [create, setCreate] = useState(false),
    [name, setName] = useState(""),
    [provider, setProvider] = useState<Agent["provider"]>("claude"),
    [project, setProject] = useState(projectId || state.projects[0]?.id || ""),
    [instructions, setInstructions] = useState(""),
    [skillPath, setSkillPath] = useState(""),
    [skills, setSkills] = useState<Skill[]>([]);
  const [taskAgent, setTaskAgent] = useState<Agent | null>(null),
    [task, setTask] = useState(""),
    [busy, setBusy] = useState(false);
  const sessions = new Map(state.sessions.map((s) => [s.id, s]));
  const agents = state.agents.filter(
    (a) => filter === "all" || a.projectId === filter,
  );
  useEffect(() => {
    let cancelled = false;
    setSkillPath("");
    setSkills([]);
    if (create && project)
      call<Skill[]>("skills:list", { projectId: project })
        .then((s) => {
          if (!cancelled) setSkills(s);
        })
        .catch(onError);
    return () => {
      cancelled = true;
    };
  }, [project, create, onError]);
  const mark = (id: string, stage: "ready" | "review") =>
    call("agent:mark", { id, stage }).catch(onError);
  return (
    <div className="agent-board-page">
      <div className="command-heading">
        <div>
          <div className="command-title">
            <Bot size={21} />
            <h1>Agent trenches</h1>
            <span className="board-count">{agents.length}</span>
          </div>
        </div>
        <div className="command-heading-actions">
          <select
            aria-label="Filter agents by project"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All projects</option>
            {state.projects.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            className="button primary"
            disabled={!state.projects.length}
            onClick={() => {
              setProject(projectId || state.projects[0]?.id || "");
              setCreate(true);
            }}
          >
            <Plus size={15} />
            New agent
          </button>
        </div>
      </div>
      <div className="board-summary compact-summary">
        <span>
          <i className="live-dot" />
          {
            agents.filter(
              (a) => sessions.get(a.sessionId || "")?.status === "running",
            ).length
          }{" "}
          live sessions
        </span>
        <span>
          {agents.filter((a) => a.stage === "review").length} in review
        </span>
        <span>
          {
            state.tasks.filter(
              (t) =>
                t.status === "queued" && agents.some((a) => a.id === t.agentId),
            ).length
          }{" "}
          queued
        </span>
      </div>
      <div className="board-layout">
        <div className="trenches-columns">
          {[
            {
              id: "ready",
              name: "Ready",
              hint: "Give an agent its next task",
              color: "quiet",
            },
            {
              id: "running",
              name: "Live sessions",
              hint: "Open the terminal to see progress",
              color: "green",
            },
            {
              id: "review",
              name: "Review & recovery",
              hint: "Flagged, exited, or interrupted",
              color: "amber",
            },
          ].map((column) => {
            const grouped = agents.filter(
                (a) =>
                  columnFor(a, sessions.get(a.sessionId || "")) === column.id,
              ),
              visible = grouped.filter((a) =>
                `${a.name} ${a.lastTask || ""} ${a.provider} ${state.projects.find((p) => p.id === a.projectId)?.name}`
                  .toLowerCase()
                  .includes((queries[column.id] || "").toLowerCase()),
              );
            return (
              <section
                className={`trench-column ${column.color}`}
                key={column.id}
                aria-label={column.name}
              >
                <header>
                  <div>
                    <i />
                    <h2>{column.name}</h2>
                    <span>{grouped.length}</span>
                  </div>
                  <label>
                    <Search size={12} />
                    <input
                      aria-label={`Search ${column.name}`}
                      placeholder="Search agents"
                      value={queries[column.id] || ""}
                      onChange={(e) =>
                        setQueries({ ...queries, [column.id]: e.target.value })
                      }
                    />
                  </label>
                </header>

                <div className="trench-list">
                  {visible.map((agent) => {
                    const session = sessions.get(agent.sessionId || ""),
                      running = session?.status === "running",
                      repo = state.projects.find(
                        (p) => p.id === agent.projectId,
                      ),
                      runs = state.sessions.filter(
                        (s) => s.agentId === agent.id,
                      ).length;
                    return (
                      <article
                        className={`trench-card ${running ? "is-running" : ""} provider-${agent.provider}`}
                        key={agent.id}
                      >
                        <div className="trench-card-main">
                          <div className={`agent-avatar ${agent.provider}`}>
                            {agent.name
                              .split(/\s+/)
                              .slice(0, 2)
                              .map((n) => n[0])
                              .join("")
                              .toUpperCase()}
                            <span>
                              <Bot size={10} />
                            </span>
                          </div>
                          <div className="trench-card-text">
                            <div className="trench-name">
                              <button
                                className="agent-title-button"
                                title={`Manage ${agent.name}`}
                                onClick={() => setDetailId(agent.id)}
                              >
                                <h3>{agent.name}</h3>
                              </button>
                              <span>{providerNames[agent.provider]}</span>
                            </div>
                            <p className="trench-project">
                              <Folder size={11} />
                              {repo?.name}
                            </p>
                            <p
                              className="trench-mission"
                              title={agent.lastTask || agent.instructions}
                            >
                              {agent.lastTask || agent.instructions || ""}
                            </p>
                          </div>
                        </div>
                        {running && (
                          <div
                            className="agent-output-activity"
                            title="Terminal output in the last two minutes"
                          >
                            {Array.from({ length: 24 }, (_, i) => {
                              const bucket =
                                Math.floor(Date.now() / 5000) * 5000 -
                                (23 - i) * 5000;
                              const bytes =
                                session?.activity?.find((p) => p.at === bucket)
                                  ?.bytes || 0;
                              return (
                                <i
                                  key={i}
                                  style={{
                                    height: `${bytes ? Math.min(100, 20 + Math.log2(bytes + 1) * 5) : 8}%`,
                                    opacity: bytes ? 0.9 : 0.15,
                                  }}
                                />
                              );
                            })}
                            <span>
                              {session?.lastOutputAt
                                ? `Output ${Math.max(0, Math.floor((Date.now() - session.lastOutputAt) / 1000))}s ago`
                                : "Waiting for output"}
                            </span>
                          </div>
                        )}
                        <div className="trench-metrics">
                          <span>
                            <Clock3 size={11} />
                            {elapsed(session)}
                          </span>
                          <span>
                            <TerminalSquare size={11} />
                            {runs} {runs === 1 ? "run" : "runs"}
                          </span>
                          {agent.skillPath && (
                            <span title={agent.skillPath}>
                              <FileCode2 size={11} />
                              Skill attached
                            </span>
                          )}
                          <span
                            className={`card-state ${running ? "green" : ""}`}
                          >
                            {running
                              ? "Process running"
                              : session?.status || "Not started"}
                          </span>
                        </div>
                        <div className="trench-actions">
                          <button
                            title={`Manage ${agent.name}`}
                            onClick={() => setDetailId(agent.id)}
                          >
                            Details
                          </button>
                          {agent.stage === "review" && !running ? (
                            <button
                              title="Ready for another task"
                              onClick={() => mark(agent.id, "ready")}
                            >
                              <Check size={12} />
                              Mark ready
                            </button>
                          ) : (
                            <button
                              title="Flag for review without stopping"
                              onClick={() => mark(agent.id, "review")}
                            >
                              <CircleHelp size={12} />
                              Review
                            </button>
                          )}
                          {running && (
                            <button
                              title="Stop agent terminal"
                              onClick={() =>
                                call("terminal:stop", {
                                  id: session!.id,
                                }).catch(onError)
                              }
                            >
                              <Square size={11} />
                              Stop
                            </button>
                          )}
                          {session && (
                            <button
                              className={
                                running ? "card-open primary" : "card-open"
                              }
                              onClick={() => onOpen(session)}
                            >
                              <ArrowUpRight size={12} />
                              Open session
                            </button>
                          )}
                          {!running && (
                            <button
                              className="card-start"
                              onClick={() => {
                                setTaskAgent(agent);
                                setTask("");
                              }}
                            >
                              <Play size={11} />
                              New task
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                  {!visible.length && (
                    <div className="trench-empty">
                      <Bot size={22} />
                      <h3>
                        {queries[column.id]
                          ? "No matching agents"
                          : column.id === "ready"
                            ? "No agents ready"
                            : column.id === "running"
                              ? "No live sessions"
                              : "Nothing waiting for review"}
                      </h3>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
        {detailId && state.agents.find((a) => a.id === detailId) && (
          <AgentDetails
            key={detailId}
            docked
            agent={state.agents.find((a) => a.id === detailId)!}
            state={state}
            onClose={() => setDetailId(null)}
            onOpen={onOpen}
            onError={onError}
          />
        )}
      </div>
      {create && (
        <div className="modal-backdrop">
          <form
            className="modal agent-modal"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              try {
                await call("agent:create", {
                  projectId: project,
                  name,
                  provider,
                  instructions,
                  ...(skillPath ? { skillPath } : {}),
                });
                setCreate(false);
                setName("");
                setInstructions("");
              } catch (error) {
                onError(error);
              } finally {
                setBusy(false);
              }
            }}
          >
            <button
              type="button"
              title="Close dialog"
              className="modal-close"
              onClick={() => setCreate(false)}
            >
              <X size={17} />
            </button>
            <span className="eyebrow">A TEAMMATE WITH A JOB</span>
            <h2>Create an agent</h2>
            <label>
              Agent name
              <input
                required
                maxLength={60}
                placeholder="e.g. Frontend builder"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="form-two">
              <label>
                Project
                <select
                  required
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                >
                  {state.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                CLI provider
                <select
                  value={provider}
                  onChange={(e) =>
                    setProvider(e.target.value as Agent["provider"])
                  }
                >
                  {["claude", "codex", "opencode"].map((k) => (
                    <option key={k} value={k}>
                      {providerNames[k]}
                      {state.capabilities[k as Agent["provider"]]
                        ? ""
                        : " · not detected"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Instructions
              <textarea
                required
                maxLength={20000}
                rows={4}
                placeholder="What should this agent focus on? How should it work?"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </label>
            <label>
              Project skill
              <select
                value={skillPath}
                onChange={(e) => setSkillPath(e.target.value)}
              >
                <option value="">No skill attached</option>
                {skills.map((s) => (
                  <option key={s.path} value={s.path}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <p>
              The agent uses the official CLI's login and approval prompts.
              Agents assigned to the same folder share its files.
            </p>
            <button disabled={busy} className="button primary" type="submit">
              Create agent
            </button>
          </form>
        </div>
      )}
      {taskAgent && (
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              try {
                const session = await call<Session>("agent:start", {
                  id: taskAgent.id,
                  task,
                });
                setTaskAgent(null);
                onOpen(session);
              } catch (error) {
                onError(error);
              } finally {
                setBusy(false);
              }
            }}
          >
            <button
              type="button"
              title="Close dialog"
              className="modal-close"
              onClick={() => setTaskAgent(null)}
            >
              <X size={17} />
            </button>
            <span className="eyebrow">{providerNames[taskAgent.provider]}</span>
            <h2>Give {taskAgent.name} a task</h2>
            <label>
              Task
              <textarea
                required
                autoFocus
                rows={5}
                maxLength={20000}
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="Describe the outcome and any constraints…"
              />
            </label>
            <p>
              This launches a new CLI conversation with the agent's instructions
              and selected skill. To continue previous work, open its existing
              session.
            </p>
            <button className="button primary" disabled={busy} type="submit">
              <Play size={13} />
              {busy ? "Starting…" : "Start task"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
