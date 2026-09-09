const { spawn } = require("node:child_process");

// Chat backed by an official CLI the user already installed and signed into.
// Relay does not convert one subscription into another provider's credits; it
// runs the tool the user chose, on this computer, with that tool's own login.
const cliProviders = {
  "claude-cli": { file: "claude", label: "Claude Code CLI" },
  "codex-cli": { file: "codex", label: "Codex CLI" },
  "opencode-cli": { file: "opencode", label: "OpenCode CLI" },
};
const isCliProvider = (provider) => Object.hasOwn(cliProviders, provider);
const cliExecutable = (provider) => cliProviders[provider]?.file || null;
const cliLabel = (provider) => cliProviders[provider]?.label || provider;

function transcript(messages) {
  return messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");
}

// The CLI is invoked once per turn with the whole conversation, exactly as the
// HTTP providers are. Relay's stored messages stay the single source of truth,
// so a chat cannot drift from a separate session history held inside the CLI.
function cliPrompt(messages) {
  if (messages.length <= 1) return messages[0]?.content ?? "";
  return [
    "Continue this conversation. Reply only with your next assistant message.",
    "",
    transcript(messages),
  ].join("\n");
}

// Claude Code may read the project and run git, and nothing else. Anything
// that would prompt is denied outright rather than left waiting, which is what
// made a reply say "blocked pending permission" instead of answering.
const CLAUDE_READ_ONLY = [
  "--tools",
  "Read,Glob,Grep,Bash",
  "--allowedTools",
  "Bash(git *) Read Glob Grep",
  "--permission-prompts",
  "none",
];

// Every command is non-interactive and cannot write: a read-only tool set for
// Claude Code, a read-only sandbox for Codex, and OpenCode's read-only `plan`
// agent. A chat reply must never edit the project.
function cliCommand(provider, { model, system, prompt, tools = "read-only" }) {
  const file = cliExecutable(provider);
  if (!file) throw new Error("Unsupported CLI provider.");
  if (provider === "claude-cli")
    return {
      file,
      args: [
        "-p",
        prompt,
        "--output-format",
        "json",
        ...(tools === "read-only" ? CLAUDE_READ_ONLY : ["--tools", ""]),
        ...(system ? ["--append-system-prompt", system] : []),
        ...(model ? ["--model", model] : []),
      ],
    };
  const combined = system ? `${system}\n\n${prompt}` : prompt;
  if (provider === "codex-cli")
    return {
      file,
      args: [
        "exec",
        "--json",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        ...(model ? ["-m", model] : []),
        combined,
      ],
    };
  return {
    file,
    args: [
      "run",
      "--format",
      "json",
      "--agent",
      "plan",
      ...(model ? ["-m", model] : []),
      combined,
    ],
  };
}

function jsonLines(stdout) {
  const events = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // A partial or decorated line is not an event; ignore it.
    }
  }
  return events;
}

// Claude Code prints one JSON object, but a warning line can precede it.
function claudeResult(stdout) {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    if (start === -1) throw new Error("The CLI returned no JSON result.");
    return JSON.parse(trimmed.slice(start));
  }
}

function parseCliOutput(provider, stdout) {
  if (provider === "claude-cli") {
    const body = claudeResult(stdout);
    if (body.is_error)
      throw new Error(
        String(body.result || "Claude Code reported an error.").slice(0, 350),
      );
    const usage = body.usage;
    return {
      text: typeof body.result === "string" ? body.result : "",
      usage: usage
        ? {
            input: usage.input_tokens || 0,
            output: usage.output_tokens || 0,
            cacheRead: usage.cache_read_input_tokens || 0,
            cacheWrite: usage.cache_creation_input_tokens || 0,
          }
        : null,
    };
  }
  const events = jsonLines(stdout);
  const last = (predicate) => [...events].reverse().find(predicate);
  if (provider === "codex-cli") {
    const usage = last((e) => e.type === "turn.completed" && e.usage)?.usage;
    return {
      text: events
        .filter(
          (e) =>
            e.type === "item.completed" && e.item?.type === "agent_message",
        )
        .map((e) => e.item.text || "")
        .join("\n")
        .trim(),
      usage: usage
        ? {
            input: usage.input_tokens || 0,
            output: usage.output_tokens || 0,
            cacheRead: usage.cached_input_tokens || 0,
            cacheWrite: usage.cache_write_input_tokens || 0,
          }
        : null,
    };
  }
  const tokens = last((e) => e.type === "step_finish" && e.part?.tokens)?.part
    ?.tokens;
  return {
    text: events
      .filter((e) => e.type === "text" && e.part?.text)
      .map((e) => e.part.text)
      .join("")
      .trim(),
    usage: tokens
      ? {
          input: tokens.input || 0,
          output: tokens.output || 0,
          cacheRead: tokens.cache?.read || 0,
          cacheWrite: tokens.cache?.write || 0,
        }
      : null,
  };
}

function runCli(
  { provider, model, system, prompt, cwd, signal, tools, timeoutMs = 300000 },
  spawner = spawn,
) {
  const { file, args } = cliCommand(provider, {
    model,
    system,
    prompt,
    tools,
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    let child;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      finish(
        new Error(
          `${cliLabel(provider)} did not respond within ${Math.round(
            timeoutMs / 1000,
          )}s.`,
        ),
      );
      child?.kill("SIGKILL");
    }, timeoutMs);
    const onAbort = () => {
      finish(new Error("Request cancelled."));
      child?.kill("SIGKILL");
    };
    try {
      child = spawner(file, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    } catch (error) {
      finish(new Error(`Could not start ${file}. ${error.message}`));
      return;
    }
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort);
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (err.length < 4000) err += chunk;
    });
    child.on("error", (error) =>
      finish(
        new Error(
          error.code === "ENOENT"
            ? `${file} is not installed or not on PATH. Install it, or pick another provider in Settings.`
            : `Could not run ${file}. ${error.message}`,
        ),
      ),
    );
    child.on("close", (code) => {
      if (settled) return;
      try {
        const parsed = parseCliOutput(provider, out);
        if (!parsed.text && code !== 0)
          throw new Error(
            err.trim().slice(0, 350) || `The CLI exited with code ${code}.`,
          );
        finish(null, parsed);
      } catch (error) {
        finish(new Error(`${cliLabel(provider)}: ${error.message}`));
      }
    });
  });
}

module.exports = {
  cliProviders,
  isCliProvider,
  cliExecutable,
  cliLabel,
  cliPrompt,
  cliCommand,
  parseCliOutput,
  runCli,
};
