const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { executable } = require("./terminals.cjs");
const run = promisify(execFile);
function editorLaunchSpec(editor, projectPath, platform, resolved) {
  if (!["cursor", "code"].includes(editor)) throw new Error("Unknown editor.");
  if (platform === "darwin")
    return {
      file: "/usr/bin/open",
      args: [
        "-a",
        editor === "cursor" ? "Cursor" : "Visual Studio Code",
        projectPath,
      ],
    };
  if (!resolved)
    throw new Error(
      `Install ${editor === "cursor" ? "Cursor" : "VS Code"} and enable its command-line launcher first.`,
    );
  if (platform === "win32" && /\.(cmd|bat)$/i.test(resolved)) {
    // Encode literal PowerShell arguments; paths never become executable shell syntax.
    const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
    const script = `& ${literal(resolved)} ${literal(projectPath)}`;
    return {
      file: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
    };
  }
  return { file: resolved, args: [projectPath] };
}
async function openEditor(editor, projectPath) {
  const spec = editorLaunchSpec(
    editor,
    projectPath,
    process.platform,
    executable(editor),
  );
  try {
    await run(spec.file, spec.args, { timeout: 15000, windowsHide: true });
  } catch {
    throw new Error(
      `Could not open ${editor === "cursor" ? "Cursor" : "VS Code"}. Check that it is installed and its launcher is available.`,
    );
  }
}
module.exports = { openEditor, editorLaunchSpec };
