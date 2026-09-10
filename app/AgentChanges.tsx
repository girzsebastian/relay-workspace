import { useCallback, useEffect, useState } from "react";
import { Check, FileDiff, Undo2 } from "lucide-react";
import FileIcon from "./FileIcon";
import DiffView from "./DiffView";
import { countLabel, statusLetter } from "./SourceControl";
import { call, type GitFile } from "./types";

export type RunChanges = {
  relative: string;
  name: string;
  files: GitFile[];
  committed: boolean;
};

export function summarise(repos: RunChanges[]) {
  const files = repos.reduce((total, repo) => total + repo.files.length, 0);
  const added = repos.reduce(
    (total, repo) =>
      total + repo.files.reduce((sum, file) => sum + (file.added || 0), 0),
    0,
  );
  const removed = repos.reduce(
    (total, repo) =>
      total + repo.files.reduce((sum, file) => sum + (file.removed || 0), 0),
    0,
  );
  return { files, added, removed };
}

// What a single agent run changed, measured against the snapshot taken when it
// started. Files the user had already modified are excluded, so Undo can never
// throw away work the agent did not do.
export default function AgentChanges({
  projectId,
  sessionId,
  onError,
}: {
  projectId: string;
  sessionId: string;
  onError: (error: unknown) => void;
}) {
  const [repos, setRepos] = useState<RunChanges[] | null>(null),
    [kept, setKept] = useState(false),
    [busy, setBusy] = useState(false),
    [diff, setDiff] = useState<{ file: string; repo: string } | null>(null);
  const load = useCallback(async () => {
    try {
      setRepos(
        await call<RunChanges[]>("git:agent-changes", { projectId, sessionId }),
      );
    } catch (error) {
      onError(error);
    }
  }, [projectId, sessionId, onError]);
  useEffect(() => {
    void load();
  }, [load]);
  if (kept || !repos || !repos.length) return null;
  const totals = summarise(repos);
  if (!totals.files && !repos.some((repo) => repo.committed)) return null;
  return (
    <div className="run-changes">
      <header>
        <FileDiff size={14} />
        <b>
          {totals.files} file{totals.files === 1 ? "" : "s"} changed
        </b>
        <span className="run-counts">
          +{totals.added} −{totals.removed}
        </span>
        <button
          className="button compact"
          title="Leave these changes in place"
          onClick={() => setKept(true)}
        >
          <Check size={13} />
          Keep
        </button>
        <button
          className="button danger-text"
          disabled={busy || !totals.files}
          title="Discard everything this run changed"
          onClick={() => {
            if (
              !window.confirm(
                `Discard ${totals.files} file(s) this run changed? Untracked files are kept, because git cannot restore them.`,
              )
            )
              return;
            setBusy(true);
            Promise.all(
              repos.map((repo) => {
                const paths = repo.files
                  .filter((file) => !file.untracked)
                  .map((file) => file.path);
                return paths.length
                  ? call("git:discard", {
                      projectId,
                      repo: repo.relative,
                      paths,
                    })
                  : Promise.resolve(null);
              }),
            )
              .then(load)
              .catch(onError)
              .finally(() => setBusy(false));
          }}
        >
          <Undo2 size={13} />
          Undo
        </button>
      </header>
      {repos.map((repo) => (
        <div key={repo.relative || "."}>
          {repos.length > 1 && <span className="run-repo">{repo.name}</span>}
          {repo.committed && (
            <p className="run-note">
              This repository also has new commits since the run started; Undo
              does not touch committed work.
            </p>
          )}
          <ul className="scm-files">
            {repo.files.map((file) => (
              <li key={`${repo.relative}/${file.path}`}>
                <button
                  className="scm-file"
                  title={`Review ${file.path}`}
                  onClick={() =>
                    setDiff({ file: file.path, repo: repo.relative })
                  }
                >
                  <FileIcon path={file.path} />
                  <span className="scm-path">{file.path}</span>
                  {countLabel(file) && (
                    <span className="scm-counts">{countLabel(file)}</span>
                  )}
                  <span className={`scm-letter s-${statusLetter(file)}`}>
                    {statusLetter(file)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {diff && (
        <DiffView
          projectId={projectId}
          repo={diff.repo}
          file={diff.file}
          onClose={() => setDiff(null)}
          onChanged={load}
          onError={onError}
        />
      )}
    </div>
  );
}
