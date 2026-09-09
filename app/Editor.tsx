import { useEffect, useLayoutEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { intelligence } from "./intelligence";
import { Compartment } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { languageForFile } from "./languages";

const highlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, class: "tok-keyword" },
    { tag: [tags.variableName, tags.name], class: "tok-variable" },
    { tag: tags.propertyName, class: "tok-property" },
    { tag: [tags.string, tags.inserted], class: "tok-string" },
    { tag: [tags.number, tags.bool, tags.null], class: "tok-literal" },
    { tag: tags.comment, class: "tok-comment" },
    {
      tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
      class: "tok-function",
    },
    { tag: [tags.typeName, tags.className, tags.namespace], class: "tok-type" },
    {
      tag: [tags.constant(tags.name), tags.standard(tags.name)],
      class: "tok-constant",
    },
    { tag: tags.definition(tags.variableName), class: "tok-definition" },
    { tag: tags.tagName, class: "tok-tag" },
    { tag: tags.attributeName, class: "tok-attribute" },
    { tag: tags.operator, class: "tok-operator" },
    { tag: tags.heading, class: "tok-heading" },
    { tag: tags.link, class: "tok-link" },
    { tag: tags.strong, fontWeight: "bold" },
    { tag: tags.emphasis, fontStyle: "italic" },
  ]),
);
function theme(dark: boolean) {
  return EditorView.theme(
    {
      "&": {
        height: "100%",
        fontSize: "13px",
        color: dark ? "#d9e1ed" : "#283546",
        backgroundColor: dark ? "#181b21" : "#ffffff",
      },
      ".cm-scroller": {
        overflow: "auto",
        fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
        lineHeight: "1.65",
      },
      ".cm-content": {
        padding: "12px 0",
        caretColor: dark ? "#a8caff" : "#285db4",
      },
      ".cm-gutters": {
        background: dark ? "#181b21" : "#fff",
        border: "none",
        color: dark ? "#657185" : "#8a96a5",
        padding: "12px 8px 0 8px",
      },
      ".cm-activeLine, .cm-activeLineGutter": {
        background: dark ? "#232a36" : "#f0f5fc",
      },
      ".cm-activeLineGutter": { color: dark ? "#b4c6df" : "#3463a0" },
      "&.cm-focused": { outline: "none" },
      ".cm-cursor": { borderLeftColor: dark ? "#acd0ff" : "#285db4" },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        background: dark ? "#344965" : "#d5e5fc",
      },
      ".cm-matchingBracket": {
        background: dark ? "#3a4e60" : "#d9e9fc",
        outline: dark ? "1px solid #6485a4" : "1px solid #a6bfdf",
        borderRadius: "2px",
      },
      ".tok-keyword": {
        color: dark ? "#cf9ef6" : "#8941b0",
        fontWeight: "500",
      },
      ".tok-variable": { color: dark ? "#c4d9f2" : "#315172" },
      ".tok-property, .tok-attribute": { color: dark ? "#8cc9ef" : "#166993" },
      ".tok-string": { color: dark ? "#a8d69a" : "#39743b" },
      ".tok-literal, .tok-constant": { color: dark ? "#efb68a" : "#a5541e" },
      ".tok-comment": {
        color: dark ? "#7e8c9e" : "#758294",
        fontStyle: "italic",
      },
      ".tok-function": { color: dark ? "#ead18f" : "#866410" },
      ".tok-type": { color: dark ? "#80cfbd" : "#197e72" },
      ".tok-definition": { color: dark ? "#91c2ff" : "#2e65b4" },
      ".tok-tag": { color: dark ? "#e6a0ac" : "#ad4b60" },
      ".tok-operator": { color: dark ? "#c1c8dc" : "#53637c" },
      ".tok-heading": {
        color: dark ? "#b2ceff" : "#315eaa",
        fontWeight: "bold",
      },
      ".tok-link": {
        color: dark ? "#8fc1ef" : "#326aa4",
        textDecoration: "underline",
      },
    },
    { dark },
  );
}
export default function Editor({
  path,
  content,
  onChange,
  dark = true,
  projectId = null,
}: {
  path: string;
  content: string;
  onChange: (value: string) => void;
  dark?: boolean;
  projectId?: string | null;
}) {
  const host = useRef<HTMLDivElement>(null),
    instance = useRef<EditorView | null>(null),
    syncing = useRef(false),
    listener = useRef(onChange),
    initial = useRef(content),
    skin = useRef(new Compartment());
  listener.current = onChange;
  initial.current = content;
  useEffect(() => {
    const language = new Compartment(),
      editor = new EditorView({
        parent: host.current!,
        doc: initial.current,
        extensions: [
          basicSetup,
          // Completions, errors and types from the project's own
          // TypeScript service.
          ...intelligence(projectId, path),
          highlight,
          skin.current.of(theme(dark)),
          language.of([]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncing.current)
              listener.current(update.state.doc.toString());
          }),
        ],
      });
    instance.current = editor;
    let disposed = false;
    const description = languageForFile(path);
    if (description)
      description
        .load()
        .then((support) => {
          if (!disposed)
            editor.dispatch({ effects: language.reconfigure(support) });
        })
        .catch(() => {
          if (host.current && !disposed)
            host.current.dataset.language = "Plain text";
        });
    return () => {
      disposed = true;
      instance.current = null;
      editor.destroy();
    };
  }, [path]);
  useEffect(() => {
    instance.current?.dispatch({
      effects: skin.current.reconfigure(theme(dark)),
    });
  }, [dark]);
  // Apply shared-buffer changes during commit. A passive effect can replay an
  // older prop after another keystroke has already changed the editor document.
  useLayoutEffect(() => {
    const editor = instance.current;
    if (editor && editor.state.doc.toString() !== content) {
      syncing.current = true;
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: content },
      });
      syncing.current = false;
    }
  }, [content]);
  return (
    <div
      className="code-editor"
      data-language={languageForFile(path)?.name || "Plain text"}
      ref={host}
    />
  );
}
