import { useCallback, useEffect, useState } from "react";
import { Box, RotateCcw, Square } from "lucide-react";
import { call, type Project } from "./types";

export type Container = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  workingDir?: string;
  projectId: string | null;
};
export type ContainerList = {
  available: boolean;
  containers: Container[];
  reason?: string;
};

export default function Containers({
  projects,
  projectId,
  onError,
}: {
  projects: Project[];
  projectId: string | null;
  onError: (error: unknown) => void;
}) {
  const [list, setList] = useState<ContainerList | null>(null),
    [logs, setLogs] = useState<{ name: string; text: string } | null>(null),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setList(await call<ContainerList>("containers:list", {}));
    } catch (error) {
      onError(error);
    }
  }, [onError]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const projectName = (id: string | null) =>
    projects.find((project) => project.id === id)?.name;
  if (list && !list.available)
    return (
      <div className="scm-empty">
        <Box size={22} />
        <p>{list.reason}</p>
        <small>
          Relay reads Docker through its CLI. Nothing is started or stopped
          unless you ask for it here.
        </small>
        <button className="button compact" onClick={() => void refresh()}>
          <RotateCcw size={13} />
          Try again
        </button>
      </div>
    );
  const containers = list?.containers || [];
  const mine = containers.filter((c) => c.projectId === projectId);
  const rest = containers.filter((c) => c.projectId !== projectId);
  const section = (title: string, rows: Container[]) =>
    rows.length > 0 && (
      <>
        <div className="scm-section-title">
          {title}
          <span>{rows.length}</span>
        </div>
        <ul className="container-list">
          {rows.map((container) => (
            <li key={container.id}>
              <span className={`container-state s-${container.state}`} />
              <div className="container-main">
                <b>{container.name || container.id.slice(0, 12)}</b>
                <span className="container-image" title={container.image}>
                  {container.image}
                </span>
                <span className="container-status">
                  {container.status}
                  {container.ports ? ` · ${container.ports}` : ""}
                  {container.projectId && container.projectId !== projectId
                    ? ` · ${projectName(container.projectId)}`
                    : ""}
                </span>
              </div>
              <button
                title="Show recent logs"
                onClick={() =>
                  call<string>("containers:logs", { id: container.id })
                    .then((text) =>
                      setLogs({
                        name: container.name || container.id,
                        text: text || "This container produced no output.",
                      }),
                    )
                    .catch(onError)
                }
              >
                Logs
              </button>
              <button
                title="Stop this container"
                disabled={busy || container.state !== "running"}
                onClick={() => {
                  if (
                    !window.confirm(
                      `Stop ${container.name || container.id}? Anything running inside it ends.`,
                    )
                  )
                    return;
                  setBusy(true);
                  call("containers:stop", { id: container.id })
                    .then(refresh)
                    .catch(onError)
                    .finally(() => setBusy(false));
                }}
              >
                <Square size={12} />
              </button>
            </li>
          ))}
        </ul>
      </>
    );
  return (
    <div className="scm">
      <header className="scm-header">
        <span>
          <Box size={14} />
          Containers
        </span>
        <span className="scm-track">
          {containers.length
            ? `${containers.filter((c) => c.state === "running").length} running`
            : "none found"}
        </span>
        <button title="Refresh" onClick={() => void refresh()}>
          <RotateCcw size={13} />
        </button>
      </header>
      {!containers.length && (
        <p className="scm-clean">
          Docker is reachable, but there are no containers on this machine.
        </p>
      )}
      {section("This workspace", mine)}
      {section("Other containers", rest)}
      {logs && (
        <div className="modal-backdrop" onClick={() => setLogs(null)}>
          <div
            className="modal diff-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <b>{logs.name}</b>
              <button className="modal-close" onClick={() => setLogs(null)}>
                ✕
              </button>
            </header>
            <pre className="diff-body">{logs.text}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
