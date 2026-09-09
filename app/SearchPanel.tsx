import { useEffect, useMemo, useRef, useState } from "react";
import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Regex,
  Replace,
  ReplaceAll,
  Search,
  WholeWord,
  X,
} from "lucide-react";
import FileIcon from "./FileIcon";
import { call, type Project } from "./types";

export type Match = {
  file: string;
  repo?: string;
  line: number;
  column: number;
  length: number;
  text: string;
};
export type SearchResult = {
  results: Match[];
  files: number;
  truncated: boolean;
};

export function groupByFile(results: Match[]) {
  const groups = new Map<string, Match[]>();
  for (const match of results) {
    const existing = groups.get(match.file);
    if (existing) existing.push(match);
    else groups.set(match.file, [match]);
  }
  return [...groups.entries()];
}

// The matched span is highlighted in place, with long lines trimmed around the
// match so a minified file cannot push the result out of view.
export function splitMatch(match: Match, window = 120) {
  const start = match.column - 1;
  const end = start + match.length;
  const from = Math.max(0, start - window);
  const to = Math.min(match.text.length, end + window);
  return {
    before: (from > 0 ? "…" : "") + match.text.slice(from, start),
    hit: match.text.slice(start, end),
    after: match.text.slice(end, to) + (to < match.text.length ? "…" : ""),
  };
}

export default function SearchPanel({
  project,
  onOpen,
  onError,
}: {
  project: Project | undefined;
  onOpen: (file: string, line: number) => void;
  onError: (error: unknown) => void;
}) {
  const [query, setQuery] = useState(""),
    [replacement, setReplacement] = useState(""),
    [showReplace, setShowReplace] = useState(false),
    [showDetails, setShowDetails] = useState(false),
    [include, setInclude] = useState(""),
    [exclude, setExclude] = useState(""),
    [caseSensitive, setCaseSensitive] = useState(false),
    [wholeWord, setWholeWord] = useState(false),
    [regex, setRegex] = useState(false),
    [result, setResult] = useState<SearchResult | null>(null),
    [collapsed, setCollapsed] = useState<string[]>([]),
    [dismissed, setDismissed] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState<string | null>(null),
    [failed, setFailed] = useState<string | null>(null);
  const projectId = project?.id;
  const request = useRef(0);
  const criteria = { regex, caseSensitive, wholeWord, include, exclude };
  useEffect(() => {
    if (!projectId || !query.trim()) {
      setResult(null);
      setFailed(null);
      return;
    }
    const ticket = ++request.current;
    // Typing must not fire a scan per keystroke, and a slow scan that finishes
    // after a newer one started must not overwrite it.
    const timer = setTimeout(() => {
      setBusy(true);
      call<SearchResult>("search:files", { projectId, query, ...criteria })
        .then((next) => {
          if (ticket !== request.current) return;
          setResult(next);
          setDismissed([]);
          setFailed(null);
        })
        .catch((error) => {
          if (ticket !== request.current) return;
          setResult(null);
          setFailed(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (ticket === request.current) setBusy(false);
        });
    }, 220);
    return () => clearTimeout(timer);
  }, [projectId, query, regex, caseSensitive, wholeWord, include, exclude]);
  const groups = useMemo(
    () =>
      groupByFile(result?.results || []).filter(
        ([file]) => !dismissed.includes(file),
      ),
    [result?.results, dismissed],
  );
  const replaceIn = async (files?: string[]) => {
    if (busy) return;
    const scope = files
      ? `${files.length} file${files.length === 1 ? "" : "s"}`
      : `${groups.length} file${groups.length === 1 ? "" : "s"}`;
    if (
      !window.confirm(
        `Replace every match in ${scope}? This rewrites the files on disk and cannot be undone from here.`,
      )
    )
      return;
    setBusy(true);
    setNote(null);
    try {
      const outcome = await call<{
        files: { file: string; count: number }[];
        replaced: number;
      }>("search:replace", {
        projectId,
        query,
        replacement,
        ...criteria,
        ...(files ? { files } : { files: groups.map(([file]) => file) }),
      });
      setNote(
        `Replaced ${outcome.replaced} match${outcome.replaced === 1 ? "" : "es"} in ${outcome.files.length} file${outcome.files.length === 1 ? "" : "s"}.`,
      );
      // Re-run so the panel reflects what is actually left on disk.
      const next = await call<SearchResult>("search:files", {
        projectId,
        query,
        ...criteria,
      });
      setResult(next);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  if (!project)
    return (
      <div className="scm-empty">
        <Search size={22} />
        <p>Open a workspace to search it.</p>
      </div>
    );
  const total = result?.results.length || 0;
  return (
    <div className="search-panel">
      <div className="search-head">
        <button
          className="search-expand"
          aria-expanded={showReplace}
          aria-label="Toggle replace"
          title="Toggle replace"
          onClick={() => setShowReplace(!showReplace)}
        >
          {showReplace ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <div className="search-fields">
          <div className="search-row">
            <input
              autoFocus
              value={query}
              placeholder="Search"
              aria-label="Search text"
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="search-toggles">
              <button
                aria-pressed={caseSensitive}
                title="Match case"
                onClick={() => setCaseSensitive(!caseSensitive)}
              >
                <CaseSensitive size={14} />
              </button>
              <button
                aria-pressed={wholeWord}
                title="Match whole word"
                onClick={() => setWholeWord(!wholeWord)}
              >
                <WholeWord size={14} />
              </button>
              <button
                aria-pressed={regex}
                title="Use regular expression"
                onClick={() => setRegex(!regex)}
              >
                <Regex size={14} />
              </button>
            </div>
          </div>
          {showReplace && (
            <div className="search-row">
              <input
                value={replacement}
                placeholder="Replace"
                aria-label="Replace text"
                onChange={(e) => setReplacement(e.target.value)}
              />
              <div className="search-toggles">
                <button
                  title="Replace all matches in every listed file"
                  aria-label="Replace all"
                  disabled={busy || !groups.length}
                  onClick={() => void replaceIn()}
                >
                  <ReplaceAll size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
        <button
          className="search-details-toggle"
          aria-pressed={showDetails}
          aria-label="Toggle search details"
          title="Toggle search details"
          onClick={() => setShowDetails(!showDetails)}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
      {showDetails && (
        <>
          <label className="search-filter">
            files to include
            <input
              value={include}
              placeholder="app/**, *.ts"
              onChange={(e) => setInclude(e.target.value)}
            />
          </label>
          <label className="search-filter">
            files to exclude
            <input
              value={exclude}
              placeholder="*.min.js, dist/**"
              onChange={(e) => setExclude(e.target.value)}
            />
          </label>
        </>
      )}
      <p className="search-summary">
        {failed
          ? failed
          : busy
            ? "Searching…"
            : !result
              ? "Results appear as you type. Ignored files are skipped."
              : total
                ? `${total}${result.truncated ? "+" : ""} result${total === 1 ? "" : "s"} in ${groups.length} file${groups.length === 1 ? "" : "s"}`
                : "No results."}
      </p>
      {note && <p className="search-summary">{note}</p>}
      <div className="search-results">
        {groups.map(([file, matches]) => {
          const open = !collapsed.includes(file);
          const repo = matches[0]?.repo;
          return (
            <section key={file}>
              <header>
                <button
                  className="search-file-toggle"
                  aria-expanded={open}
                  aria-label={`${open ? "Collapse" : "Expand"} ${file}`}
                  onClick={() =>
                    setCollapsed(
                      open
                        ? [...collapsed, file]
                        : collapsed.filter((f) => f !== file),
                    )
                  }
                >
                  {open ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                </button>
                <FileIcon path={file} />
                <span className="search-file" title={file}>
                  {file.split("/").pop()}
                </span>
                {repo && <span className="search-repo">{repo}</span>}
                {showReplace && (
                  <button
                    className="search-file-action"
                    title={`Replace all matches in ${file}`}
                    aria-label={`Replace all in ${file}`}
                    disabled={busy}
                    onClick={() => void replaceIn([file])}
                  >
                    <Replace size={12} />
                  </button>
                )}
                <button
                  className="search-file-action"
                  title="Dismiss this file from the results"
                  aria-label={`Dismiss ${file}`}
                  onClick={() => setDismissed([...dismissed, file])}
                >
                  <X size={12} />
                </button>
                <span className="search-count">{matches.length}</span>
              </header>
              {open &&
                matches.map((match) => {
                  const parts = splitMatch(match);
                  return (
                    <button
                      key={`${match.line}:${match.column}`}
                      className="search-hit"
                      onClick={() => onOpen(match.file, match.line)}
                      title={`Open ${file} at line ${match.line}`}
                    >
                      <span className="search-line">{match.line}</span>
                      <span className="search-text">
                        {parts.before}
                        <mark>{parts.hit}</mark>
                        {parts.after}
                      </span>
                    </button>
                  );
                })}
            </section>
          );
        })}
      </div>
      {result?.truncated && (
        <p className="search-summary">
          Showing the first matches only. Narrow the search to see the rest.
        </p>
      )}
    </div>
  );
}
