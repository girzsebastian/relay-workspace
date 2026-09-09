const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Claude Code and Codex each persist a transcript per session, in different
// layouts, and neither exposes a lookup command. Relay searches for the file
// rather than reconstructing a directory-name encoding it does not own: passing
// --resume for a session the CLI never wrote makes the CLI fail inside the PTY
// with "No conversation found with session ID", which reads as a Relay bug.
function claudeSessionExists(id, home) {
  const root = path.join(home, ".claude", "projects");
  let entries;
  try {
    entries = fs.readdirSync(root);
  } catch {
    return false;
  }
  return entries.some((dir) =>
    fs.existsSync(path.join(root, dir, `${id}.jsonl`)),
  );
}

// ~/.codex/sessions/<year>/<month>/<day>/rollout-<timestamp>-<id>.jsonl
function codexSessionExists(id, home) {
  const stack = [path.join(home, ".codex", "sessions")];
  const suffix = `${id}.jsonl`;
  while (stack.length) {
    let entries;
    const dir = stack.pop();
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(path.join(dir, entry.name));
      else if (entry.name.endsWith(suffix)) return true;
    }
  }
  return false;
}

// OpenCode keeps sessions in a database Relay does not read, so resumability
// cannot be checked. The attempt is allowed and the CLI's own error is shown.
function providerSessionExists(kind, id, home = os.homedir()) {
  if (!id) return false;
  if (kind === "claude") return claudeSessionExists(id, home);
  if (kind === "codex") return codexSessionExists(id, home);
  return true;
}

// Terminal output is stored with its control sequences; a prompt needs the text.
function readableTail(text, limit = 2000) {
  const stripped = String(text || "")
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?<>=!]*[ -\/]*[@-~]/g, "")
    .replace(/\u001b[()#][0-9A-Za-z]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  // A coding CLI redraws its whole screen constantly, so the raw log is mostly
  // spinner frames and repeats. Keeping the distinct content lines is the only
  // way the tail reads as history rather than noise.
  const lines = [];
  for (const raw of stripped.split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    // Spinner frames, progress glyphs and box drawing carry no information.
    if (
      /^[\u2500-\u257f\u2580-\u259f\u25a0-\u25ff\u2190-\u21ff*+.\u2026\u00b7\-_=|\/\\ ]+$/.test(
        line,
      )
    )
      continue;
    if (
      /^[\u2728\u2733\u2734\u2735\u2736\u2737\u2738\u2739\u273a-\u273f\u2748\u274b]/.test(
        line,
      )
    )
      continue;
    if (lines[lines.length - 1] === line) continue;
    lines.push(line);
  }
  const out = lines.join("\n");
  return out.length > limit ? out.slice(-limit).replace(/^[^\n]*\n/, "") : out;
}

// What a restarted CLI is told when the original conversation is unrecoverable.
// It must never imply the earlier session is still loaded.
function recoveredContext({ agent, task, log }) {
  return [
    "This session continues earlier work in this project. The previous CLI conversation could not be resumed, so its own history is gone. What follows is what Relay recorded.",
    agent?.name ? `Agent name: ${agent.name}` : "",
    agent?.instructions ? `Agent instructions:\n${agent.instructions}` : "",
    agent?.memory ? `Saved agent memory:\n${agent.memory}` : "",
    task ? `Task in progress:\n${task}` : "",
    log ? `Tail of the previous terminal output:\n${log}` : "",
    "Treat the transcript above as a record, not as the current state. Re-read any file you depend on; earlier edits may or may not have been saved.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

module.exports = {
  claudeSessionExists,
  codexSessionExists,
  providerSessionExists,
  readableTail,
  recoveredContext,
};
