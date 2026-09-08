import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { markdown } from "@codemirror/lang-markdown";
export default function Editor({
  path,
  content,
  onChange,
  dark = true,
}: {
  dark?: boolean;
  path: string;
  content: string;
  onChange: (value: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<EditorView | null>(null);
  const syncing = useRef(false);
  const listener = useRef(onChange);
  listener.current = onChange;
  const initial = useRef(content);
  initial.current = content;
  useEffect(() => {
    const language = /\.[jt]sx?$/.test(path)
      ? javascript({ jsx: true, typescript: true })
      : path.endsWith(".json")
        ? json()
        : path.endsWith(".md")
          ? markdown()
          : [];
    const editor = new EditorView({
      parent: host.current!,
      doc: initial.current,
      extensions: [
        basicSetup,
        language,
        ...(dark
          ? [
              syntaxHighlighting(
                HighlightStyle.define([
                  { tag: tags.keyword, color: "#c6a3e4" },
                  { tag: [tags.name, tags.propertyName], color: "#a7cae6" },
                  { tag: [tags.string, tags.inserted], color: "#c9ad92" },
                  {
                    tag: [tags.number, tags.bool, tags.null],
                    color: "#b1cda0",
                  },
                  { tag: tags.comment, color: "#7f9d78", fontStyle: "italic" },
                  {
                    tag: [tags.function(tags.variableName), tags.labelName],
                    color: "#dcd5aa",
                  },
                  { tag: [tags.typeName, tags.className], color: "#8fc9bd" },
                  { tag: tags.heading, color: "#d4d6dc", fontWeight: "bold" },
                  {
                    tag: tags.link,
                    color: "#96b9db",
                    textDecoration: "underline",
                  },
                ]),
              ),
            ]
          : []),
        EditorView.theme(
          {
            "&": {
              height: "100%",
              fontSize: "12px",
              backgroundColor: dark ? "#18191c" : "#ffffff",
              color: dark ? "#d2d4db" : "#262a32",
            },
            ".cm-scroller": {
              overflow: "auto",
              fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
            },
            ".cm-content": { padding: "18px 0" },
            ".cm-gutters": {
              background: dark ? "#18191c" : "#ffffff",
              border: "none",
              color: "#b0b6b2",
              padding: "18px 8px 0 12px",
            },
            ".cm-activeLine": { background: dark ? "#22252b" : "#f4f7f3" },
            ".cm-activeLineGutter": {
              background: dark ? "#22252b" : "#f4f7f3",
            },
            "&.cm-focused": { outline: "none" },
            ".cm-cursor": { borderLeftColor: dark ? "#e1e4e9" : "#222" },
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
              background: dark ? "#34415b" : "#cee0ff",
            },
          },
          { dark },
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncing.current)
            listener.current(update.state.doc.toString());
        }),
      ],
    });
    instance.current = editor;
    return () => {
      instance.current = null;
      editor.destroy();
    };
  }, [path, dark]);
  useEffect(() => {
    const editor = instance.current;
    if (editor && editor.state.doc.toString() !== content) {
      syncing.current = true;
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: content },
      });
      syncing.current = false;
    }
  }, [content]);
  return <div className="code-editor" ref={host} />;
}
