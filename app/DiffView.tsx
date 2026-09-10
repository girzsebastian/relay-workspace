import { useCallback, useEffect, useState } from "react";
import { Check, Undo2 } from "lucide-react";
import { call } from "./types";

export type DiffRow = {
  kind: "context" | "change" | "add" | "remove";
  left: string | null;
  right: string | null;
};
export type Hunk = {
  index: number;
  header: string;
  oldStart: number;
  newStart: number;
  rows: DiffRow[];
};

// Line numbers are counted as the rows are rendered: a removed line advances
// only the left side, an added line only the right.
export function numberRows(hunk: Hunk) {
  let left = hunk.oldStart;
  let right = hunk.newStart;
  return hunk.rows.map((row) => {
    const numbered = {
      ...row,
      leftNumber: row.left === null ? null : left,
      rightNumber: row.right === null ? null : right,
    };
    if (row.left !== null) left += 1;
    if (row.right !== null) right += 1;
    return numbered;
  });
}

export default function DiffView({
  projectId,
  repo,
  file,
  onClose,
  onChanged,
  onError,
}: {
  projectId: string;
  repo: string;
  file: string;
  onClose: () => void;
  onChanged?: () => void;
  onError: (error: unknown) => void;
}) {
  const [hunks, setHunks] = useState<Hunk[] | null>(null),
    [kept, setKept] = useState<number[]>([]),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const next = await call<{ hunks: Hunk[] }>("git:hunks", {
        projectId,
        repo,
        file,
      });
      setHunks(next.hunks);
    } catch (error) {
      onError(error);
    }
  }, [projectId, repo, file, onError]);
  useEffect(() => {
    void load();
  }, [load]);
  const revert = async (index: number) => {
    if (busy) return;
    if (
      !window.confirm(
        `Undo this change in ${file}? The rest of the file keeps its edits.`,
      )
    )
      return;
    setBusy(true);
    try {
      await call("git:revert-hunk", { projectId, repo, file, index });
      setKept([]);
      await load();
      onChanged?.();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  const visible = (hunks || []).filter((hunk) => !kept.includes(hunk.index));
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal diff-modal wide"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <b>{file}</b>
          <span className="diff-repo">{repo || "workspace"}</span>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="diff-scroll">
          {hunks && !hunks.length && (
            <p className="scm-clean">This file has no uncommitted changes.</p>
          )}
          {visible.map((hunk, position) => (
            <section className="diff-hunk" key={hunk.index}>
              <header>
                <span>
                  {position + 1} of {visible.length}
                </span>
                <button
                  className="button compact"
                  disabled={busy}
                  title="Undo this change"
                  onClick={() => void revert(hunk.index)}
                >
                  <Undo2 size={13} />
                  Undo
                </button>
                <button
                  className="button primary compact"
                  title="Keep this change and hide it"
                  onClick={() => setKept([...kept, hunk.index])}
                >
                  <Check size={13} />
                  Keep
                </button>
              </header>
              <table className="diff-table">
                <tbody>
                  {numberRows(hunk).map((row, index) => (
                    <tr key={index} className={`row-${row.kind}`}>
                      <td className="diff-gutter">{row.leftNumber ?? ""}</td>
                      <td
                        className={
                          row.left === null ? "diff-empty" : "diff-old"
                        }
                      >
                        {row.left ?? ""}
                      </td>
                      <td className="diff-gutter">{row.rightNumber ?? ""}</td>
                      <td
                        className={
                          row.right === null ? "diff-empty" : "diff-new"
                        }
                      >
                        {row.right ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
