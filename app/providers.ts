import type { Provider, State } from "./types";

type CliDescriptor = {
  executable: "claude" | "codex" | "opencode";
  label: string;
  note: string;
};

// Chat backends that reuse a CLI the user already installed and signed into.
// These spend the subscription attached to that tool, not a Relay API key.
export const cliProviders: Record<string, CliDescriptor> = {
  "claude-cli": {
    executable: "claude",
    label: "Claude Code CLI",
    note: "Uses your Claude Code login.",
  },
  "codex-cli": {
    executable: "codex",
    label: "Codex CLI",
    note: "Uses your Codex login.",
  },
  "opencode-cli": {
    executable: "opencode",
    label: "OpenCode CLI",
    note: "Uses your OpenCode configuration.",
  },
};

export const apiProviderLabels: Record<string, string> = {
  openai: "OpenAI · Responses API",
  anthropic: "Anthropic · Messages API",
};

export const isCliProvider = (provider: Provider) =>
  Object.hasOwn(cliProviders, provider);

export const providerLabel = (provider: Provider) =>
  cliProviders[provider]?.label || apiProviderLabels[provider] || provider;

export const cliInstalled = (state: State, provider: Provider) => {
  const descriptor = cliProviders[provider];
  return descriptor ? !!state.capabilities[descriptor.executable] : false;
};

// An API provider needs a stored key and an explicit model ID. A CLI provider
// only needs to be installed; its model defaults to whatever that tool uses.
export const providerReady = (state: State, provider: Provider) =>
  isCliProvider(provider)
    ? cliInstalled(state, provider)
    : !!state.settings.models[provider] &&
      state.capabilities.configured.includes(provider);

export const providerBlockedReason = (state: State, provider: Provider) => {
  if (isCliProvider(provider))
    return cliInstalled(state, provider)
      ? null
      : `${providerLabel(provider)} is not installed on this computer. Install it, or pick an API provider in Settings.`;
  if (!state.capabilities.configured.includes(provider))
    return "Add an API key in Settings before sending.";
  if (!state.settings.models[provider])
    return "Set a model ID in Settings before sending.";
  return null;
};
