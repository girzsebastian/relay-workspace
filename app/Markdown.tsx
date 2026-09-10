import { Fragment, type ReactNode } from "react";

// Markdown is rendered into React elements rather than injected as HTML, so a
// reply can never introduce markup of its own.
type Block =
  | { kind: "code"; language: string; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "paragraph"; text: string };

export function parseBlocks(source: string): Block[] {
  const lines = String(source || "").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) {
      blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = /^```(\S*)\s*$/.exec(line.trim());
    if (fence) {
      flush();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        body.push(lines[i]);
        i += 1;
      }
      blocks.push({
        kind: "code",
        language: fence[1] || "",
        text: body.join("\n"),
      });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2],
      });
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = !!numbered;
      const items = [(bullet || numbered)![1]];
      while (i + 1 < lines.length) {
        const next = ordered
          ? /^\s*\d+[.)]\s+(.*)$/.exec(lines[i + 1])
          : /^\s*[-*+]\s+(.*)$/.exec(lines[i + 1]);
        if (!next) break;
        items.push(next[1]);
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      const text = [quote[1]];
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) {
        text.push(lines[i + 1].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", text: text.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

// Inline spans, innermost first: code wins over emphasis so `**x**` inside
// backticks stays literal.
export function renderInline(text: string, keyPrefix = ""): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last)
      nodes.push(
        <Fragment key={`${keyPrefix}t${index++}`}>
          {text.slice(last, match.index)}
        </Fragment>,
      );
    const token = match[0];
    const key = `${keyPrefix}m${index++}`;
    if (token.startsWith("`"))
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("**") || token.startsWith("__"))
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("*"))
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      // The address is shown rather than made clickable: a reply should not be
      // able to send anyone anywhere with one click.
      nodes.push(
        <span className="md-link" key={key} title={link?.[2]}>
          {link?.[1]}
        </span>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length)
    nodes.push(
      <Fragment key={`${keyPrefix}t${index++}`}>{text.slice(last)}</Fragment>,
    );
  return nodes;
}

export default function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="md">
      {blocks.map((block, index) => {
        const key = `b${index}`;
        if (block.kind === "code")
          return (
            <pre className="md-code" key={key}>
              {block.language && (
                <span className="md-code-language">{block.language}</span>
              )}
              <code>{block.text}</code>
            </pre>
          );
        if (block.kind === "heading") {
          const Tag = `h${Math.min(block.level + 2, 6)}` as "h3";
          return <Tag key={key}>{renderInline(block.text, key)}</Tag>;
        }
        if (block.kind === "list") {
          const items = block.items.map((item, i) => (
            <li key={`${key}i${i}`}>{renderInline(item, `${key}i${i}`)}</li>
          ));
          return block.ordered ? (
            <ol key={key}>{items}</ol>
          ) : (
            <ul key={key}>{items}</ul>
          );
        }
        if (block.kind === "quote")
          return (
            <blockquote key={key}>{renderInline(block.text, key)}</blockquote>
          );
        if (block.kind === "rule") return <hr key={key} />;
        return <p key={key}>{renderInline(block.text, key)}</p>;
      })}
    </div>
  );
}
