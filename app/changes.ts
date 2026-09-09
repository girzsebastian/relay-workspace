import {
  Decoration,
  EditorView,
  GutterMarker,
  ViewPlugin,
  gutterLineClass,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { forEachDiagnostic } from "@codemirror/lint";
import {
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { call } from "./types";

export type LineChanges = {
  added: number[];
  removed: { line: number; count: number }[];
};

export const setChanges = StateEffect.define<LineChanges>();

// A line that only introduces a comment is a weaker kind of change than one
// that introduces code, so it gets its own, quieter green.
const COMMENT = /^\s*(\/\/|\/\*|\*(?!\/)|\*\/|#|--|<!--)/;
export function isComment(text: string) {
  return COMMENT.test(text);
}

// One decoration per line, never two at the same position, because a range
// builder will not take two marks that start in the same place.
const marks = new Map<string, Decoration>();
function lineMark(names: string[]) {
  const key = names.join(" ");
  let mark = marks.get(key);
  if (!mark) marks.set(key, (mark = Decoration.line({ class: key })));
  return mark;
}

class Bar extends GutterMarker {
  constructor(readonly elementClass: string) {
    super();
  }
}
const addedBar = new Bar("cm-gutter-added");
const deletedBar = new Bar("cm-gutter-deleted");

// Both the line backgrounds and the gutter bars describe the same lines, so
// they are built together from one pass over the file.
export function plan(state: EditorState, changes: LineChanges) {
  const lines = new Map<
    number,
    { added: boolean; comment: boolean; deleted: boolean }
  >();
  const at = (line: number) => {
    let entry = lines.get(line);
    if (!entry)
      lines.set(
        line,
        (entry = { added: false, comment: false, deleted: false }),
      );
    return entry;
  };
  for (const line of changes.added) {
    if (line < 1 || line > state.doc.lines) continue;
    const entry = at(line);
    entry.added = true;
    entry.comment = isComment(state.doc.line(line).text);
  }
  for (const gap of changes.removed) {
    // A deletion has no line of its own. It is drawn on the line that closed
    // over it, or on the last line when the end of the file was removed.
    const line = Math.min(Math.max(gap.line, 1), state.doc.lines);
    at(line).deleted = true;
  }
  return [...lines.entries()].sort((a, b) => a[0] - b[0]);
}

function build(state: EditorState, changes: LineChanges) {
  const decorations = new RangeSetBuilder<Decoration>();
  const gutter = new RangeSetBuilder<GutterMarker>();
  for (const [line, entry] of plan(state, changes)) {
    const from = state.doc.line(line).from;
    const names: string[] = [];
    if (entry.added) names.push("cm-line-added");
    if (entry.added && entry.comment) names.push("cm-line-comment");
    if (entry.deleted) names.push("cm-line-deleted");
    decorations.add(from, from, lineMark(names));
    gutter.add(from, from, entry.added ? addedBar : deletedBar);
  }
  return { decorations: decorations.finish(), gutter: gutter.finish() };
}

const decorationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects)
      if (effect.is(setChanges))
        return build(tr.state, effect.value).decorations;
    // Between refreshes the marks follow the edits, so typing does not smear
    // the colours onto the wrong lines.
    return value.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const gutterField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    for (const effect of tr.effects)
      if (effect.is(setChanges)) return build(tr.state, effect.value).gutter;
    return value.map(tr.changes);
  },
  provide: (field) => gutterLineClass.from(field),
});

type Tick = { top: number; kind: string };

// The strip down the right edge: every change and every problem in the whole
// file at a glance, including the parts scrolled out of sight.
export function ticks(state: EditorState) {
  const lines = Math.max(state.doc.lines, 1);
  const marks: Tick[] = [];
  const seen = new Set<string>();
  const push = (line: number, kind: string) => {
    const top = ((line - 1) / lines) * 100;
    const key = `${kind}:${Math.round(top * 4)}`;
    if (seen.has(key)) return;
    seen.add(key);
    marks.push({ top, kind });
  };
  const decorations = state.field(decorationField, false);
  if (decorations) {
    const cursor = decorations.iter();
    while (cursor.value) {
      const line = state.doc.lineAt(cursor.from).number;
      const names = String(cursor.value.spec.class || "");
      if (names.includes("cm-line-added")) push(line, "added");
      if (names.includes("cm-line-deleted")) push(line, "deleted");
      cursor.next();
    }
  }
  forEachDiagnostic(state, (diagnostic, from) => {
    if (from > state.doc.length) return;
    push(
      state.doc.lineAt(from).number,
      diagnostic.severity === "error" ? "error" : "warning",
    );
  });
  return marks;
}

const ruler = ViewPlugin.fromClass(
  class {
    dom: HTMLElement;
    constructor(readonly view: EditorView) {
      this.dom = document.createElement("div");
      this.dom.className = "cm-change-ruler";
      view.dom.appendChild(this.dom);
      this.draw();
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.state !== update.startState) this.draw();
    }
    draw() {
      const marks = ticks(this.view.state);
      this.dom.textContent = "";
      for (const mark of marks) {
        const tick = document.createElement("i");
        tick.className = `cm-ruler-tick t-${mark.kind}`;
        tick.style.top = `${mark.top}%`;
        this.dom.appendChild(tick);
      }
    }
    destroy() {
      this.dom.remove();
    }
  },
);

// Ask the main process which lines of this file differ from the last commit,
// and keep asking as the file is edited and saved.
export function changeTracking(
  projectId: string | null,
  path: string,
): Extension[] {
  if (!projectId) return [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const refresh = (view: EditorView) => {
    call<LineChanges>("git:file-changes", { projectId, path })
      .then((changes) => {
        if (!view.dom.isConnected) return;
        view.dispatch({ effects: setChanges.of(changes) });
      })
      .catch(() => {});
  };
  return [
    decorationField,
    gutterField,
    ruler,
    ViewPlugin.fromClass(
      class {
        constructor(readonly view: EditorView) {
          refresh(view);
        }
        update(update: ViewUpdate) {
          if (!update.docChanged) return;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => refresh(update.view), 1200);
        }
        destroy() {
          if (timer) clearTimeout(timer);
        }
      },
    ),
  ];
}
