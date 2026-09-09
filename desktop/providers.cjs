const { isCliProvider, cliPrompt, runCli } = require("./cli-chat.cjs");

const roles = {
  builder:
    "You are a pragmatic software builder. Explain implementable changes and their verification. Do not claim to have read or changed files unless their contents were supplied. You may read this project and run read-only git commands to check facts before answering, and you cannot edit anything.",
  architect:
    "You are a software architect for entrepreneurs. Clarify constraints, compare options, and propose a small maintainable implementation. You may read this project and run read-only git commands to check facts before answering, and you cannot edit anything.",
  reviewer:
    "You are a careful code reviewer. Prioritize correctness, security, regressions, and testable findings. Cite supplied code only. You may read this project and run read-only git commands to check facts before answering, and you cannot edit anything.",
  product:
    "You are a product partner for a founder. Turn vague ideas into user journeys, acceptance criteria, and small experiments. Separate assumptions from evidence. You may read this project and run read-only git commands to check facts before answering, and you cannot edit anything.",
};
function requestFor(provider, model, messages, system, key) {
  if (provider === "anthropic")
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: { model, max_tokens: 4096, system, messages },
    };
  if (provider === "openai")
    return {
      url: "https://api.openai.com/v1/responses",
      headers: { Authorization: `Bearer ${key}` },
      body: {
        model,
        instructions: system,
        input: messages,
        max_output_tokens: 4096,
        store: false,
      },
    };
  throw new Error("Unsupported provider.");
}
function parseResponse(provider, body) {
  if (provider === "anthropic")
    return {
      text: (body.content || [])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n"),
      usage: body.usage
        ? {
            input: body.usage.input_tokens || 0,
            output: body.usage.output_tokens || 0,
            cacheRead: body.usage.cache_read_input_tokens || 0,
            cacheWrite: body.usage.cache_creation_input_tokens || 0,
          }
        : null,
    };
  return {
    text: (body.output || [])
      .flatMap((i) => i.content || [])
      .filter((c) => c.type === "output_text" || c.type === "refusal")
      .map((c) => c.text || c.refusal)
      .join("\n"),
    usage: body.usage
      ? {
          input: body.usage.input_tokens || 0,
          output: body.usage.output_tokens || 0,
          cacheRead: body.usage.input_tokens_details?.cached_tokens || 0,
          cacheWrite: 0,
        }
      : null,
  };
}
async function complete(
  { provider, model, messages, role, skill, key, signal, cwd, tools },
  fetcher = fetch,
  spawner,
) {
  const system =
    (roles[role] || roles.builder) +
    (skill ? `\n\nUser-selected project skill:\n${skill}` : "");
  if (isCliProvider(provider))
    return runCli(
      {
        provider,
        model,
        system,
        prompt: cliPrompt(messages),
        cwd,
        signal,
        tools,
      },
      ...(spawner ? [spawner] : []),
    );
  const req = requestFor(provider, model, messages, system, key);
  const response = await fetcher(req.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...req.headers },
    body: JSON.stringify(req.body),
    signal,
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      `Provider returned HTTP ${response.status}. ${String(
        body.error?.message || "Check your API key, model, and account limits.",
      )
        .replaceAll(key, "[redacted]")
        .slice(0, 350)}`,
    );
  return parseResponse(provider, body);
}
module.exports = { complete, requestFor, parseResponse, roles };
