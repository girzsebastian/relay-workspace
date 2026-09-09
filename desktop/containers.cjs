const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const run = promisify(execFile);

// Docker prints one JSON object per line; a partial line is skipped rather than
// failing the whole listing.
function parseContainers(stdout) {
  const rows = [];
  for (const line of String(stdout).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const row = JSON.parse(trimmed);
      rows.push({
        id: row.ID || row.Id || "",
        name: row.Names || row.Name || "",
        image: row.Image || "",
        state: (row.State || "").toLowerCase(),
        status: row.Status || "",
        ports: row.Ports || "",
        createdAt: row.CreatedAt || "",
        labels: row.Labels || "",
      });
    } catch {
      // Not a container record.
    }
  }
  return rows;
}

// A container is attributed to a project when its compose working directory or
// its mounted source path is inside that project. Relay never guesses from the
// container name alone.
function attribute(containers, projects) {
  const roots = projects
    .map((project) => ({ id: project.id, path: project.path }))
    .filter((project) => project.path)
    .sort((a, b) => b.path.length - a.path.length);
  return containers.map((container) => {
    const labels = container.labels || "";
    const match = /com\.docker\.compose\.project\.working_dir=([^,]*)/.exec(
      labels,
    );
    const workingDir = match?.[1];
    const owner = workingDir
      ? roots.find(
          (root) =>
            workingDir === root.path || workingDir.startsWith(`${root.path}/`),
        )
      : undefined;
    return { ...container, projectId: owner?.id || null, workingDir };
  });
}

async function available() {
  try {
    await run("docker", ["version", "--format", "{{.Client.Version}}"], {
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

async function list(projects = []) {
  try {
    const { stdout } = await run(
      "docker",
      ["ps", "--all", "--no-trunc", "--format", "{{json .}}"],
      { timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
    );
    return {
      available: true,
      containers: attribute(parseContainers(stdout), projects),
    };
  } catch (error) {
    const message = String(error.stderr || error.message || "");
    return {
      available: false,
      containers: [],
      reason: /ENOENT|not found/i.test(message)
        ? "Docker is not installed or not on PATH."
        : message.trim().slice(0, 300) ||
          "Docker did not respond. Is the daemon running?",
    };
  }
}

async function logs(id, tail = 200) {
  const { stdout, stderr } = await run(
    "docker",
    [
      "logs",
      "--tail",
      String(Math.min(Math.max(Number(tail) || 200, 1), 2000)),
      id,
    ],
    { timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
  ).catch((error) => ({
    stdout: "",
    stderr: String(error.stderr || error.message),
  }));
  return [stdout, stderr].filter(Boolean).join("\n").slice(-200000);
}

// Stopping is explicit and never implied by opening this view.
async function stop(id) {
  await run("docker", ["stop", id], { timeout: 30000 });
  return true;
}

module.exports = { parseContainers, attribute, available, list, logs, stop };
