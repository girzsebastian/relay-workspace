const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { atomicWrite } = require("./store.cjs");
const ignored = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "release",
  ".next",
  ".venv",
  "vendor",
]);
function resolveFile(root, relative = ".") {
  if (
    typeof relative !== "string" ||
    relative.includes("\0") ||
    path.isAbsolute(relative)
  )
    throw new Error("Use a relative project path.");
  const realRoot = fs.realpathSync(root);
  const candidate = fs.realpathSync(path.resolve(realRoot, relative));
  const rel = path.relative(realRoot, candidate);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))
    throw new Error("File is outside the project.");
  return candidate;
}
function listFiles(root, relative = ".") {
  const dir = resolveFile(root, relative);
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => !ignored.has(e.name) && !e.isSymbolicLink())
    .sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 500)
    .map((e) => ({
      name: e.name,
      path: path
        .relative(fs.realpathSync(root), path.join(dir, e.name))
        .split(path.sep)
        .join("/"),
      directory: e.isDirectory(),
    }));
}
const digest = (content) =>
  crypto.createHash("sha256").update(content).digest("hex");
function readFile(root, relative) {
  const file = resolveFile(root, relative);
  if (!fs.statSync(file).isFile() || fs.statSync(file).size > 2 * 1024 * 1024)
    throw new Error("Open a text file smaller than 2 MB.");
  const content = fs.readFileSync(file, "utf8");
  if (content.includes("\0")) throw new Error("Binary files cannot be edited.");
  return { path: relative, content, hash: digest(content) };
}
function writeFile(root, relative, content, expectedHash) {
  const current = readFile(root, relative);
  if (current.hash !== expectedHash)
    throw new Error(
      "This file changed on disk. Reopen it before saving to avoid overwriting another edit.",
    );
  const file = resolveFile(root, relative);
  const mode = fs.statSync(file).mode & 0o777;
  atomicWrite(file, content);
  fs.chmodSync(file, mode);
  return { path: relative, content, hash: digest(content) };
}
function skills(root) {
  const result = [];
  for (const base of [".agents/skills", ".claude/skills"]) {
    try {
      for (const entry of listFiles(root, base))
        if (entry.directory) {
          try {
            const relative = path.posix.join(entry.path, "SKILL.md");
            const f = readFile(root, relative);
            result.push({
              name: entry.name,
              path: relative,
              content: f.content,
            });
          } catch {}
        }
    } catch {}
  }
  return result;
}
module.exports = { resolveFile, listFiles, readFile, writeFile, skills };
