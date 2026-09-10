import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  Columns2,
  Grid2X2,
  Link2,
  Maximize2,
  Plus,
  RotateCcw,
  Square,
  TerminalSquare,
  X,
} from "lucide-react";
import Terminal from "./Terminal";
import SessionPicker, { providerNames } from "./SessionPicker";
import ResizeHandle from "./ResizeHandle";
import {
  call,
  type Agent,
  type Project,
  type Session,
  type TerminalSizing,
} from "./types";

export { providerNames };
export function recoveryNote(session: Session) {
  if (session.kind === "shell")
    return "Recover opens a new shell in this project. Saved output stays here.";
  if (session.kind === "build")
    return "Run again starts the command from the beginning.";
  if (session.kind === "codex" && !session.providerSessionId)
    return "Recover opens the project's Codex conversation picker.";
  if (session.kind === "opencode" && !session.providerSessionId)
    return "Link an ID from opencode session list to recover this conversation.";
  return "Recover resumes the linked conversation if the CLI saved its history.";
}
export function initialPaneIds(
  sessions: Session[],
  count: number,
  pinned: (string | null)[],
  preferred?: string,
) {
  const ordered = sessions
    .slice()
    .sort(
      (a, b) =>
        Number(b.id === preferred) - Number(a.id === preferred) ||
        Number(b.status === "running") - Number(a.status === "running") ||
        b.startedAt - a.startedAt,
    );
  const slots: (string | null)[] = Array.from({ length: count }, (_, i) =>
    sessions.some((s) => s.id === pinned[i]) ? pinned[i] : null,
  );
  // A slot the user emptied stays empty; one that was never decided, or whose
  // session is gone, is refilled so growing the layout cannot show blank panes.
  const hidden = (slot: number) =>
    slot < pinned.length && pinned[slot] === null;
  const used = new Set(slots.filter(Boolean));
  let next = 0;
  for (let slot = 0; slot < count; slot += 1) {
    if (slots[slot] || hidden(slot)) continue;
    while (next < ordered.length && used.has(ordered[next].id)) next += 1;
    if (next >= ordered.length) break;
    slots[slot] = ordered[next].id;
    used.add(ordered[next].id);
  }
  return slots;
}
export default function TerminalDeck({
  sessions,
  projects,
  agents,
  count,
  pinned,
  onPins,
  onError,
  preferred,
  onExpand,
  sizing,
  onSizing,
}: {
  sizing: TerminalSizing;
  onSizing: (sizing: TerminalSizing) => void;
  sessions: Session[];
  projects: Project[];
  agents?: Agent[];
  count: number;
  pinned: (string | null)[];
  preferred?: string;
  onPins: (ids: (string | null)[]) => void;
  onError: (error: unknown) => void;
  onExpand?: (id: string) => void;
}) {
  const deck = useRef<HTMLDivElement>(null);
  const ids = initialPaneIds(sessions, count, pinned, preferred);
  const [focused, setFocused] = useState<number | null>(null);
  useEffect(() => setFocused(null), [count]);
  const [link, setLink] = useState<Session | null>(null),
    [sessionLink, setSessionLink] = useState("");
  const [launchAt, setLaunchAt] = useState<number | null>(null),
    [launchProject, setLaunchProject] = useState(projects[0]?.id || ""),
    [launchKind, setLaunchKind] = useState("shell"),
    [busy, setBusy] = useState(false);
  const setPin = (slot: number, id: string | null) => {
    const next = [...ids];
    next[slot] = id;
    onPins(next);
  };
  const recover = async (slot: number, session: Session) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await call<Session>("terminal:recover", { id: session.id });
      setPin(slot, next.id);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div
        ref={deck}
        style={
          focused !== null
            ? undefined
            : {
                gridTemplateColumns:
                  count === 6
                    ? `${sizing.first}fr ${sizing.second - sizing.first}fr ${100 - sizing.second}fr`
                    : count >= 2
                      ? `${sizing.column}fr ${100 - sizing.column}fr`
                      : undefined,
                gridTemplateRows:
                  count >= 4
                    ? `${sizing.row}fr ${100 - sizing.row}fr`
                    : undefined,
              }
        }
        className={`terminal-deck ${focused !== null ? "has-focus" : ""}`}
        data-count={count}
      >
        {ids.map((id, slot) => {
          const session = sessions.find((s) => s.id === id),
            project = projects.find((p) => p.id === session?.projectId);
          return (
            <section
              key={slot}
              className={`terminal-tile ${focused === slot ? "focused" : ""}`}
              style={
                focused !== null && focused !== slot
                  ? { display: "none" }
                  : undefined
              }
              aria-label={`Terminal pane ${slot + 1}`}
            >
              <header className="tile-header">
                <span className={`provider-dot ${session?.kind || "shell"}`} />
                <SessionPicker
                  label={`Session in pane ${slot + 1}`}
                  value={id}
                  sessions={sessions
                    .filter((s) => s.id === id || !ids.includes(s.id))
                    .slice()
                    .reverse()}
                  projects={projects}
                  agents={agents}
                  onChange={(next) => setPin(slot, next)}
                  onError={onError}
                />
                <div className="tile-actions">
                  {session && (
                    <>
                      <button
                        title="New terminal in this pane"
                        onClick={() => {
                          setLaunchProject(
                            project?.id || projects[0]?.id || "",
                          );
                          setLaunchAt(slot);
                        }}
                      >
                        <Plus size={13} />
                      </button>
                      {["codex", "opencode"].includes(session.kind) && (
                        <button
                          title="Link conversation ID"
                          onClick={() => {
                            setLink(session);
                            setSessionLink(session.providerSessionId || "");
                          }}
                        >
                          <Link2 size={13} />
                        </button>
                      )}
                      {session.status === "running" && (
                        <button
                          title="Stop this terminal"
                          onClick={() =>
                            call("terminal:stop", { id: session.id }).catch(
                              onError,
                            )
                          }
                        >
                          <Square size={12} />
                        </button>
                      )}
                      {onExpand && (
                        <button
                          title="Open in terminal grid"
                          onClick={() => onExpand(id!)}
                        >
                          <ArrowUpRight size={13} />
                        </button>
                      )}
                    </>
                  )}
                  <button
                    title={focused === slot ? "Restore grid" : "Focus pane"}
                    onClick={() => setFocused(focused === slot ? null : slot)}
                  >
                    <Maximize2 size={12} />
                  </button>
                  {session && (
                    <button
                      title="Hide pane (keep process running)"
                      onClick={() => setPin(slot, null)}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </header>
              {session ? (
                <>
                  {session.agentOwned && (
                    <div className="agent-terminal-note">
                      Agent terminal · read-only
                    </div>
                  )}
                  <div className="tile-meta">
                    <span title={project?.path}>
                      {project?.name}{" "}
                      <span>/ {providerNames[session.kind]}</span>
                    </span>
                    <span className={`process-state ${session.status}`}>
                      <i />
                      {session.status === "running"
                        ? "Process running"
                        : session.status}
                    </span>
                  </div>
                  <Terminal session={session} onError={onError} />
                  {session.status !== "running" && (
                    <div className="tile-recovery">
                      <span>{recoveryNote(session)}</span>
                      <button
                        disabled={busy}
                        onClick={() => recover(slot, session)}
                      >
                        <RotateCcw size={12} />
                        {session.kind === "build" ? "Run again" : "Recover"}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-terminal">
                  <TerminalSquare size={25} />
                  <h3>No session</h3>

                  <button
                    className="button"
                    disabled={!projects.length}
                    onClick={() => {
                      setLaunchProject(projects[0]?.id || "");
                      setLaunchAt(slot);
                    }}
                  >
                    <Plus size={14} />
                    Launch terminal
                  </button>
                </div>
              )}
            </section>
          );
        })}
        {focused === null &&
          count >= 2 &&
          (count === 6
            ? (["first", "second"] as const)
            : (["column"] as const)
          ).map((key) => (
            <div
              key={key}
              className="deck-resizer deck-resizer-x"
              style={{ left: `calc(${sizing[key]}% - 2px)` }}
            >
              <ResizeHandle
                axis="x"
                label={`Resize terminal columns ${key}`}
                value={sizing[key]}
                min={
                  key === "column"
                    ? 20
                    : key === "first"
                      ? 15
                      : sizing.first + 15
                }
                max={
                  key === "column"
                    ? 80
                    : key === "first"
                      ? sizing.second - 15
                      : 85
                }
                scale={100 / (deck.current?.clientWidth || 600)}
                onChange={(value) => onSizing({ ...sizing, [key]: value })}
              />
            </div>
          ))}
        {focused === null && count >= 4 && (
          <div
            className="deck-resizer deck-resizer-y"
            style={{ top: `calc(${sizing.row}% - 2px)` }}
          >
            <ResizeHandle
              axis="y"
              label="Resize terminal rows"
              value={sizing.row}
              min={20}
              max={80}
              scale={100 / (deck.current?.clientHeight || 600)}
              onChange={(row) => onSizing({ ...sizing, row })}
            />
          </div>
        )}
      </div>
      {launchAt !== null && (
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              try {
                const s = await call<Session>("terminal:start", {
                  projectId: launchProject,
                  kind: launchKind,
                });
                setPin(launchAt, s.id);
                setLaunchAt(null);
              } catch (error) {
                onError(error);
              } finally {
                setBusy(false);
              }
            }}
          >
            <button
              type="button"
              className="modal-close"
              title="Close dialog"
              onClick={() => setLaunchAt(null)}
            >
              <X size={17} />
            </button>
            <span className="eyebrow">PANE {launchAt + 1}</span>
            <h2>Launch a terminal</h2>
            <label>
              Project
              <select
                value={launchProject}
                onChange={(e) => setLaunchProject(e.target.value)}
                required
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tool
              <select
                value={launchKind}
                onChange={(e) => setLaunchKind(e.target.value)}
              >
                {["shell", "codex", "claude", "opencode"].map((k) => (
                  <option key={k} value={k}>
                    {providerNames[k]}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Uses the tool installed on this computer and its own login.
              Closing a pane keeps its process running.
            </p>
            <button
              className="button primary"
              disabled={busy || !launchProject}
              type="submit"
            >
              {busy ? "Launching…" : "Launch terminal"}
            </button>
          </form>
        </div>
      )}
      {link && (
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await call("terminal:bind", {
                  id: link.id,
                  providerSessionId: sessionLink.trim(),
                });
                setLink(null);
              } catch (error) {
                onError(error);
              }
            }}
          >
            <button
              type="button"
              className="modal-close"
              title="Close dialog"
              onClick={() => setLink(null)}
            >
              <X size={17} />
            </button>
            <h2>Link {providerNames[link.kind]} conversation</h2>
            <p>
              {link.kind === "opencode"
                ? "Copy the session ID from opencode session list."
                : "Copy the conversation UUID from Codex’s /status command."}
            </p>
            <label>
              Session ID
              <input
                required
                value={sessionLink}
                onChange={(e) => setSessionLink(e.target.value)}
              />
            </label>
            <button className="button primary" type="submit">
              Save session link
            </button>
          </form>
        </div>
      )}
    </>
  );
}

export function LayoutButtons({
  value,
  options,
  onChange,
}: {
  value: number;
  options: number[];
  onChange: (value: number) => void;
}) {
  return (
    <div className="layout-buttons" aria-label="Terminal layout">
      {options.map((n) => (
        <button
          key={n}
          className={value === n ? "selected" : ""}
          title={`${n} terminal panes`}
          aria-label={`${n} terminal panes`}
          aria-pressed={value === n}
          onClick={() => onChange(n)}
        >
          {n <= 2 ? <Columns2 size={13} /> : <Grid2X2 size={13} />}
          <span>{n}</span>
        </button>
      ))}
    </div>
  );
}
