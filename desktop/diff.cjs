const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// A unified diff split into its header and its hunks, so a single hunk can be
// shown on its own and reverted without touching the rest of the file.
function parseDiff(text) {
  const lines = String(text || "").split("\n");
  const header = [];
  const hunks = [];
  let current = null;
  for (const line of lines) {
    const start = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (start) {
      current = {
        header: line,
        oldStart: Number(start[1]),
        oldCount: start[2] === undefined ? 1 : Number(start[2]),
        newStart: Number(start[3]),
        newCount: start[4] === undefined ? 1 : Number(start[4]),
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current) {
      header.push(line);
      continue;
    }
    // A context line for an empty source line is " ", never "", so an empty
    // string is the trailing newline of the diff rather than content. Keeping
    // it would append a blank line and git would refuse the patch.
    if (line === "") continue;
    // "\ No newline at end of file" belongs to the hunk it follows.
    if (line.startsWith("\\") || /^[ +-]/.test(line)) current.lines.push(line);
    else break;
  }
  return { header, hunks };
}

// Side by side: each hunk becomes rows that pair a removed line with the added
// line that replaced it, so an edit reads as one row rather than two.
function sideBySide(hunk) {
  const rows = [];
  const pending = [];
  const flush = () => {
    let removed = pending.filter((line) => line.startsWith("-"));
    let added = pending.filter((line) => line.startsWith("+"));
    const count = Math.max(removed.length, added.length);
    for (let i = 0; i < count; i += 1)
      rows.push({
        kind: removed[i] && added[i] ? "change" : removed[i] ? "remove" : "add",
        left: removed[i] === undefined ? null : removed[i].slice(1),
        right: added[i] === undefined ? null : added[i].slice(1),
      });
    pending.length = 0;
  };
  for (const line of hunk.lines) {
    if (line.startsWith("+") || line.startsWith("-")) {
      pending.push(line);
      continue;
    }
    flush();
    if (line.startsWith("\\")) continue;
    rows.push({ kind: "context", left: line.slice(1), right: line.slice(1) });
  }
  flush();
  return rows;
}

// The patch that reverses exactly one hunk. Line counts come from the hunk
// itself, so a stale header cannot make git apply the wrong range.
function hunkPatch(diffText, index) {
  const { header, hunks } = parseDiff(diffText);
  const hunk = hunks[index];
  if (!hunk) throw new Error("That change is no longer part of the file.");
  const fileHeader = header.filter(
    (line) =>
      line.startsWith("diff --git") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("index ") ||
      line.startsWith("new file mode") ||
      line.startsWith("deleted file mode"),
  );
  return [...fileHeader, hunk.header, ...hunk.lines, ""].join("\n");
}

function writePatch(patch) {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "relay-patch-")),
    "hunk.patch",
  );
  fs.writeFileSync(file, patch);
  return file;
}

module.exports = { parseDiff, sideBySide, hunkPatch, writePatch };
