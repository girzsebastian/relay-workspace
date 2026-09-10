import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { linter, type Diagnostic } from "@codemirror/lint";
import { hoverTooltip } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { call } from "./types";

type Suggestion = { label: string; kind: string; detail?: string };
type Problem = {
  from: number;
  to: number;
  severity: "error" | "warning" | "info";
  message: string;
  code: number;
};
type Hover = {
  from: number;
  to: number;
  signature: string;
  documentation: string;
};

// TypeScript names its kinds; CodeMirror draws icons for its own. Anything
// unmapped still appears, just without a picture.
const KINDS: Record<string, string> = {
  const: "variable",
  let: "variable",
  var: "variable",
  parameter: "variable",
  alias: "variable",
  property: "property",
  getter: "property",
  setter: "property",
  method: "method",
  function: "function",
  "local function": "function",
  class: "class",
  "local class": "class",
  interface: "interface",
  type: "type",
  enum: "enum",
  "enum member": "enum",
  keyword: "keyword",
  module: "namespace",
  script: "namespace",
  constructor: "method",
};

export function completionType(kind: string) {
  return KINDS[kind] || "text";
}

// Where the word being typed starts, so the list filters as more is typed
// rather than reopening on every keystroke.
export function wordStart(text: string, position: number) {
  let start = position;
  while (start > 0 && /[A-Za-z0-9_$]/.test(text[start - 1])) start -= 1;
  return start;
}

export function intelligence(
  projectId: string | null,
  path: string,
): Extension[] {
  if (!projectId) return [];
  const args = (context: { state: { doc: { toString(): string } } }) => ({
    projectId,
    path,
    text: context.state.doc.toString(),
  });
  const source = async (
    context: CompletionContext,
  ): Promise<CompletionResult | null> => {
    const text = context.state.doc.toString();
    const from = wordStart(text, context.pos);
    // Without an explicit request, only offer once a word has been started;
    // otherwise the list opens over every space.
    if (!context.explicit && from === context.pos) return null;
    const result = await call<{ items: Suggestion[] }>("lang:completions", {
      ...args(context),
      offset: context.pos,
    }).catch(() => null);
    if (!result?.items.length) return null;
    return {
      from,
      options: result.items.map((item): Completion => ({
        label: item.label,
        type: completionType(item.kind),
        detail: item.kind,
        info: async () => {
          const detail = await call<{
            signature: string;
            documentation: string;
          } | null>("lang:detail", {
            ...args(context),
            offset: context.pos,
            name: item.label,
          }).catch(() => null);
          if (!detail?.signature) return null;
          const box = document.createElement("div");
          box.className = "cm-info-box";
          const signature = document.createElement("code");
          signature.textContent = detail.signature;
          box.appendChild(signature);
          if (detail.documentation) {
            const doc = document.createElement("p");
            doc.textContent = detail.documentation;
            box.appendChild(doc);
          }
          return box;
        },
      })),
      validFor: /^[A-Za-z0-9_$]*$/,
    };
  };
  return [
    autocompletion({ override: [source], activateOnTyping: true, icons: true }),
    linter(
      async (view) => {
        const problems = await call<Problem[]>("lang:diagnostics", {
          projectId,
          path,
          text: view.state.doc.toString(),
        }).catch(() => []);
        const end = view.state.doc.length;
        return problems.map((problem): Diagnostic => ({
          // A stale buffer can report a span past the end of the document.
          from: Math.min(problem.from, end),
          to: Math.min(Math.max(problem.to, problem.from), end),
          severity: problem.severity,
          message: `${problem.message} ts(${problem.code})`,
        }));
      },
      { delay: 500 },
    ),
    hoverTooltip(async (view, pos) => {
      const info = await call<Hover | null>("lang:hover", {
        projectId,
        path,
        text: view.state.doc.toString(),
        offset: pos,
      }).catch(() => null);
      if (!info?.signature) return null;
      return {
        pos: info.from,
        end: info.to,
        create: () => {
          const box = document.createElement("div");
          box.className = "cm-info-box";
          const signature = document.createElement("code");
          signature.textContent = info.signature;
          box.appendChild(signature);
          if (info.documentation) {
            const doc = document.createElement("p");
            doc.textContent = info.documentation;
            box.appendChild(doc);
          }
          return { dom: box };
        },
      };
    }),
  ];
}
