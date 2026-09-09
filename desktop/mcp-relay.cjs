#!/usr/bin/env node
// A minimal MCP server over stdio. The CLI launches this; it forwards each tool
// call to the Relay window that started the run, so the process it opens is a
// terminal the person can watch rather than something hidden inside the agent.
const readline = require("node:readline");

const BRIDGE = process.env.RELAY_BRIDGE_URL;
const TOKEN = process.env.RELAY_BRIDGE_TOKEN;

const RUN_ID = process.env.RELAY_RUN_ID;

const TOOLS = [
  {
    name: "approval_request",
    description:
      "Relay calls this on your behalf when an action needs the user to approve it. Do not call it yourself.",
    inputSchema: {
      type: "object",
      properties: {
        tool_name: { type: "string" },
        input: { type: "object" },
        tool_use_id: { type: "string" },
      },
      required: ["tool_name", "input"],
    },
  },
  {
    name: "start_terminal",
    description:
      "Start a long-running command in a real Relay terminal, such as a dev server or a watcher. Returns immediately with a terminal id; the process keeps running after your reply. Use read_terminal to see its output. The terminal is visible to the user and read-only to you.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to run, e.g. 'npm run dev'.",
        },
        name: {
          type: "string",
          description: "Short label shown on the terminal tab.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "read_terminal",
    description:
      "Read the output of a Relay terminal. Give a pattern to wait until it appears, which is how you confirm a dev server is up (for example 'Local:|ready in|error'). Returns as soon as it matches, the process exits, or the timeout passes.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Terminal id." },
        pattern: {
          type: "string",
          description: "Regular expression to wait for, case-insensitive.",
        },
        timeoutMs: {
          type: "number",
          description: "How long to wait, up to 180000.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "list_terminals",
    description:
      "List the terminals in the current Relay workspace, including which are still running.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "stop_terminal",
    description:
      "Stop a terminal an agent started. Terminals the person started are left alone.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
];

async function callBridge(name, args) {
  if (!BRIDGE) throw new Error("Relay is not reachable from this run.");
  const response = await fetch(`${BRIDGE}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(args || {}),
  });
  const body = await response.json();
  if (body.error) throw new Error(body.error);
  return body;
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(request) {
  if (request.method === "initialize")
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "relay", version: "1.0.0" },
    };
  if (request.method === "tools/list") return { tools: TOOLS };
  if (request.method === "tools/call") {
    // The permission tool has its own contract: the CLI reads allow or deny
    // from the JSON in the reply, so it is answered separately.
    if (request.params?.name === "approval_request") {
      const args = request.params?.arguments || {};
      const verdict = await callBridge("request_approval", {
        runId: RUN_ID,
        tool: args.tool_name,
        input: args.input,
      }).catch((error) => ({
        behavior: "deny",
        message: String(error.message).slice(0, 200),
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(verdict) }],
      };
    }
    const result = await callBridge(
      request.params?.name,
      request.params?.arguments,
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
  if (request.method === "ping") return {};
  throw new Error(`Unsupported method ${request.method}.`);
}

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", async (line) => {
  const text = line.trim();
  if (!text) return;
  let request;
  try {
    request = JSON.parse(text);
  } catch {
    return;
  }
  // Notifications carry no id and expect no reply.
  if (request.id === undefined || request.id === null) return;
  try {
    write({ jsonrpc: "2.0", id: request.id, result: await handle(request) });
  } catch (error) {
    write({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32000, message: String(error.message).slice(0, 400) },
    });
  }
});
