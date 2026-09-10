const { execFile, execFileSync } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs");
const path = require("node:path");

const run = promisify(execFile);
const { discoverRepositories } = require("./git.cjs");
const MAX_RESULTS = 2000;
const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  "vendor",
  ".venv",
  "__pycache__",
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMatcher({ query, regex, caseSensitive, wholeWord }) {
  const source = regex ? query : escapeRegExp(query);
  const bounded = wholeWord ? `\\b(?:${source})\\b` : source;
  // An invalid user-typed pattern is a message, not a crash.
  try {
    return new RegExp(bounded, caseSensitive ? "g" : "gi");
  } catch (error) {
    throw new Error(`That pattern is not valid: ${error.message}`);
  }
}

// A glob list like "app/**,*.ts" becomes git pathspecs, so the fast path can
// honour include and exclude without a second filtering pass.
function pathspecs(include, exclude) {
  const specs = [];
  for (const pattern of splitGlobs(include))
    specs.push(`:(glob)${pattern.includes("/") ? pattern : `**/${pattern}`}`);
  for (const pattern of splitGlobs(exclude))
    specs.push(
      `:(exclude,glob)${pattern.includes("/") ? pattern : `**/${pattern}`}`,
    );
  return specs;
}

function splitGlobs(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function globToRegExp(pattern) {
  const source = pattern
    .split("**")
    .map((part) =>
      part
        .split("*")
        .map((piece) => escapeRegExp(piece))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${source}$`);
}

function matchesGlobs(file, include, exclude) {
  const includes = splitGlobs(include).map(globToRegExp);
  const excludes = splitGlobs(exclude).map(globToRegExp);
  const candidates = [file, path.basename(file)];
  if (
    includes.length &&
    !includes.some((r) => candidates.some((c) => r.test(c)))
  )
    return false;
  return !excludes.some((r) => candidates.some((c) => r.test(c)));
}

async function trackedFiles(cwd, include, exclude) {
  const { stdout } = await run(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...pathspecs(include, exclude),
    ],
    { cwd, maxBuffer: 32 * 1024 * 1024 },
  );
  return stdout.split("\0").filter(Boolean);
}

// Outside a repository there is no ignore file to trust, so the walk skips the
// directories that would otherwise dominate the results.
function walk(root, include, exclude, limit = 20000, skipRelative = new Set()) {
  const found = [];
  const stack = ["."];
  while (stack.length && found.length < limit) {
    const relative = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, relative), {
        withFileTypes: true,
      });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const next = relative === "." ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name) && !skipRelative.has(next))
          stack.push(next);
      } else if (entry.isFile() && matchesGlobs(next, include, exclude)) {
        found.push(next);
      }
    }
  }
  return found;
}

// A workspace often holds several checkouts plus loose files. Each repository
// contributes the files git knows about, so its own ignore rules apply, and the
// remaining folders are walked directly.
function collectFiles(workspace, include, exclude) {
  const repos = discoverRepositories(workspace);
  const owned = new Set(repos.map((repo) => repo.relative).filter(Boolean));
  const entries = [];
  for (const repo of repos) {
    let listed = [];
    try {
      listed = trackedFilesSync(repo.path, include, exclude);
    } catch {
      listed = walk(repo.path, include, exclude).map((file) => file);
    }
    for (const file of listed)
      entries.push({
        repo: repo.relative ? repo.name : "",
        path: repo.relative ? `${repo.relative}/${file}` : file,
        absolute: path.join(repo.path, file),
      });
  }
  // Anything outside a repository still belongs to the workspace.
  if (!repos.some((repo) => !repo.relative))
    for (const file of walk(workspace, include, exclude, 20000, owned))
      entries.push({
        repo: "",
        path: file,
        absolute: path.join(workspace, file),
      });
  return entries;
}

function trackedFilesSync(cwd, include, exclude) {
  const stdout = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...pathspecs(include, exclude),
    ],
    { cwd, maxBuffer: 32 * 1024 * 1024, encoding: "buffer" },
  ).toString("utf8");
  return stdout.split("\0").filter(Boolean);
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}

async function search(cwd, options) {
  const query = String(options.query || "");
  if (!query.trim()) return { results: [], files: 0, truncated: false };
  const matcher = buildMatcher({
    query,
    regex: !!options.regex,
    caseSensitive: !!options.caseSensitive,
    wholeWord: !!options.wholeWord,
  });
  const entries = collectFiles(cwd, options.include, options.exclude);
  const results = [];
  let scanned = 0;
  let truncated = false;
  for (const entry of entries) {
    if (results.length >= MAX_RESULTS) {
      truncated = true;
      break;
    }
    let buffer;
    try {
      const stat = fs.statSync(entry.absolute);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
      buffer = fs.readFileSync(entry.absolute);
    } catch {
      continue;
    }
    if (looksBinary(buffer)) continue;
    scanned += 1;
    const lines = buffer.toString("utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      matcher.lastIndex = 0;
      const line = lines[index];
      // A pathological line would otherwise be sent whole to the interface.
      if (line.length > 4000) continue;
      let match;
      while ((match = matcher.exec(line))) {
        results.push({
          file: entry.path,
          repo: entry.repo,
          line: index + 1,
          column: match.index + 1,
          length: match[0].length,
          text: line,
        });
        if (match[0].length === 0) break;
        if (results.length >= MAX_RESULTS) break;
      }
      if (results.length >= MAX_RESULTS) break;
    }
  }
  return { results, files: scanned, truncated };
}

// Replacing is destructive, so it only touches files that actually match and
// reports exactly what it rewrote.
async function replaceInFiles(cwd, options) {
  const replacement = String(options.replacement ?? "");
  const matcher = buildMatcher({
    query: String(options.query || ""),
    regex: !!options.regex,
    caseSensitive: !!options.caseSensitive,
    wholeWord: !!options.wholeWord,
  });
  if (!String(options.query || "").trim())
    throw new Error("Enter something to replace first.");
  const only = options.files?.length ? new Set(options.files) : null;
  const entries = collectFiles(cwd, options.include, options.exclude).filter(
    (entry) => !only || only.has(entry.path),
  );
  const changed = [];
  let replaced = 0;
  for (const entry of entries) {
    let buffer;
    try {
      const stat = fs.statSync(entry.absolute);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
      buffer = fs.readFileSync(entry.absolute);
    } catch {
      continue;
    }
    if (looksBinary(buffer)) continue;
    const before = buffer.toString("utf8");
    matcher.lastIndex = 0;
    let count = 0;
    const after = before.replace(matcher, (...args) => {
      count += 1;
      return options.regex
        ? replacement.replace(
            /\$(\d)/g,
            (_, digit) => args[Number(digit)] ?? "",
          )
        : replacement;
    });
    if (!count || after === before) continue;
    fs.writeFileSync(entry.absolute, after);
    changed.push({ file: entry.path, repo: entry.repo, count });
    replaced += count;
  }
  return { files: changed, replaced };
}

module.exports = {
  search,
  replaceInFiles,
  collectFiles,
  buildMatcher,
  globToRegExp,
  matchesGlobs,
  splitGlobs,
  pathspecs,
};
