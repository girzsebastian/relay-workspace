import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileDiff,
  GitBranch,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Undo2,
} from "lucide-react";
import FileIcon from "./FileIcon";
import DiffView from "./DiffView";
import {
  call,
  type GitCommit,
  type GitFile,
  type Project,
  type RepoStatus,
} from "./types";

export function statusLetter(file: GitFile) {
  if (file.untracked) return "U";
  if (file.index === "U" || file.worktree === "U") return "!";
  const code = file.worktree !== "." ? file.worktree : file.index;
  return code === "." ? "M" : code;
}

export function countLabel(file: GitFile) {
  // A binary file reports no line counts; showing "+0 -0" would be a lie.
  if (file.added == null || file.removed == null) return null;
  return `+${file.added} -${file.removed}`;
}

export type MenuItem = {
  id: string;
  label: string;
  destructive: boolean;
  output: boolean;
  input: { label: string; placeholder?: string; multiline?: boolean } | null;
};
export type MenuGroup = { group: string; items: MenuItem[] };

export default function SourceControl({
  project,
  onOpenFile,
  onError,
}: {
  project: Project | undefined;
  onOpenFile?: (path: string) => void;
  onError: (error: unknown) => void;
}) {
  const [repos, setRepos] = useState<RepoStatus[] | null>(null),
    [scope, setScope] = useState("auto"),
    [expanded, setExpanded] = useState<string[] | null>(null),
    [messages, setMessages] = useState<Record<string, string>>({}),
    [menu, setMenu] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState<string | null>(null),
    [diff, setDiff] = useState<{ file: string; repo: string } | null>(null),
    [branches, setBranches] = useState<{
      repo: string;
      list: { name: string; current: boolean }[];
    } | null>(null),
    [history, setHistory] = useState<{ repo: string; log: GitCommit[] } | null>(
      null,
    ),
    [commands, setCommands] = useState<MenuGroup[]>([]),
    [openGroup, setOpenGroup] = useState<string | null>(null),
    [prompt, setPrompt] = useState<{
      repo: RepoStatus;
      item: MenuItem;
      value: string;
    } | null>(null),
    [output, setOutput] = useState<{ title: string; text: string } | null>(
      null,
    );
  const projectId = project?.id;
  const request = useRef(0);
  const refresh = useCallback(async () => {
    if (!projectId) return;
    const ticket = ++request.current;
    try {
      const next = await call<RepoStatus[]>("git:repos", { projectId });
      if (ticket === request.current) setRepos(next);
    } catch (error) {
      onError(error);
    }
  }, [projectId, onError]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    call<MenuGroup[]>("git:menu", {}).then(setCommands).catch(onError);
  }, [onError]);
  const act = async (run: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    setMenu(null);
    try {
      await run();
      await refresh();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  const execute = async (repo: RepoStatus, item: MenuItem, input?: string) => {
    if (
      item.destructive &&
      !window.confirm(
        `${item.label} in ${repo.name}? This changes or removes work and cannot be undone from here.`,
      )
    )
      return;
    await act(async () => {
      const result = await call<{ output?: string }>("git:run", {
        projectId,
        repo: repo.relative,
        command: item.id,
        ...(input ? { input } : {}),
      });
      if (result.output !== undefined)
        setOutput({
          title: `${item.label} · ${repo.name}`,
          text: result.output || "No output.",
        });
    });
  };
  const choose = (repo: RepoStatus, item: MenuItem) => {
    setMenu(null);
    setOpenGroup(null);
    if (item.input) setPrompt({ repo, item, value: "" });
    else void execute(repo, item);
  };
  const runMenu = async (repo: RepoStatus, action: string) => {
    if (action === "checkout") {
      setMenu(null);
      const list = await call<{ name: string; current: boolean }[]>(
        "git:branches",
        { projectId, repo: repo.relative },
      ).catch((error) => {
        onError(error);
        return [];
      });
      setBranches({ repo: repo.relative, list });
      return;
    }
    const stashing = action === "stash" || action === "stash-pop";
    await act(() =>
      call(stashing ? "git:stash" : `git:${action}`, {
        projectId,
        repo: repo.relative,
        ...(action === "stash-pop" ? { pop: true } : {}),
      }),
    );
  };
  if (!project)
    return (
      <div className="scm-empty">
        <GitBranch size={22} />
        <p>Open a workspace to see its changes.</p>
      </div>
    );
  if (repos && !repos.length)
    return (
      <div className="scm-empty">
        <GitBranch size={22} />
        <p>No git repository under {project.name}.</p>
        <small>
          Relay looks in the workspace folder and its subfolders, so a workspace
          holding several checkouts shows each of them here.
        </small>
      </div>
    );
  const visible = (repos || []).filter(
    (repo) => scope === "auto" || repo.relative === scope,
  );
  return (
    <div className="scm">
      <header className="scm-header">
        <span className="scm-title">Changes</span>
        <select
          aria-label="Select the repository to view"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="auto">Auto · all repositories</option>
          {(repos || []).map((repo) => (
            <option key={repo.relative} value={repo.relative}>
              {repo.name}
            </option>
          ))}
        </select>
        <button title="Refresh all repositories" onClick={() => void refresh()}>
          <RotateCcw size={13} />
        </button>
      </header>
      {note && <p className="scm-note">{note}</p>}
      {visible.map((repo) => {
        const open = expanded
          ? expanded.includes(repo.relative)
          : repo.files.length > 0;
        const message = messages[repo.relative] || "";
        return (
          <section className="scm-repo" key={repo.relative || "."}>
            <header>
              <button
                className="scm-repo-name"
                aria-expanded={open}
                onClick={() => {
                  const current =
                    expanded ??
                    (repos || [])
                      .filter((r) => r.files.length)
                      .map((r) => r.relative);
                  setExpanded(
                    open
                      ? current.filter((id) => id !== repo.relative)
                      : [...current, repo.relative],
                  );
                }}
              >
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <b>{repo.name}</b>
              </button>
              <span
                className="scm-branch"
                title={repo.upstream || "no upstream"}
              >
                <GitBranch size={11} />
                {repo.branch || "detached"}
                {repo.ahead ? ` ↑${repo.ahead}` : ""}
                {repo.behind ? ` ↓${repo.behind}` : ""}
              </span>
              <span className="scm-repo-actions">
                <button
                  title={
                    repo.upstream
                      ? "Synchronize changes (pull, then push)"
                      : "No upstream branch yet"
                  }
                  disabled={busy || !repo.upstream}
                  onClick={() => void runMenu(repo, "sync")}
                >
                  <RefreshCw size={13} />
                </button>
                <button
                  title="Commit all changes in this repository"
                  disabled={busy || !message.trim() || !repo.files.length}
                  onClick={() =>
                    act(async () => {
                      await call("git:commit", {
                        projectId,
                        repo: repo.relative,
                        message,
                      });
                      setMessages({ ...messages, [repo.relative]: "" });
                    })
                  }
                >
                  <Check size={13} />
                </button>
                <button
                  title="Refresh this repository"
                  disabled={busy}
                  onClick={() => void refresh()}
                >
                  <RotateCcw size={13} />
                </button>
                <button
                  title="More actions"
                  aria-haspopup="menu"
                  aria-expanded={menu === repo.relative}
                  onClick={() =>
                    setMenu(menu === repo.relative ? null : repo.relative)
                  }
                >
                  <MoreHorizontal size={13} />
                </button>
                {menu === repo.relative && (
                  <div className="scm-menu" role="menu">
                    <button
                      role="menuitem"
                      onClick={() => void runMenu(repo, "checkout")}
                    >
                      Checkout to…
                    </button>
                    {commands.map((section) => (
                      <div className="scm-menu-group" key={section.group}>
                        <button
                          role="menuitem"
                          aria-haspopup="menu"
                          aria-expanded={openGroup === section.group}
                          onClick={() =>
                            setOpenGroup(
                              openGroup === section.group
                                ? null
                                : section.group,
                            )
                          }
                        >
                          {section.group}
                          <ChevronRight size={12} />
                        </button>
                        {openGroup === section.group && (
                          <div className="scm-submenu" role="menu">
                            {section.items.map((item) => (
                              <button
                                key={item.id}
                                role="menuitem"
                                className={
                                  item.destructive ? "destructive" : undefined
                                }
                                onClick={() => choose(repo, item)}
                              >
                                {item.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenu(null);
                        call<GitCommit[]>("git:log", {
                          projectId,
                          repo: repo.relative,
                          limit: 50,
                        })
                          .then((log) => setHistory({ repo: repo.name, log }))
                          .catch(onError);
                      }}
                    >
                      Show history
                    </button>
                  </div>
                )}
              </span>
            </header>
            {repo.error && <p className="scm-note">{repo.error}</p>}
            {open && repo.files.length > 0 && (
              <>
                <textarea
                  value={message}
                  placeholder={`Message (commit on "${repo.branch || "detached"}")`}
                  onChange={(e) =>
                    setMessages({
                      ...messages,
                      [repo.relative]: e.target.value,
                    })
                  }
                />
                <ul className="scm-files">
                  {repo.files.map((file) => (
                    <li key={file.path}>
                      <button
                        className="scm-file"
                        title={`Open ${file.path}${
                          file.from ? ` (renamed from ${file.from})` : ""
                        }`}
                        onClick={() =>
                          onOpenFile?.(
                            repo.relative
                              ? `${repo.relative}/${file.path}`
                              : file.path,
                          )
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
                      <button
                        className="scm-compare"
                        title={`Compare ${file.path} with the last commit`}
                        aria-label={`Compare ${file.path}`}
                        onClick={() =>
                          setDiff({ file: file.path, repo: repo.relative })
                        }
                      >
                        <FileDiff size={13} />
                      </button>
                      <button
                        className="scm-discard"
                        title={
                          file.untracked
                            ? "Untracked files are never discarded by Relay"
                            : `Discard changes in ${file.path}`
                        }
                        disabled={busy || file.untracked}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Discard your changes in ${file.path}? This cannot be undone.`,
                            )
                          )
                            return;
                          void act(async () => {
                            const result = await call<RepoStatus>(
                              "git:discard",
                              {
                                projectId,
                                repo: repo.relative,
                                paths: [file.path],
                              },
                            );
                            if (result.skippedUntracked?.length)
                              setNote(
                                `Kept ${result.skippedUntracked.length} untracked file(s); git cannot restore those.`,
                              );
                          });
                        }}
                      >
                        <Undo2 size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        );
      })}
      {prompt && (
        <div className="modal-backdrop" onClick={() => setPrompt(null)}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const { repo, item, value } = prompt;
              setPrompt(null);
              void execute(repo, item, value);
            }}
          >
            <header>
              <b>
                {prompt.item.label} · {prompt.repo.name}
              </b>
              <button
                type="button"
                className="modal-close"
                onClick={() => setPrompt(null)}
              >
                ✕
              </button>
            </header>
            <label className="modal-field">
              {prompt.item.input?.label}
              {prompt.item.input?.multiline ? (
                <textarea
                  autoFocus
                  required
                  rows={3}
                  value={prompt.value}
                  onChange={(e) =>
                    setPrompt({ ...prompt, value: e.target.value })
                  }
                />
              ) : (
                <input
                  autoFocus
                  required
                  value={prompt.value}
                  placeholder={prompt.item.input?.placeholder}
                  onChange={(e) =>
                    setPrompt({ ...prompt, value: e.target.value })
                  }
                />
              )}
            </label>
            <div className="settings-actions">
              <button className="button primary compact" type="submit">
                {prompt.item.label}
              </button>
            </div>
          </form>
        </div>
      )}
      {output && (
        <div className="modal-backdrop" onClick={() => setOutput(null)}>
          <div
            className="modal diff-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <b>{output.title}</b>
              <button className="modal-close" onClick={() => setOutput(null)}>
                ✕
              </button>
            </header>
            <pre className="diff-body">{output.text}</pre>
          </div>
        </div>
      )}
      {branches && (
        <div className="modal-backdrop" onClick={() => setBranches(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header>
              <b>Checkout a branch</b>
              <button className="modal-close" onClick={() => setBranches(null)}>
                ✕
              </button>
            </header>
            <ul className="scm-branch-list">
              {branches.list.map((branch) => (
                <li key={branch.name}>
                  <button
                    disabled={branch.current || busy}
                    onClick={() => {
                      const repo = branches.repo;
                      setBranches(null);
                      void act(() =>
                        call("git:checkout", {
                          projectId,
                          repo,
                          branch: branch.name,
                        }),
                      );
                    }}
                  >
                    <GitBranch size={12} />
                    {branch.name}
                    {branch.current && <span>current</span>}
                  </button>
                </li>
              ))}
              {!branches.list.length && (
                <li className="scm-clean">No local branches found.</li>
              )}
            </ul>
          </div>
        </div>
      )}
      {history && (
        <div className="modal-backdrop" onClick={() => setHistory(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header>
              <b>{history.repo}</b>
              <button className="modal-close" onClick={() => setHistory(null)}>
                ✕
              </button>
            </header>
            <ul className="scm-log">
              {history.log.map((commit) => (
                <li key={commit.sha}>
                  <i />
                  <span className="scm-subject">{commit.subject}</span>
                  <span className="scm-author">{commit.author}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {diff && projectId && (
        <DiffView
          projectId={projectId}
          repo={diff.repo}
          file={diff.file}
          onClose={() => setDiff(null)}
          onChanged={() => void refresh()}
          onError={onError}
        />
      )}
    </div>
  );
}
