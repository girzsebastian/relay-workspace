import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { call, type FileEntry, type Project } from "./types";

export default function FileTree({
  project,
  selected,
  onOpen,
  onError,
}: {
  project: Project;
  selected?: string;
  onOpen: (entry: FileEntry) => void;
  onError: (error: unknown) => void;
}) {
  const [expanded, setExpanded] = useState<string[]>(
      project.expandedPaths || [],
    ),
    [version, setVersion] = useState(0),
    [rootOpen, setRootOpen] = useState(true);
  const toggle = (path: string) => {
    const next = expanded.includes(path)
      ? expanded.filter((p) => p !== path)
      : [...expanded, path];
    setExpanded(next);
    call("project:tree", { projectId: project.id, expandedPaths: next }).catch(
      onError,
    );
  };
  return (
    <aside className="file-explorer">
      <div className="pane-heading">
        <span>EXPLORER</span>
        <button
          title="Refresh file tree"
          onClick={() => setVersion((v) => v + 1)}
        >
          <RefreshCw size={13} />
        </button>
      </div>
      <button
        className="explorer-root"
        aria-expanded={rootOpen}
        onClick={() => setRootOpen(!rootOpen)}
      >
        {rootOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>{project.name}</span>
      </button>
      <div className="file-list">
        {rootOpen && (
          <Branch
            projectId={project.id}
            path="."
            depth={0}
            selected={selected}
            expanded={expanded}
            toggle={toggle}
            onOpen={onOpen}
            onError={onError}
            version={version}
          />
        )}
      </div>
    </aside>
  );
}
function Branch({
  projectId,
  path,
  depth,
  selected,
  expanded,
  toggle,
  onOpen,
  onError,
  version,
}: {
  projectId: string;
  path: string;
  depth: number;
  selected?: string;
  expanded: string[];
  toggle: (path: string) => void;
  onOpen: (entry: FileEntry) => void;
  onError: (error: unknown) => void;
  version: number;
}) {
  const [entries, setEntries] = useState<FileEntry[] | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    call<FileEntry[]>("files:list", { projectId, path })
      .then((e) => {
        if (!cancelled) setEntries(e);
      })
      .catch((error) => {
        if (!cancelled) {
          setFailed(true);
          onError(error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, path, version, onError]);
  if (failed) return <div className="tree-note">Folder unavailable</div>;
  if (!entries) return <div className="tree-note">Loading…</div>;
  return (
    <>
      {entries.map((entry) => {
        const open = expanded.includes(entry.path);
        return (
          <div key={entry.path} className="tree-node">
            <button
              className={`file-entry ${selected === entry.path ? "selected" : ""}`}
              style={{ paddingLeft: 8 + depth * 13 }}
              title={entry.path}
              aria-expanded={entry.directory ? open : undefined}
              onClick={() =>
                entry.directory ? toggle(entry.path) : onOpen(entry)
              }
            >
              {entry.directory ? (
                <>
                  {open ? (
                    <ChevronDown size={10} />
                  ) : (
                    <ChevronRight size={10} />
                  )}
                  <Folder size={13} />
                </>
              ) : (
                <>
                  <span className="tree-indent" />
                  <FileCode2 size={13} />
                </>
              )}
              <span>{entry.name}</span>
            </button>
            {entry.directory && open && depth < 40 && (
              <Branch
                projectId={projectId}
                path={entry.path}
                depth={depth + 1}
                selected={selected}
                expanded={expanded}
                toggle={toggle}
                onOpen={onOpen}
                onError={onError}
                version={version}
              />
            )}
          </div>
        );
      })}
      {!entries.length && (
        <div className="tree-note" style={{ paddingLeft: 16 + depth * 13 }}>
          Empty folder
        </div>
      )}
    </>
  );
}
