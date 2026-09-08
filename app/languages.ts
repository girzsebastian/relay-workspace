import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
export function languageForFile(path: string) {
  const filename = path.split(/[\\/]/).at(-1) || path;
  if (/^\.env(?:\.|$)/i.test(filename))
    return languages.find((l) => l.name === "Properties files");
  return LanguageDescription.matchFilename(languages, filename);
}
export function fileAppearance(path: string) {
  const file = path.split(/[\\/]/).at(-1)?.toLowerCase() || path;
  if (/\.(tsx?|mts|cts)$/.test(file)) return { label: "TS", color: "#76baff" };
  if (/\.(jsx?|mjs|cjs)$/.test(file)) return { label: "JS", color: "#e4ce7d" };
  if (/\.(php|phtml)$/.test(file)) return { label: "php", color: "#b6a1f0" };
  if (/\.pyw?$/.test(file)) return { label: "Py", color: "#8cc6df" };
  if (/\.(yaml|yml)$/.test(file)) return { label: "Y", color: "#e6a298" };
  if (/\.(css|scss|sass|less)$/.test(file))
    return { label: "#", color: "#bb9de4" };
  if (/\.(html|vue|svelte|xml|svg)$/.test(file))
    return { label: "<>", color: "#e5ac85" };
  if (/\.(json|jsonc|toml)$/.test(file))
    return { label: "{}", color: "#d9c389" };
  if (/\.(md|mdx|markdown)$/.test(file))
    return { label: "M", color: "#a3b6d1" };
  if (/^(dockerfile|\.env)|\.(sh|bash|zsh)$/.test(file))
    return { label: ">_", color: "#91c7a4" };
  return { label: "·", color: "#949dab" };
}
