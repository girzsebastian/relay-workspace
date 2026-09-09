import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, History, Play, X } from "lucide-react";
import { call, type Session } from "./types";

export type InterruptedRun = {
  id: string;
  kind: string;
  title: string;
  projectId: string;
  project: string;
  agentId: string | null;
  agent: string | null;
  task: string | null;
  taskStatus: string | null;
  startedAt: number;
  endedAt: number;
  resumable: boolean;
  recoverable: boolean;
  tail: string;
  highlight: string;
};

export function ago(at: number, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// What Recover will actually do, said plainly, because the two cases behave
// very differently and the difference matters to whoever presses it.
export function recoveryPromise(run: InterruptedRun) {
  if (run.resumable)
    return "The CLI kept its transcript, so this continues the same conversation.";
  if (["codex", "claude", "opencode"].includes(run.kind))
    return "The CLI did not save this conversation. Recover starts a fresh one carrying the agent's instructions, memory, task and the output below.";
  if (run.kind === "build") return "Runs the command again from the beginning.";
  return "Opens a new shell in this workspace. The output below is kept.";
}

export default function RecoveryPanel({
  onOpen,
  onError,
}: {
  onOpen: (session: Session) => void;
  onError: (error: unknown) => void;
}) {
  const [report, setReport] = useState<InterruptedRun[]>([]),
    [summary, setSummary] = useState<string | null>(null),
    [open, setOpen] = useState(false),
    [expanded, setExpanded] = useState<string[]>([]),
    [hidden, setHidden] = useState(false),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const next = await call<{
        report: InterruptedRun[];
        summary: string | null;
      }>("recovery:report", {});
      setReport(next.report);
      setSummary(next.summary);
    } catch (error) {
      onError(error);
    }
  }, [onError]);
  useEffect(() => {
    void load();
  }, [load]);
  if (hidden || !report.length || !summary) return null;
  const act = async (run: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await run();
      await load();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="recovery-strip">
      <header>
        <History size={15} />
        <b>{summary}</b>
        <button className="button compact" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Show what was running"}
        </button>
        <button
          className="button compact"
          disabled={busy}
          title="Remove every entry from this list; their output is kept"
          onClick={() => {
            if (
              !window.confirm(
                `Dismiss all ${report.length} entries? Their saved output stays on disk.`,
              )
            )
              return;
            void act(async () => {
              for (const run of report)
                await call("terminal:dismiss", { id: run.id });
            });
          }}
        >
          Dismiss all
        </button>
        <button
          className="recovery-close"
          title="Dismiss until the next restart"
          aria-label="Dismiss"
          onClick={() => setHidden(true)}
        >
          <X size={14} />
        </button>
      </header>
      {open && (
        <ul>
          {report.map((run) => {
            const showing = expanded.includes(run.id);
            return (
              <li key={run.id}>
                <div className="recovery-row">
                  <button
                    className="recovery-expand"
                    aria-expanded={showing}
                    aria-label={`${showing ? "Hide" : "Show"} output of ${run.agent || run.title}`}
                    onClick={() =>
                      setExpanded(
                        showing
                          ? expanded.filter((id) => id !== run.id)
                          : [...expanded, run.id],
                      )
                    }
                  >
                    {showing ? (
                      <ChevronDown size={12} />
                    ) : (
                      <ChevronRight size={12} />
                    )}
                  </button>
                  <div className="recovery-main">
                    <b>{run.agent || run.title}</b>
                    <span className="recovery-meta">
                      {run.project} · stopped {ago(run.endedAt)}
                      {run.task ? ` · ${run.task.slice(0, 80)}` : ""}
                    </span>
                    {run.highlight && (
                      <span
                        className="recovery-highlight"
                        title={run.highlight}
                      >
                        {run.highlight.split("\n").slice(-1)[0]}
                      </span>
                    )}
                    <span className="recovery-promise">
                      {recoveryPromise(run)}
                    </span>
                  </div>
                  {run.recoverable && (
                    <button
                      className="button primary compact"
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          const session = await call<Session>(
                            "terminal:recover",
                            { id: run.id },
                          );
                          onOpen(session);
                        })
                      }
                    >
                      <Play size={13} />
                      Recover
                    </button>
                  )}
                  <button
                    className="button compact"
                    disabled={busy}
                    title="Remove this from the list; its output is kept"
                    onClick={() =>
                      act(() => call("terminal:dismiss", { id: run.id }))
                    }
                  >
                    Dismiss
                  </button>
                </div>
                {showing && (
                  <pre className="recovery-tail">
                    {run.tail || "This run produced no readable output."}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
