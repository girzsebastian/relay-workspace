import { useEffect, useRef, useState } from "react";
import { Check, ShieldQuestion, SkipForward } from "lucide-react";
import { call, type Approval } from "./types";

// The one-line version of what is about to happen, taken from the tool's own
// input rather than a generic "an action needs approval".
export function describeApproval(approval: Approval) {
  const input = (approval.input || {}) as Record<string, unknown>;
  const text = (...keys: string[]) => {
    for (const key of keys) {
      const value = input[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  };
  return (
    text("command", "description", "file_path", "path", "pattern", "query") ||
    approval.tool
  );
}

export default function ApprovalCard({
  approval,
  onError,
}: {
  approval: Approval;
  onError: (error: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const decide = (decision: "accept" | "skip" | "remember") => {
    if (busy) return;
    setBusy(true);
    call("approval:resolve", { id: approval.id, decision }).catch(onError);
  };
  // Enter accepts, Escape skips, Shift+Enter remembers — the same keys the
  // buttons show, so the card can be answered without reaching for the mouse.
  useEffect(() => {
    card.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter" && event.shiftKey) {
        event.preventDefault();
        decide(approval.canRemember ? "remember" : "accept");
      } else if (event.key === "Enter") {
        event.preventDefault();
        decide("accept");
      } else if (event.key === "Escape") {
        event.preventDefault();
        decide("skip");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <div className="approval-card" ref={card} tabIndex={-1} role="alertdialog">
      <header>
        <ShieldQuestion size={15} />
        <b>{approval.tool}</b>
        <span>needs your approval</span>
      </header>
      <p className="approval-what" title={describeApproval(approval)}>
        {describeApproval(approval)}
      </p>
      {approval.reason && <p className="approval-why">{approval.reason}</p>}
      <div className="approval-actions">
        <button
          className="button primary compact"
          disabled={busy}
          onClick={() => decide("accept")}
        >
          <Check size={13} />
          Accept
          <kbd>⏎</kbd>
        </button>
        <button
          className="button compact"
          disabled={busy}
          onClick={() => decide("skip")}
        >
          <SkipForward size={13} />
          Skip
          <kbd>esc</kbd>
        </button>
        {approval.canRemember && (
          <button
            className="button compact"
            disabled={busy}
            title="Run this without asking again in this workspace"
            onClick={() => decide("remember")}
          >
            Always allow
            <kbd>⇧⏎</kbd>
          </button>
        )}
      </div>
    </div>
  );
}
