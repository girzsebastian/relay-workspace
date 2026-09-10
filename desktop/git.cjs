const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const run = promisify(execFile);

// Every call passes arguments as an array and never a shell string: branch and
// file names come from the repository, not from Relay, and must not be parsed
// by a shell.
async function git(
  cwd,
  args,
  { maxBuffer = 8 * 1024 * 1024, output = false } = {},
) {
  try {
    const { stdout } = await run("git", args, { cwd, maxBuffer });
    return stdout;
  } catch (error) {
    // `diff --no-index` reports "they differ" as exit code 1 and still prints
    // the diff, so a caller that wants the output must be able to keep it.
    if (output && error.stdout) return error.stdout;
    const message = String(error.stderr || error.message || "")
      .trim()
      .slice(0, 400);
    throw new Error(message || "The git command failed.");
  }
}

async function isRepository(cwd) {
  try {
    return (
      (await git(cwd, ["rev-parse", "--is-inside-work-tree"])).trim() === "true"
    );
  } catch {
    return false;
  }
}

// porcelain=v2 with -z: NUL-separated records, and a rename carries its original
// path as a second NUL-separated field, so records cannot be split on newlines.
function parseStatus(stdout) {
  const result = {
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [],
  };
  const records = stdout.split("\0");
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (!record) continue;
    if (record.startsWith("# branch.head ")) {
      const name = record.slice(14);
      result.branch = name === "(detached)" ? null : name;
    } else if (record.startsWith("# branch.upstream ")) {
      result.upstream = record.slice(18);
    } else if (record.startsWith("# branch.ab ")) {
      const [ahead, behind] = record.slice(12).split(" ");
      result.ahead = Math.abs(Number(ahead) || 0);
      result.behind = Math.abs(Number(behind) || 0);
    } else if (record.startsWith("1 ")) {
      const parts = record.split(" ");
      result.files.push({
        path: parts.slice(8).join(" "),
        index: parts[1][0],
        worktree: parts[1][1],
      });
    } else if (record.startsWith("2 ")) {
      const parts = record.split(" ");
      // The original path follows as its own record.
      const from = records[i + 1];
      i += 1;
      result.files.push({
        path: parts.slice(9).join(" "),
        from: from || undefined,
        index: parts[1][0],
        worktree: parts[1][1],
      });
    } else if (record.startsWith("u ")) {
      const parts = record.split(" ");
      result.files.push({
        path: parts.slice(10).join(" "),
        index: "U",
        worktree: "U",
      });
    } else if (record.startsWith("? ")) {
      result.files.push({ path: record.slice(2), index: ".", worktree: "?" });
    }
  }
  return result;
}

function parseNumstat(stdout) {
  const counts = new Map();
  const fields = stdout.split("\0");
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    if (!field) continue;
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(field);
    if (!match) continue;
    // A rename emits an empty path and then two NUL-separated path fields.
    let file = match[3];
    if (!file) {
      i += 2;
      file = fields[i] || "";
    }
    if (!file) continue;
    counts.set(file, {
      added: match[1] === "-" ? null : Number(match[1]),
      removed: match[2] === "-" ? null : Number(match[2]),
    });
  }
  return counts;
}

// A binary file reports "-" rather than a line count; the UI must not print 0.
async function status(cwd) {
  if (!(await isRepository(cwd))) return { repository: false, files: [] };
  const parsed = parseStatus(
    await git(cwd, ["status", "--porcelain=v2", "--branch", "-z"]),
  );
  let counts = new Map();
  try {
    counts = parseNumstat(await git(cwd, ["diff", "--numstat", "-z", "HEAD"]));
  } catch {
    // A repository without commits has no HEAD to diff against.
  }
  const prefix = await git(cwd, ["rev-parse", "--show-prefix"])
    .then((out) => out.trim())
    .catch(() => "");
  const head = await headSha(cwd);
  return {
    repository: true,
    prefix,
    head,
    branch: parsed.branch,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    files: parsed.files.map((file) => {
      const untracked = file.worktree === "?";
      return {
        ...file,
        ...(counts.get(file.path) ||
          (untracked ? untrackedCounts(cwd, file.path) : {})),
        untracked,
        staged: file.index !== "." && file.index !== "?",
      };
    }),
  };
}

async function fileDiff(cwd, file) {
  const tracked = await git(cwd, ["ls-files", "--error-unmatch", "--", file])
    .then(() => true)
    .catch(() => false);
  // A file the agent just created is untracked, so `git diff` knows nothing
  // about it. Comparing it against nothing shows the whole file as added,
  // which is what it is.
  if (!tracked)
    return git(cwd, ["diff", "--no-index", "--", os.devNull, file], {
      output: true,
    }).catch(() => "");
  return git(cwd, ["diff", "HEAD", "--", file]);
}

// How many lines an untracked file adds. Counted here rather than asked of git
// once per file, because a fresh checkout can hold hundreds of them.
function untrackedCounts(cwd, file) {
  try {
    const buffer = fs.readFileSync(path.join(cwd, file));
    // The same test git uses to call a file binary: a NUL byte near the start.
    if (buffer.subarray(0, 8000).includes(0))
      return { added: null, removed: 0 };
    if (!buffer.length) return { added: 0, removed: 0 };
    let lines = 0;
    for (const byte of buffer) if (byte === 10) lines += 1;
    // A last line with no newline of its own still counts.
    if (buffer[buffer.length - 1] !== 10) lines += 1;
    return { added: lines, removed: 0 };
  } catch {
    return {};
  }
}

async function commit(cwd, message, paths) {
  if (!message.trim()) throw new Error("Enter a commit message first.");
  if (paths?.length) await git(cwd, ["add", "--", ...paths]);
  else await git(cwd, ["add", "--all"]);
  const staged = (await git(cwd, ["diff", "--cached", "--name-only"])).trim();
  if (!staged) throw new Error("Nothing is staged to commit.");
  await git(cwd, ["commit", "-m", message]);
  return status(cwd);
}

// Push is deliberately plain: no force, and no upstream is created silently.
// Setting an upstream is a separate, explicit choice made in the interface.
async function push(cwd, { setUpstream = false } = {}) {
  const current = await status(cwd);
  if (!current.branch)
    throw new Error("You are not on a branch. Check out a branch to push.");
  if (!current.upstream && !setUpstream)
    throw new Error(
      `${current.branch} has no upstream branch. Use "Publish branch" to create one.`,
    );
  await git(
    cwd,
    current.upstream
      ? ["push"]
      : ["push", "--set-upstream", "origin", current.branch],
    { maxBuffer: 2 * 1024 * 1024 },
  );
  return status(cwd);
}

// Discarding is destructive, so it only ever touches the paths it was given and
// never removes an untracked file, which git itself cannot restore.
async function discard(cwd, paths) {
  if (!paths?.length) throw new Error("Select the files to discard first.");
  const current = await status(cwd);
  const untracked = current.files
    .filter((file) => file.untracked && paths.includes(file.path))
    .map((file) => file.path);
  const tracked = paths.filter((path) => !untracked.includes(path));
  if (tracked.length) await git(cwd, ["checkout", "HEAD", "--", ...tracked]);
  return { ...(await status(cwd)), skippedUntracked: untracked };
}

async function log(cwd, limit = 30) {
  if (!(await isRepository(cwd))) return [];
  const stdout = await git(cwd, [
    "log",
    `--max-count=${Math.min(Math.max(Number(limit) || 30, 1), 200)}`,
    "--pretty=format:%H%x00%an%x00%at%x00%s%x00",
  ]).catch(() => "");
  const fields = stdout.split("\0");
  const commits = [];
  for (let i = 0; i + 3 < fields.length; i += 4) {
    if (!fields[i].trim()) continue;
    commits.push({
      sha: fields[i].trim(),
      author: fields[i + 1],
      at: Number(fields[i + 2]) * 1000,
      subject: fields[i + 3],
    });
  }
  return commits;
}

async function headSha(cwd) {
  return git(cwd, ["rev-parse", "HEAD"])
    .then((out) => out.trim())
    .catch(() => null);
}

const SKIP_SCAN = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  "vendor",
  ".venv",
  "__pycache__",
  "target",
]);

// A workspace folder is rarely a single repository. A product folder often holds
// its frontend, its backend and a plugin side by side, and the folder itself is
// not a checkout at all.
function discoverRepositories(root, { maxDepth = 3, limit = 40 } = {}) {
  const found = [];
  const walk = (dir, relative, depth) => {
    if (found.length >= limit) return;
    if (fs.existsSync(path.join(dir, ".git")))
      found.push({
        path: dir,
        relative,
        name: relative || path.basename(dir),
      });
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || SKIP_SCAN.has(entry.name)) continue;
      walk(
        path.join(dir, entry.name),
        relative ? `${relative}/${entry.name}` : entry.name,
        depth + 1,
      );
    }
  };
  walk(root, "", 0);
  return found;
}

// A repository is addressed by its path relative to the workspace, so a crafted
// value cannot reach outside the folder the user opened.
function resolveRepository(workspace, relative) {
  const base = path.resolve(workspace);
  const target = path.resolve(base, relative || ".");
  if (target !== base && !target.startsWith(base + path.sep))
    throw new Error("That repository is outside this workspace.");
  return target;
}

async function statuses(workspace) {
  const repositories = discoverRepositories(workspace);
  return Promise.all(
    repositories.map(async (repository) => {
      try {
        return { ...repository, ...(await status(repository.path)) };
      } catch (error) {
        return {
          ...repository,
          repository: true,
          files: [],
          error: String(error.message).slice(0, 300),
        };
      }
    }),
  );
}

// What a workspace looked like when an agent started: the commit each
// repository was on, and the files that were already dirty. Anything reported
// later as changed is then genuinely the run and not the user pre-existing work.
async function snapshot(workspace) {
  const repositories = await statuses(workspace);
  return repositories.map((repo) => ({
    relative: repo.relative,
    head: repo.head || null,
    dirty: repo.files.map((file) => file.path),
  }));
}

async function changesSince(workspace, taken) {
  const before = new Map((taken || []).map((repo) => [repo.relative, repo]));
  const now = await statuses(workspace);
  return now
    .map((repo) => {
      const prior = before.get(repo.relative);
      const priorDirty = new Set(prior?.dirty || []);
      return {
        relative: repo.relative,
        name: repo.name,
        // A file the user had already modified is not this run own doing.
        files: repo.files.filter((file) => !priorDirty.has(file.path)),
        committed: Boolean(
          prior?.head && repo.head && prior.head !== repo.head,
        ),
      };
    })
    .filter((repo) => repo.files.length || repo.committed);
}

const { COMMANDS, buildArgs, menu } = require("./git-commands.cjs");
const { hunkPatch, parseDiff, sideBySide, writePatch } = require("./diff.cjs");

// One hunk, shown as paired rows rather than a wall of +/- lines.
async function fileHunks(cwd, file) {
  const text = await fileDiff(cwd, file);
  const { hunks } = parseDiff(text);
  return {
    file,
    hunks: hunks.map((hunk, index) => ({
      index,
      header: hunk.header,
      oldStart: hunk.oldStart,
      newStart: hunk.newStart,
      rows: sideBySide(hunk),
    })),
  };
}

// Which lines of the file as it stands now were added, and where lines were
// removed. The editor needs this in its own coordinates, so it is derived from
// the hunk headers rather than from the diff text.
async function lineChanges(cwd, file) {
  const { hunks } = parseDiff(await fileDiff(cwd, file));
  const added = [];
  const removed = [];
  for (const hunk of hunks) {
    let line = hunk.newStart;
    let pending = 0;
    // A deletion has no line of its own, so it is recorded against whichever
    // line closed over it: the replacement that follows it, or the next line
    // of context.
    const flush = () => {
      if (!pending) return;
      removed.push({ line, count: pending });
      pending = 0;
    };
    for (const row of hunk.lines) {
      if (row.startsWith("+")) {
        flush();
        added.push(line);
        line += 1;
      } else if (row.startsWith("-")) {
        pending += 1;
      } else if (!row.startsWith("\\")) {
        flush();
        line += 1;
      }
    }
    flush();
  }
  return { added, removed };
}

// The editor knows a path relative to the workspace; which repository it
// belongs to is whichever discovered repository holds it, deepest first so a
// nested checkout wins over its parent.
async function fileLineChanges(workspace, relative) {
  const target = path.resolve(workspace, relative);
  const repositories = discoverRepositories(workspace).sort(
    (a, b) => b.relative.length - a.relative.length,
  );
  for (const repository of repositories) {
    const root = repository.path;
    if (target === root || target.startsWith(root + path.sep))
      return lineChanges(root, path.relative(root, target));
  }
  return { added: [], removed: [] };
}

// Undo for a single hunk: git applies the reverse of exactly that range, so the
// rest of the file — including other edits — is left alone.
async function revertHunk(cwd, file, index) {
  const text = await fileDiff(cwd, file);
  const patch = writePatch(hunkPatch(text, index));
  try {
    await git(cwd, ["apply", "--reverse", "--recount", patch]);
  } finally {
    fs.rmSync(path.dirname(patch), { recursive: true, force: true });
  }
  return fileHunks(cwd, file);
}

// One entry point for the whole source-control menu. Sync and push keep their
// own helpers because they refuse rather than invent an upstream.
async function runCommand(cwd, id, input) {
  if (id === "sync") return { status: await sync(cwd) };
  if (id === "push") return { status: await push(cwd) };
  const current = await status(cwd);
  const args = buildArgs(id, input, { branch: current.branch });
  const stdout = await git(cwd, args, { maxBuffer: 8 * 1024 * 1024 });
  return {
    status: await status(cwd),
    ...(COMMANDS[id].output ? { output: stdout.trimEnd() } : {}),
  };
}

async function fetch(cwd) {
  await git(cwd, ["fetch", "--prune"], { maxBuffer: 2 * 1024 * 1024 });
  return status(cwd);
}

async function pull(cwd) {
  const current = await status(cwd);
  if (!current.upstream)
    throw new Error(
      `${current.branch || "This branch"} has no upstream to pull from.`,
    );
  // --ff-only refuses rather than creating a merge commit the user did not ask
  // for; a divergent branch is a decision, not something to resolve silently.
  await git(cwd, ["pull", "--ff-only"], { maxBuffer: 2 * 1024 * 1024 });
  return status(cwd);
}

async function sync(cwd) {
  await pull(cwd);
  return push(cwd);
}

async function branches(cwd) {
  const stdout = await git(cwd, [
    "for-each-ref",
    "--sort=-committerdate",
    "--count=200",
    "--format=%(refname:short)%00%(upstream:short)%00%(HEAD)",
    "refs/heads",
  ]).catch(() => "");
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, upstream, head] = line.split("\0");
      return { name, upstream: upstream || null, current: head === "*" };
    });
}

async function checkout(cwd, branch) {
  if (!branch?.trim()) throw new Error("Choose a branch to check out.");
  await git(cwd, ["checkout", branch]);
  return status(cwd);
}

async function stash(cwd, { pop = false } = {}) {
  if (pop) await git(cwd, ["stash", "pop"]);
  else await git(cwd, ["stash", "push", "--include-untracked"]);
  return status(cwd);
}

module.exports = {
  untrackedCounts,
  lineChanges,
  fileLineChanges,
  fileHunks,
  revertHunk,
  menu,
  runCommand,
  snapshot,
  changesSince,
  discoverRepositories,
  resolveRepository,
  statuses,
  fetch,
  pull,
  sync,
  branches,
  checkout,
  stash,
  isRepository,
  parseStatus,
  parseNumstat,
  status,
  fileDiff,
  commit,
  push,
  discard,
  log,
  headSha,
};
