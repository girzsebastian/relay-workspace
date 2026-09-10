import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Search, ShieldCheck } from "lucide-react";
import {
  apiProviderLabels,
  cliInstalled,
  cliProviders,
  isCliProvider,
  providerLabel,
} from "./providers";
import { call, type Preferences, type Provider, type State } from "./types";

type Row = {
  id: string;
  title: string;
  description: string;
  keywords?: string;
  control: ReactNode;
};
type Section = { id: string; title: string; rows: Row[] };

export function matchesQuery(row: Row, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${row.title} ${row.description} ${row.keywords || ""}`
    .toLowerCase()
    .includes(needle);
}

export function filterSections(sections: Section[], query: string) {
  return sections
    .map((section) => ({
      ...section,
      rows: section.rows.filter((row) => matchesQuery(row, query)),
    }))
    .filter((section) => section.rows.length > 0);
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`settings-toggle ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  );
}

export default function SettingsView({
  state,
  preferences,
  onPreferences,
  onCommand,
  onError,
  onSaved,
}: {
  state: State;
  preferences: Preferences;
  onPreferences: (patch: Partial<Preferences>) => void;
  onCommand: (command: string) => void;
  onError: (error: unknown) => void;
  onSaved: () => void;
}) {
  const [provider, setProvider] = useState<Provider>(state.settings.provider),
    [model, setModel] = useState(
      state.settings.models[state.settings.provider] || "",
    ),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("general"),
    [allowlist, setAllowlist] = useState<string[]>(
      state.settings.allowlist?.length ? state.settings.allowlist : [],
    ),
    [defaults, setDefaults] = useState<string[]>([]);
  useEffect(() => {
    call<{ defaultAllowlist: string[] }>("chat:modes", {})
      .then((info) => setDefaults(info.defaultAllowlist || []))
      .catch(() => setDefaults([]));
  }, []);
  const saveExecution = (
    runMode: "allowlist" | "auto-review" | "everything",
    list: string[],
  ) => {
    call("settings:execution", {
      runMode,
      allowlist: list.map((line) => line.trim()).filter(Boolean),
    })
      .then(onSaved)
      .catch(onError);
  };
  const configured = state.capabilities.configured.includes(provider);
  const save = async (remove = false) => {
    setBusy(true);
    try {
      await call("settings:save", {
        provider,
        model,
        ...(remove ? { key: "" } : key ? { key } : {}),
      });
      setKey("");
      onSaved();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  const sections: Section[] = useMemo(
    () => [
      {
        id: "general",
        title: "General",
        rows: [
          {
            id: "theme",
            title: "Appearance",
            description: "Light or dark, applied across every view.",
            keywords: "theme dark light colour color",
            control: (
              <select
                value={preferences.theme}
                onChange={(e) =>
                  onPreferences({
                    theme: e.target.value as Preferences["theme"],
                  })
                }
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            ),
          },
          {
            id: "reset-layout",
            title: "Reset layout",
            description:
              "Restore the default pane sizes and visibility in the editor.",
            keywords: "panes explorer terminal chat split",
            control: (
              <button
                className="button compact"
                onClick={() => onCommand("reset-layout")}
              >
                Reset
              </button>
            ),
          },
          {
            id: "split",
            title: "Split editor by default",
            description: "Open a second editor group when a workspace loads.",
            keywords: "editor group pane",
            control: (
              <Toggle
                label="Split editor by default"
                checked={!!preferences.splitEditor}
                onChange={(splitEditor) => onPreferences({ splitEditor })}
              />
            ),
          },
        ],
      },
      {
        id: "chat",
        title: "Chat provider",
        rows: [
          {
            id: "provider",
            title: "Where chat runs",
            description:
              "An installed CLI spends the subscription you already pay for. An API provider is billed separately by that provider.",
            keywords: "claude codex opencode openai anthropic subscription api",
            control: (
              <select
                value={provider}
                onChange={(e) => {
                  const next = e.target.value as Provider;
                  setProvider(next);
                  setModel(state.settings.models[next] || "");
                  setKey("");
                }}
              >
                <optgroup label="Installed CLI (uses that subscription)">
                  {Object.entries(cliProviders).map(([value, cli]) => (
                    <option key={value} value={value}>
                      {cli.label}
                      {cliInstalled(state, value as Provider)
                        ? ""
                        : " · not installed"}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="API key (billed separately)">
                  {Object.entries(apiProviderLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </optgroup>
              </select>
            ),
          },
          {
            id: "model",
            title: "Model ID",
            description: isCliProvider(provider)
              ? "Optional. Leave blank to use whatever that CLI defaults to."
              : "The exact model ID available to your API account.",
            keywords: "model id sonnet opus gpt",
            control: (
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={
                  isCliProvider(provider) ? "CLI default" : "Model ID"
                }
              />
            ),
          },
          ...(isCliProvider(provider)
            ? [
                {
                  id: "cli-state",
                  title: "CLI status",
                  description: cliInstalled(state, provider)
                    ? `${providerLabel(provider)} was found on this computer. Chat replies run read-only and cannot edit project files.`
                    : `${providerLabel(provider)} was not found on PATH. Install it, then reopen Settings.`,
                  keywords: "installed path cli",
                  control: (
                    <span
                      className={
                        cliInstalled(state, provider) ? "configured" : "muted"
                      }
                    >
                      {cliInstalled(state, provider) ? "Ready" : "Missing"}
                    </span>
                  ),
                },
              ]
            : [
                {
                  id: "key",
                  title: "API key",
                  description:
                    "Encrypted by the operating system. Keys stay out of project files, transcripts, and exports.",
                  keywords: "secret token credential",
                  control: (
                    <input
                      type="password"
                      autoComplete="off"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      placeholder={
                        configured ? "Saved — leave blank to keep" : "Paste key"
                      }
                    />
                  ),
                },
              ]),
          {
            id: "save",
            title: "Save chat provider",
            description:
              "Applies to new conversations. Existing chats keep the provider they were created with.",
            keywords: "apply store",
            control: (
              <div className="settings-actions">
                <button
                  className="button primary compact"
                  disabled={busy}
                  onClick={() => void save()}
                >
                  <Check size={14} />
                  Save
                </button>
                {!isCliProvider(provider) && configured && (
                  <button
                    className="button danger-text"
                    disabled={busy}
                    onClick={() => void save(true)}
                  >
                    Remove key
                  </button>
                )}
              </div>
            ),
          },
        ],
      },
      {
        id: "agents",
        title: "Coding agents",
        rows: (["codex", "claude", "opencode"] as const).map((cli) => ({
          id: cli,
          title: {
            codex: "Codex",
            claude: "Claude Code",
            opencode: "OpenCode",
          }[cli],
          description: state.capabilities[cli]
            ? "Installed. Relay launches it with your existing login."
            : "Not found on PATH. Install and sign in with its official CLI.",
          keywords: "cli agent terminal install",
          control: (
            <span className={state.capabilities[cli] ? "configured" : "muted"}>
              {state.capabilities[cli] ? "Installed" : "Missing"}
            </span>
          ),
        })),
      },
      {
        id: "execution",
        title: "Approvals & execution",
        rows: [
          {
            id: "run-mode",
            title: "Run mode",
            description:
              "How much an agent chat may do on its own. Claude Code cannot pause to ask Relay mid-run, so anything not allowed is refused rather than left waiting.",
            keywords: "permission approval allowlist sandbox run",
            control: (
              <select
                aria-label="Run mode"
                value={state.settings.runMode || "auto-review"}
                onChange={(e) =>
                  saveExecution(
                    e.target.value as
                      "allowlist" | "auto-review" | "everything",
                    allowlist,
                  )
                }
              >
                <option value="allowlist">Allowlist only</option>
                <option value="auto-review">
                  Auto-review (allowlist + apply edits)
                </option>
                <option value="everything">Run everything</option>
              </select>
            ),
          },
          {
            id: "allowlist",
            title: "Allowed tools",
            description:
              "One entry per line, in Claude Code's form: Read, Grep, Bash(git status:*). Leave empty to use the read-only defaults.",
            keywords: "allowlist bash tools permission",
            control: (
              <textarea
                aria-label="Allowed tools"
                rows={5}
                className="settings-allowlist"
                value={allowlist.join("\n")}
                placeholder={defaults.join("\n")}
                onChange={(e) => setAllowlist(e.target.value.split("\n"))}
                onBlur={() =>
                  saveExecution(
                    state.settings.runMode || "auto-review",
                    allowlist,
                  )
                }
              />
            ),
          },
        ],
      },
      {
        id: "data",
        title: "Data & privacy",
        rows: [
          {
            id: "storage",
            title: "Stored on this device",
            description:
              "Projects, conversations, terminal output, editor drafts, and usage records. Nothing is uploaded by Relay.",
            keywords: "local privacy disk",
            control: (
              <span className="muted">{state.capabilities.platform}</span>
            ),
          },
          {
            id: "encryption",
            title: "OS credential encryption",
            description:
              "API keys are encrypted with the operating system keychain.",
            keywords: "safestorage keychain",
            control: (
              <span
                className={
                  state.capabilities.secureStorage ? "configured" : "muted"
                }
              >
                {state.capabilities.secureStorage ? "Available" : "Unavailable"}
              </span>
            ),
          },
          {
            id: "export",
            title: "Export usage",
            description:
              "Write recorded token counts and build timings to a JSON file.",
            keywords: "usage tokens export json",
            control: (
              <button
                className="button compact"
                onClick={() => call("usage:export", {}).catch(onError)}
              >
                Export
              </button>
            ),
          },
        ],
      },
    ],
    [
      state,
      preferences,
      provider,
      model,
      key,
      busy,
      configured,
      allowlist,
      defaults,
      onPreferences,
      onCommand,
      onError,
    ],
  );
  const visible = filterSections(sections, query);
  const shown = query.trim()
    ? visible
    : visible.filter((section) => section.id === category);
  return (
    <div className="settings-screen">
      <aside className="settings-rail">
        <label className="settings-search">
          <Search size={13} />
          <input
            value={query}
            aria-label="Search settings"
            placeholder="Search settings"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {sections.map((section) => (
          <button
            key={section.id}
            className={
              !query.trim() && category === section.id ? "active" : undefined
            }
            onClick={() => {
              setQuery("");
              setCategory(section.id);
            }}
          >
            {section.title}
          </button>
        ))}
        <div className="settings-rail-foot">
          <ShieldCheck size={15} />
          <span>
            Relay does not copy subscription credentials between tools.
          </span>
        </div>
      </aside>
      <div className="settings-content">
        {shown.map((section) => (
          <section key={section.id}>
            <h2>{section.title}</h2>
            <div className="settings-group">
              {section.rows.map((row) => (
                <div className="settings-row" key={row.id}>
                  <div>
                    <b>{row.title}</b>
                    <p>{row.description}</p>
                  </div>
                  <div className="settings-control">{row.control}</div>
                </div>
              ))}
            </div>
          </section>
        ))}
        {!shown.length && (
          <p className="scm-clean">No setting matches “{query}”.</p>
        )}
      </div>
    </div>
  );
}
