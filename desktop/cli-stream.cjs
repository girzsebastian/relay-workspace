const { spawn } = require("node:child_process");

// Cursor's chat shows what the agent did, not only what it concluded. These are
// the three ways Claude Code can be asked to behave, mapped to the modes a
// person actually picks.
const MODES = {
  agent: {
    label: "Agent",
    description:
      "Reads, runs commands, and edits files. Changes land in the workspace and can be reviewed or undone.",
    claude: ["--permission-mode", "acceptEdits"],
    writes: true,
  },
  plan: {
    label: "Plan",
    description:
      "Reads and investigates, then proposes a plan. Nothing is edited.",
    claude: [
      "--permission-mode",
      "plan",
      "--tools",
      "Read,Glob,Grep,Bash",
      "--allowedTools",
      "Bash(git *) Read Glob Grep",
      "--permission-prompts",
      "none",
    ],
    writes: false,
  },
  ask: {
    label: "Ask",
    description:
      "Answers from the conversation alone. No tools, nothing read or run.",
    claude: ["--tools", ""],
    writes: false,
  },
};

// How much a run may do without being asked. Claude Code has no way to ask
// Relay for permission mid-run, so a command that is not allowed is denied
// outright; leaving it to prompt would hang the run with nobody to answer.
const RUN_MODES = {
  allowlist: {
    label: "Allowlist",
    description:
      "Only the commands on your list run. Anything else is refused and named, so you can add it.",
  },
  "auto-review": {
    label: "Auto-review",
    description:
      "Your allowlist runs, and file edits are applied for you to review afterwards.",
  },
  everything: {
    label: "Run everything",
    description:
      "No restrictions. The agent runs any command it decides to run, without asking.",
  },
};

// A read-only starting point: enough to answer questions about a repository
// without being able to change it.

// Relay lends its own terminals through an MCP server. Reading and listing
// are always safe; starting a process is not, so it is granted only in the
// run modes that already accept the agent acting on its own.
const RELAY_READ_TOOLS = [
  "mcp__relay__read_terminal",
  "mcp__relay__list_terminals",
];
const RELAY_RUN_TOOLS = [
  "mcp__relay__start_terminal",
  "mcp__relay__stop_terminal",
];

const DEFAULT_ALLOWLIST = [
  "Read",
  "Glob",
  "Grep",
  // The prefix form matters: "Bash(git status:*)" would not match
  // "git -C some/repo status", which is exactly how a multi-repo workspace is
  // inspected. This allows any git invocation, including ones that write, so a
  // stricter list is a reasonable thing to set.
  "Bash(git *)",
  "Bash(ls *)",
  "Bash(cat *)",
  "Bash(wc *)",
  "Bash(head *)",
  "Bash(tail *)",
  "Bash(find *)",
  "Bash(rg *)",
];

function runModeList() {
  return Object.entries(RUN_MODES).map(([id, mode]) => ({
    id,
    label: mode.label,
    description: mode.description,
  }));
}

function permissionArgs(mode, runMode, allowlist, hasBridge) {
  if (mode === "ask") return ["--tools", ""];
  if (runMode === "everything")
    return ["--permission-mode", "bypassPermissions"];
  const chosen = allowlist?.length ? allowlist : DEFAULT_ALLOWLIST;
  const allowed = [
    ...chosen,
    ...RELAY_READ_TOOLS,
    ...(runMode === "allowlist" ? [] : RELAY_RUN_TOOLS),
  ].join(" ");
  return [
    "--permission-mode",
    mode === "plan"
      ? "plan"
      : runMode === "auto-review"
        ? "acceptEdits"
        : "manual",
    "--allowedTools",
    allowed,
    "--permission-prompts",
    // With Relay listening, an action outside the allowlist becomes a card
    // the person answers; without it there is nobody to ask, so it is denied
    // rather than left hanging.
    hasBridge ? "host" : "none",
    ...(hasBridge
      ? ["--permission-prompt-tool", "mcp__relay__approval_request"]
      : []),
  ];
}

function modeList() {
  return Object.entries(MODES).map(([id, mode]) => ({
    id,
    label: mode.label,
    description: mode.description,
    writes: mode.writes,
  }));
}

// The tools exist, but nothing steers a model towards them: left alone it
// reaches for Bash, which cannot hold a process open and is not on the
// allowlist for anything that starts one. So it is told, plainly.
const TERMINAL_GUIDANCE = [
  "Relay lends you its terminals. Anything long-running — a dev server, a watcher, a build, a test runner that stays open — must be started with the start_terminal tool, never with Bash. Bash cannot hold a process open, and commands that start one are refused.",
  'After start_terminal, call read_terminal with a pattern that proves the thing is up, for example "Local:|ready in|listening|error|EADDRINUSE", and report what it says. The terminal stays running for the user after you reply, and they can see it.',
  "Use Bash only for short checks that finish on their own.",
].join("\n");

function streamCommand(
  provider,
  {
    model,
    system: systemPrompt,
    prompt,
    mode = "agent",
    runMode = "auto-review",
    allowlist,
    mcp,
  },
) {
  const chosen = MODES[mode] || MODES.agent;
  // A run that can reach Relay is told how, in the system prompt it already has.
  const system =
    mcp && systemPrompt
      ? `${systemPrompt}\n\n${TERMINAL_GUIDANCE}`
      : mcp
        ? TERMINAL_GUIDANCE
        : systemPrompt;
  if (provider === "claude-cli")
    return {
      file: "claude",
      args: [
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        // stream-json refuses to run under --print without it.
        "--verbose",
        ...permissionArgs(mode, runMode, allowlist, !!mcp),
        ...(mcp && mode !== "ask" ? ["--mcp-config", JSON.stringify(mcp)] : []),
        ...(system ? ["--append-system-prompt", system] : []),
        ...(model ? ["--model", model] : []),
      ],
    };
  if (provider === "codex-cli")
    return {
      file: "codex",
      args: [
        "exec",
        "--json",
        "--sandbox",
        chosen.writes && runMode === "everything"
          ? "danger-full-access"
          : chosen.writes
            ? "workspace-write"
            : "read-only",
        "--skip-git-repo-check",
        ...(model ? ["-m", model] : []),
        system ? `${system}\n\n${prompt}` : prompt,
      ],
    };
  throw new Error("This provider does not stream its steps.");
}

// One normalised shape for both CLIs, so the interface never learns either
// vendor's event names.
function normalise(provider, event) {
  if (provider === "claude-cli") {
    if (event.type === "assistant")
      return (event.message?.content || [])
        .map((block) => {
          if (block.type === "text" && block.text)
            return { kind: "text", text: block.text };
          if (block.type === "tool_use")
            return {
              kind: "tool",
              id: block.id,
              name: block.name,
              input: block.input,
            };
          return null;
        })
        .filter(Boolean);
    if (event.type === "user")
      return (event.message?.content || [])
        .filter((block) => block.type === "tool_result")
        .map((block) => ({
          kind: "result",
          id: block.tool_use_id,
          error: !!block.is_error,
          output:
            typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content ?? ""),
        }));
    if (event.type === "result" || event.duration_api_ms !== undefined)
      return [
        {
          kind: "done",
          text: typeof event.result === "string" ? event.result : "",
          error: !!event.is_error,
          usage: event.usage
            ? {
                input: event.usage.input_tokens || 0,
                output: event.usage.output_tokens || 0,
                cacheRead: event.usage.cache_read_input_tokens || 0,
                cacheWrite: event.usage.cache_creation_input_tokens || 0,
              }
            : null,
        },
      ];
    return [];
  }
  if (event.type === "item.completed" && event.item?.type === "agent_message")
    return [{ kind: "text", text: event.item.text || "" }];
  if (
    event.type === "item.completed" &&
    event.item?.type === "command_execution"
  )
    return [
      {
        kind: "tool",
        id: event.item.id,
        name: "Bash",
        input: { command: event.item.command },
      },
      {
        kind: "result",
        id: event.item.id,
        error: (event.item.exit_code || 0) !== 0,
        output: String(event.item.aggregated_output || "").slice(0, 4000),
      },
    ];
  if (event.type === "turn.completed")
    return [
      {
        kind: "done",
        text: "",
        error: false,
        usage: event.usage
          ? {
              input: event.usage.input_tokens || 0,
              output: event.usage.output_tokens || 0,
              cacheRead: event.usage.cached_input_tokens || 0,
              cacheWrite: event.usage.cache_write_input_tokens || 0,
            }
          : null,
      },
    ];
  return [];
}

// Steps arrive as they happen; a tool result is folded into the call it answers
// so the interface renders one row per action rather than two.
function foldStep(steps, step) {
  if (step.kind === "result") {
    const call = [...steps].reverse().find((s) => s.id === step.id);
    if (call) {
      call.output = step.output;
      call.error = step.error;
      call.done = true;
      return steps;
    }
  }
  if (step.kind === "text") {
    const last = steps[steps.length - 1];
    if (last?.kind === "text") {
      last.text += step.text;
      return steps;
    }
  }
  steps.push(step);
  return steps;
}

function runStream(
  {
    provider,
    model,
    system,
    prompt,
    mode,
    runMode,
    allowlist,
    mcp,
    cwd,
    signal,
    timeoutMs = 900000,
  },
  onEvent,
  spawner = spawn,
) {
  const { file, args } = streamCommand(provider, {
    model,
    system,
    prompt,
    mode,
    runMode,
    allowlist,
    mcp,
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    let child;
    const steps = [];
    let usage = null;
    let finalText = "";
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve({ steps, usage, text: finalText });
    };
    const timer = setTimeout(() => {
      finish(new Error(`${file} did not finish within the time allowed.`));
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
    let buffer = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line.startsWith("{")) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        for (const step of normalise(provider, event)) {
          if (step.kind === "done") {
            usage = step.usage || usage;
            if (step.text) finalText = step.text;
            continue;
          }
          foldStep(steps, step);
        }
        onEvent?.(steps);
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4000) stderr += chunk;
    });
    child.on("error", (error) =>
      finish(
        new Error(
          error.code === "ENOENT"
            ? `${file} is not installed or not on PATH.`
            : `Could not run ${file}. ${error.message}`,
        ),
      ),
    );
    child.on("close", (code) => {
      if (settled) return;
      if (!finalText) {
        const text = steps.filter((s) => s.kind === "text").at(-1)?.text;
        if (text) finalText = text;
      }
      if (!finalText && !steps.length && code !== 0)
        return finish(
          new Error(stderr.trim().slice(0, 350) || `Exited with code ${code}.`),
        );
      finish(null);
    });
  });
}

module.exports = {
  MODES,
  RUN_MODES,
  DEFAULT_ALLOWLIST,
  RELAY_READ_TOOLS,
  RELAY_RUN_TOOLS,
  modeList,
  runModeList,
  permissionArgs,
  streamCommand,
  normalise,
  foldStep,
  runStream,
};
