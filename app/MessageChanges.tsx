import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Undo2 } from "lucide-react";
import FileIcon from "./FileIcon";
import DiffView from "./DiffView";
import { countLabel, statusLetter } from "./SourceControl";
import { call, type GitFile } from "./types";

export type ReplyChanges = {
  relative: string;
  name: string;
  files: GitFile[];
  committed: boolean;
};

export function totals(repos: ReplyChanges[]) {
  const files = repos.reduce((sum, repo) => sum + repo.files.length, 0);
  const added = repos.reduce(
    (sum, repo) =>
      sum + repo.files.reduce((n, file) => n + (file.added || 0), 0),
    0,
  );
  const removed = repos.reduce(
    (sum, repo) =>
      sum + repo.files.reduce((n, file) => n + (file.removed || 0), 0),
    0,
  );
  return { files, added, removed };
}

// What one reply changed, and the way back. Undo measures the workspace again
// before acting, because the person may have kept or undone some of it since.
export default function MessageChanges({
  projectId,
  chatId,
  messageId,
  repos,
  reverted,
  onError,
}: {
  projectId: string;
  chatId: string;
  messageId: string;
  repos: ReplyChanges[];
  reverted?: { at: number; files: number };
  onError: (error: unknown) => void;
}) {
  const [open, setOpen] = useState(false),
    [kept, setKept] = useState(false),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState<string | null>(null),
    [diff, setDiff] = useState<{ file: string; repo: string } | null>(null);
  const counts = totals(repos);
  if (!counts.files && !reverted) return null;
  if (reverted)
    return (
      <p className="reply-reverted">
        Undone · {reverted.files} file{reverted.files === 1 ? "" : "s"} restored
        to how they were before this reply.
      </p>
    );
  if (kept) return null;
  return (
    <div className="reply-changes">
      <header>
        <button
          className="reply-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {counts.files} file{counts.files === 1 ? "" : "s"}
        </button>
        <span className="reply-counts">
          +{counts.added} −{counts.removed}
        </span>
        <button
          className="button compact"
          disabled={busy}
          title="Restore every file this reply changed"
          onClick={() => {
            if (
              !window.confirm(
                `Undo this reply? ${counts.files} file(s) go back to how they were before it ran. Files it created are left alone, because git cannot restore an untracked file.`,
              )
            )
              return;
            setBusy(true);
            call<{ reverted: number; skipped: string[] }>("chat:revert", {
              id: chatId,
              messageId,
            })
              .then((result) => {
                if (result.skipped.length)
                  setNote(
                    `Kept ${result.skipped.length} file(s) this reply created; git cannot restore those.`,
                  );
              })
              .catch(onError)
              .finally(() => setBusy(false));
          }}
        >
          <Undo2 size={13} />
          Undo all
        </button>
        <button
          className="button compact"
          title="Leave these changes in place and hide this"
          onClick={() => setKept(true)}
        >
          <Check size={13} />
          Keep all
        </button>
      </header>
      {note && <p className="reply-note">{note}</p>}
      {open &&
        repos.map((repo) => (
          <div key={repo.relative || "."}>
            {repos.length > 1 && (
              <span className="reply-repo">{repo.name}</span>
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
          onError={onError}
        />
      )}
    </div>
  );
}
