const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const SUPPORTED = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const isSupported = (file) => SUPPORTED.has(path.extname(file).toLowerCase());

// TypeScript addresses files with forward slashes on every platform, and asks
// the host for them that way. A Windows path stored with backslashes would
// never match the buffer the editor sent, so the service would quietly answer
// about the file on disk instead.
const normalise = (file) => file.replace(/\\/g, "/");

// One TypeScript language service per workspace, the same machinery VS Code
// uses. The editor sends the buffer it is showing, which may be unsaved, so the
// service answers about what the person is looking at rather than what is on
// disk.
class LanguageServices {
  constructor() {
    this.projects = new Map();
  }
  service(root) {
    root = normalise(root);
    const existing = this.projects.get(root);
    if (existing) return existing;
    const overrides = new Map();
    const versions = new Map();
    const config = this.readConfig(root);
    const project = {
      root,
      overrides,
      versions,
      options: config.options,
      rootFiles: new Set(config.fileNames),
    };
    const host = {
      getScriptFileNames: () => [
        ...new Set([...project.rootFiles, ...overrides.keys()]),
      ],
      getScriptVersion: (file) => String(versions.get(file) || 0),
      getScriptSnapshot: (file) => {
        const override = overrides.get(file);
        if (override !== undefined)
          return ts.ScriptSnapshot.fromString(override);
        try {
          return ts.ScriptSnapshot.fromString(fs.readFileSync(file, "utf8"));
        } catch {
          return undefined;
        }
      },
      getCurrentDirectory: () => root,
      getCompilationSettings: () => project.options,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
      realpath: ts.sys.realpath,
    };
    project.service = ts.createLanguageService(
      host,
      ts.createDocumentRegistry(),
    );
    this.projects.set(root, project);
    return project;
  }
  // A project's own tsconfig decides how its files are read; without one, a
  // permissive default keeps a plain JavaScript folder usable.
  readConfig(root) {
    const configPath = ts.findConfigFile(root, ts.sys.fileExists);
    const fallback = {
      options: {
        allowJs: true,
        checkJs: false,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        jsx: ts.JsxEmit.ReactJSX,
        allowNonTsExtensions: true,
        skipLibCheck: true,
      },
      fileNames: [],
    };
    if (!configPath) return fallback;
    try {
      const parsed = ts.getParsedCommandLineOfConfigFile(
        configPath,
        {},
        {
          ...ts.sys,
          onUnRecoverableConfigFileDiagnostic: () => {},
        },
      );
      if (!parsed) return fallback;
      return {
        options: { ...parsed.options, skipLibCheck: true },
        // Only the entry points; the service pulls in whatever they import.
        fileNames: parsed.fileNames.slice(0, 4000),
      };
    } catch {
      return fallback;
    }
  }
  update(root, file, text) {
    file = normalise(file);
    const project = this.service(root);
    if (project.overrides.get(file) === text) return project;
    project.overrides.set(file, text);
    project.versions.set(file, (project.versions.get(file) || 0) + 1);
    project.rootFiles.add(file);
    return project;
  }
  completions(root, file, offset, text) {
    file = normalise(file);
    if (!isSupported(file)) return { items: [] };
    const project = this.update(root, file, text);
    const info = project.service.getCompletionsAtPosition(file, offset, {
      includeCompletionsForModuleExports: false,
      includeCompletionsWithInsertText: true,
    });
    if (!info) return { items: [] };
    return {
      // A long list is slow to send and slower to read; the editor filters
      // what it is given as the person keeps typing.
      items: info.entries.slice(0, 200).map((entry) => ({
        label: entry.name,
        kind: entry.kind,
        detail: entry.kindModifiers || undefined,
        sortText: entry.sortText,
      })),
    };
  }
  // The signature and documentation for one entry, fetched only for the item
  // the person has highlighted.
  detail(root, file, offset, text, name) {
    file = normalise(file);
    if (!isSupported(file)) return null;
    const project = this.update(root, file, text);
    const details = project.service.getCompletionEntryDetails(
      file,
      offset,
      name,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    if (!details) return null;
    return {
      signature: ts.displayPartsToString(details.displayParts),
      documentation: ts.displayPartsToString(details.documentation),
    };
  }
  diagnostics(root, file, text) {
    file = normalise(file);
    if (!isSupported(file)) return [];
    const project = this.update(root, file, text);
    const all = [
      ...project.service.getSyntacticDiagnostics(file),
      ...project.service.getSemanticDiagnostics(file),
    ];
    return all.slice(0, 200).map((d) => ({
      from: d.start ?? 0,
      to: (d.start ?? 0) + (d.length ?? 0),
      severity:
        d.category === ts.DiagnosticCategory.Error
          ? "error"
          : d.category === ts.DiagnosticCategory.Warning
            ? "warning"
            : "info",
      message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
      code: d.code,
    }));
  }
  hover(root, file, offset, text) {
    file = normalise(file);
    if (!isSupported(file)) return null;
    const project = this.update(root, file, text);
    const info = project.service.getQuickInfoAtPosition(file, offset);
    if (!info) return null;
    return {
      from: info.textSpan.start,
      to: info.textSpan.start + info.textSpan.length,
      signature: ts.displayPartsToString(info.displayParts),
      documentation: ts.displayPartsToString(info.documentation),
    };
  }
  forget(root) {
    root = normalise(root);
    this.projects.get(root)?.service.dispose?.();
    this.projects.delete(root);
  }
}

module.exports = { LanguageServices, isSupported, normalise };
