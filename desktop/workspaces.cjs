const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { discoverRepositories } = require("./git.cjs");
const { atomicWrite } = require("./store.cjs");

const omitted = new Set([
  ".git",
  "node_modules",
  "vendor",
  ".venv",
  "dist",
  "build",
  "release",
  ".next",
]);
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function inside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
function git(root, args, options = {}) {
  return execFileSync("git", ["-c", "core.fsmonitor=false", ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });
}

// Every owner has a persistent checkout. Never reset/reuse another owner's
// directory and never replay a snapshot over an existing agent's work.
class Workspaces {
  constructor(store) {
    this.store = store;
    this.root = path.join(store.directory, "agent-workspaces");
  }
  ensure(ownerId, projectId) {
    if (!/^[a-f0-9-]{36}$/.test(ownerId))
      throw new Error("Invalid workspace owner.");
    const project = this.store.project(projectId);
    const source = fs.realpathSync(project.path);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const home = path.join(this.root, ownerId);
    const meta = path.join(home, "workspace.json");
    if (fs.existsSync(home)) {
      if (!fs.existsSync(meta))
        throw new Error(
          `Workspace preparation was interrupted. Preserved at ${home}.`,
        );
      const existing = JSON.parse(fs.readFileSync(meta, "utf8"));
      if (
        existing.projectId !== projectId ||
        existing.source !== source ||
        existing.status !== "ready"
      )
        throw new Error(
          "The isolated workspace no longer matches this project.",
        );
      if (!inside(fs.realpathSync(this.root), fs.realpathSync(existing.path)))
        throw new Error("Isolated workspace escaped its storage directory.");
      return existing;
    }
    fs.mkdirSync(home, { mode: 0o700 });
    const cwd = path.join(home, "files");
    const hooks = path.join(home, "empty-hooks");
    fs.mkdirSync(hooks);
    const repositories = discoverRepositories(source);
    const data = {
      ownerId,
      projectId,
      source,
      path: cwd,
      createdAt: Date.now(),
      status: "preparing",
      repositories: [],
      baseline: {},
    };
    const save = () => atomicWrite(meta, JSON.stringify(data));
    save();
    let total = 0,
      count = 0;
    const copyFile = (relative) => {
      if (relative.split(/[\\/]/).some((part) => omitted.has(part))) return;
      const from = path.resolve(source, relative),
        to = path.resolve(cwd, relative);
      if (!inside(source, from) || !inside(cwd, to))
        throw new Error("Invalid snapshot path.");
      if (!fs.existsSync(from)) return;
      if (!inside(source, fs.realpathSync(from)))
        throw new Error(`Snapshot link escapes the workspace: ${relative}`);
      const info = fs.lstatSync(from);
      if (info.isSymbolicLink())
        throw new Error(
          `Resolve the symlink before isolating this workspace: ${relative}`,
        );
      if (!info.isFile()) return;
      total += info.size;
      count += 1;
      if (
        info.size > 32 * 1024 * 1024 ||
        total > 512 * 1024 * 1024 ||
        count > 50000
      )
        throw new Error(
          "Workspace snapshot exceeds 512 MB, 50,000 files, or 32 MB per file. Ignore generated files before starting.",
        );
      const bytes = fs.readFileSync(from);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      if (fs.existsSync(to) && fs.lstatSync(to).isSymbolicLink())
        fs.unlinkSync(to);
      fs.writeFileSync(to, bytes, { mode: info.mode & 0o777 });
      data.baseline[relative.split(path.sep).join("/")] = hash(bytes);
    };
    try {
      for (const repo of repositories) {
        const head = git(repo.path, ["rev-parse", "--verify", "HEAD"]).trim();
        const target = path.join(cwd, repo.relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const branch = `relay/${ownerId}/${data.repositories.length + 1}`;
        git(repo.path, [
          "-c",
          `core.hooksPath=${hooks}`,
          "worktree",
          "add",
          "-b",
          branch,
          target,
          head,
        ]);
        data.repositories.push({
          relative: repo.relative,
          source: repo.path,
          path: target,
          head,
          branch,
        });
        // Snapshot working files, including staged/unstaged changes, while
        // leaving the user's index and branch untouched.
        const tracked = git(repo.path, ["ls-files", "-z"])
          .split("\0")
          .filter(Boolean);
        const untracked = git(repo.path, [
          "ls-files",
          "--others",
          "--exclude-standard",
          "-z",
        ])
          .split("\0")
          .filter(Boolean);
        for (const file of new Set([...tracked, ...untracked])) {
          const relative = path.join(repo.relative, file);
          const from = path.join(source, relative),
            to = path.join(cwd, relative);
          if (
            !fs.existsSync(from) &&
            fs.existsSync(to) &&
            fs.lstatSync(to).isFile()
          )
            fs.unlinkSync(to);
          else copyFile(relative);
        }
      }
      fs.mkdirSync(cwd, { recursive: true });
      const loose = (dir, relative = "") => {
        if (repositories.some((r) => r.relative === relative)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (omitted.has(entry.name) || /^\.env(?:\.|$)/.test(entry.name))
            continue;
          const rel = path.join(relative, entry.name);
          if (entry.isDirectory()) loose(path.join(dir, entry.name), rel);
          else copyFile(rel);
        }
      };
      loose(source);
      data.status = "ready";
      save();
      return data;
    } catch (error) {
      data.status = "failed";
      data.error = String(error.stderr || error.message).slice(0, 500);
      save();
      throw new Error(
        `Could not prepare isolated workspace: ${data.error}. Partial files are preserved at ${home}.`,
      );
    }
  }
  get(ownerId, projectId) {
    return this.ensure(ownerId, projectId);
  }
}
module.exports = { Workspaces, inside, git };
