import { useState } from "react";
import { ChevronDown, ChevronRight, FileDiff } from "lucide-react";
import FileIcon from "./FileIcon";
import DiffView from "./DiffView";
import { countLabel, statusLetter } from "./SourceControl";
import type { ReplyChanges } from "./MessageChanges";
import type { Chat, GitFile } from "./types";

type Entry = {
  repo: string;
  repoName: string;
  file: GitFile;
  replies: number;
};

// Every file the agent touched in this conversation, newest reply first. A file
// changed by several replies appears once, with a count, because what matters
// here is the file's state now rather than which turn produced it.
export function gather(messages: Chat["messages"]): Entry[] {
  const entries = new Map<string, Entry>();
  for (const message of messages) {
    if (message.role === "user" || message.reverted) continue;
    for (const repo of (message.changed || []) as ReplyChanges[]) {
      for (const file of repo.files) {
        const key = `${repo.relative}/${file.path}`;
        const existing = entries.get(key);
        if (existing) {
          existing.replies += 1;
          existing.file = file;
        } else {
          entries.set(key, {
            repo: repo.relative,
            repoName: repo.name,
            file,
            replies: 1,
          });
        }
      }
    }
  }
  return [...entries.values()].reverse();
}

export default function ChatChanges({
  projectId,
  messages,
  onError,
}: {
  projectId: string;
  messages: Chat["messages"];
  onError: (error: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<{ file: string; repo: string } | null>(null);
  const entries = gather(messages);
  if (!entries.length) return null;
  const added = entries.reduce((n, e) => n + (e.file.added || 0), 0);
  const removed = entries.reduce((n, e) => n + (e.file.removed || 0), 0);
  const repos = new Set(entries.map((e) => e.repo)).size;
  return (
    <div className="chat-changes">
      <button
        className="chat-changes-toggle"
        aria-expanded={open}
        title="Every file the agent changed in this conversation"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <FileDiff size={13} />
        <b>
          {entries.length} file{entries.length === 1 ? "" : "s"} changed
        </b>
        <span className="chat-changes-counts">
          +{added} −{removed}
        </span>
      </button>
      {open && (
        <ul className="scm-files chat-changes-list">
          {entries.map((entry) => (
            <li key={`${entry.repo}/${entry.file.path}`}>
              <button
                className="scm-file"
                title={`See what changed in ${entry.file.path}`}
                onClick={() =>
                  setDiff({ file: entry.file.path, repo: entry.repo })
                }
              >
                <FileIcon path={entry.file.path} />
                <span className="scm-path">{entry.file.path}</span>
                {repos > 1 && (
                  <span className="chat-changes-repo">{entry.repoName}</span>
                )}
                {entry.replies > 1 && (
                  <span className="chat-changes-repeat">×{entry.replies}</span>
                )}
                {countLabel(entry.file) && (
                  <span className="scm-counts">{countLabel(entry.file)}</span>
                )}
                <span className={`scm-letter s-${statusLetter(entry.file)}`}>
                  {statusLetter(entry.file)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
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
