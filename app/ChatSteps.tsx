import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Terminal,
} from "lucide-react";
import type { ChatStep } from "./types";

// A one-line description of what a step actually did, taken from the tool's own
// input rather than a generic "used a tool".
export function describeStep(step: ChatStep) {
  const input = (step.input || {}) as Record<string, unknown>;
  const first = (...keys: string[]) => {
    for (const key of keys) {
      const value = input[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  };
  if (step.name === "Bash")
    return first("description", "command") || "Ran a command";
  if (step.name === "Read" || step.name === "Write" || step.name === "Edit")
    return first("file_path", "path") || step.name;
  if (step.name === "Grep") return first("pattern") || "Searched";
  if (step.name === "Glob") return first("pattern") || "Listed files";
  return first("description", "command", "pattern", "file_path") || step.name;
}

export function elapsedLabel(ms?: number) {
  if (!ms || ms < 0) return null;
  const seconds = ms / 1000;
  return seconds < 60
    ? `Worked for ${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
    : `Worked for ${Math.round(seconds / 60)}m`;
}

export default function ChatSteps({
  steps,
  durationMs,
  running,
}: {
  steps: ChatStep[];
  durationMs?: number;
  running?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const actions = steps.filter((step) => step.kind === "tool");
  if (!actions.length) return null;
  const label = running
    ? `Working · ${actions.length} step${actions.length === 1 ? "" : "s"}`
    : elapsedLabel(durationMs) ||
      `${actions.length} step${actions.length === 1 ? "" : "s"}`;
  return (
    <div className="chat-steps">
      <button
        className="chat-steps-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {label}
        <span>
          {actions.length} action{actions.length === 1 ? "" : "s"}
        </span>
      </button>
      {open &&
        actions.map((step, index) => (
          <div
            className={`chat-step ${step.error ? "failed" : ""}`}
            key={step.id || index}
          >
            <header>
              {step.error ? (
                <AlertTriangle size={12} />
              ) : (
                <Terminal size={12} />
              )}
              <b>{step.name}</b>
              <span title={describeStep(step)}>{describeStep(step)}</span>
            </header>
            {step.output && (
              <pre>{String(step.output).trimEnd().slice(0, 4000)}</pre>
            )}
          </div>
        ))}
    </div>
  );
}
