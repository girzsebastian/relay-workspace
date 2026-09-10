import FileIcon from "./FileIcon";
import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { call, type FileEntry, type Project, type RepoStatus } from "./types";
import { statusLetter } from "./SourceControl";

// A workspace can hold several checkouts, so decorations are merged from every
// repository found under it and re-rooted at the workspace folder.
export function decorate(repos: RepoStatus[] | null) {
  const marks = new Map<string, string>();
  for (const repo of repos || []) {
    if (!repo.repository) continue;
    for (const file of repo.files) {
      const full = repo.relative ? `${repo.relative}/${file.path}` : file.path;
      if (!full) continue;
      marks.set(full, statusLetter(file));
      // Every ancestor folder is flagged so a change is visible while collapsed.
      const parts = full.split("/");
      for (let i = 1; i < parts.length; i += 1)
        marks.set(parts.slice(0, i).join("/"), "•");
    }
  }
  return marks;
}

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
    [changes, setChanges] = useState<Map<string, string>>(new Map()),
    [rootOpen, setRootOpen] = useState(true);
  useEffect(() => {
    let cancelled = false;
    call<RepoStatus[]>("git:repos", { projectId: project.id })
      .then((status) => {
        if (!cancelled) setChanges(decorate(status));
      })
      // A project outside git simply has no decorations to show.
      .catch(() => {
        if (!cancelled) setChanges(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, version]);
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
          title="Refresh file tree and git status"
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
            changes={changes}
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
  changes,
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
  changes: Map<string, string>;
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
                  <FileIcon path={entry.path} />
                </>
              )}
              <span className={changes.has(entry.path) ? "changed" : undefined}>
                {entry.name}
              </span>
              {changes.has(entry.path) && (
                <span
                  aria-hidden="true"
                  className={`tree-mark m-${changes.get(entry.path)}`}
                  title={
                    changes.get(entry.path) === "•"
                      ? "Contains changes"
                      : "Changed since the last commit"
                  }
                >
                  {changes.get(entry.path)}
                </span>
              )}
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
                changes={changes}
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
