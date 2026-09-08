import { fileAppearance } from "./languages";
export default function FileIcon({ path }: { path: string }) {
  const { label, color } = fileAppearance(path);
  return (
    <span className="file-language-icon" aria-hidden="true" style={{ color }}>
      {label}
    </span>
  );
}
