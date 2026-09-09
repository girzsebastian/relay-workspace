import FileIcon from "./FileIcon";
import { languageForFile } from "./languages";
import { useEffect, useRef, useState } from "react";
import { Columns2, FileCode2, RotateCcw, Save, X } from "lucide-react";
import Editor from "./Editor";
import Sidebar from "./Sidebar";
import ResizeHandle from "./ResizeHandle";
import {
  call,
  type Draft,
  type EditorState,
  type Preferences,
  type Project,
} from "./types";

export default function EditorWorkspace({
  project,
  preferences,
  onPreferences,
  onError,
  openRequest,
  projects,
}: {
  project: Project;
  projects: Project[];
  preferences: Preferences;
  onPreferences: (patch: Partial<Preferences>) => void;
  onError: (error: unknown) => void;
  openRequest?: { path: string; token: number } | null;
}) {
  const [editor, setEditor] = useState<EditorState>(
    () =>
      project.editor || {
        tabs: project.draft ? [project.draft] : [],
        primary: project.draft?.path || null,
        secondary: null,
        focusedPane: 1,
      },
  );
  const current = useRef(editor),
    groups = useRef<HTMLDivElement>(null),
    saving = useRef(false);
  const persist = (next: EditorState) => {
    current.current = next;
    setEditor(next);
    return call("editor:state", { projectId: project.id, editor: next }).catch(
      onError,
    );
  };
  const active =
    preferences.splitEditor && editor.focusedPane === 2
      ? editor.secondary
      : editor.primary;
  const select = (path: string, pane: 1 | 2) => {
    void persist({
      ...current.current,
      [pane === 1 ? "primary" : "secondary"]: path,
      focusedPane: pane,
    });
  };
  const open = async (path: string) => {
    try {
      const pane = preferences.splitEditor ? current.current.focusedPane : 1;
      if (!current.current.tabs.some((t) => t.path === path)) {
        if (current.current.tabs.length >= 20)
          throw new Error(
            "Close a tab before opening another (20 tabs per project).",
          );
        const file = await call<Draft>("files:read", {
          projectId: project.id,
          path,
        });
        // Another read may have completed while this one was in flight.
        if (!current.current.tabs.some((t) => t.path === path))
          await persist({
            ...current.current,
            tabs: [...current.current.tabs, { ...file, dirty: false }],
          });
      }
      select(path, pane);
    } catch (error) {
      onError(error);
    }
  };
  // A search result asks the editor to open a file it does not own.
  useEffect(() => {
    if (openRequest?.path) void open(openRequest.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.token]);
  const save = async () => {
    const state = current.current,
      path =
        preferences.splitEditor && state.focusedPane === 2
          ? state.secondary
          : state.primary,
      draft = state.tabs.find((t) => t.path === path);
    if (!draft || saving.current) return;
    saving.current = true;
    try {
      const result = await call<Draft>("files:save", {
        projectId: project.id,
        path: draft.path,
        content: draft.content,
        hash: draft.hash,
      });
      await persist({
        ...current.current,
        tabs: current.current.tabs.map((t) =>
          t.path === draft.path
            ? { ...t, hash: result.hash, dirty: t.content !== draft.content }
            : t,
        ),
      });
    } catch (error) {
      onError(error);
    } finally {
      saving.current = false;
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  const editorCommand = useRef<(command: string) => void>(() => {});
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    };
    const command = (e: Event) => {
      const cmd = (e as CustomEvent).detail;
      if (cmd === "save-file") void saveRef.current();
      else editorCommand.current(cmd);
    };
    window.addEventListener("keydown", keyboard);
    window.addEventListener("relay-command", command);
    return () => {
      window.removeEventListener("keydown", keyboard);
      window.removeEventListener("relay-command", command);
    };
  }, []);
  const close = async (path: string) => {
    try {
      await call("editor:state", {
        projectId: project.id,
        editor: current.current,
      });
      if (
        !(await call<boolean>("editor:confirm-discard", {
          projectId: project.id,
          path,
        }))
      )
        return;
      const state = current.current,
        index = state.tabs.findIndex((t) => t.path === path),
        tabs = state.tabs.filter((t) => t.path !== path),
        fallback = tabs[Math.min(index, tabs.length - 1)]?.path || null;
      await persist({
        ...state,
        tabs,
        primary: state.primary === path ? fallback : state.primary,
        secondary: state.secondary === path ? fallback : state.secondary,
      });
    } catch (error) {
      onError(error);
    }
  };
  const reload = async (path: string) => {
    try {
      const draft = await call<Draft | null>("files:reload", {
        projectId: project.id,
        path,
      });
      if (draft)
        await persist({
          ...current.current,
          tabs: current.current.tabs.map((t) => (t.path === path ? draft : t)),
        });
    } catch (error) {
      onError(error);
    }
  };
  editorCommand.current = (command) => {
    const state = current.current,
      pane = preferences.splitEditor ? state.focusedPane : 1,
      active = pane === 1 ? state.primary : state.secondary;
    if (command === "close-tab" && active) void close(active);
    if (["next-tab", "previous-tab"].includes(command) && state.tabs.length) {
      const index = state.tabs.findIndex((t) => t.path === active),
        delta = command === "next-tab" ? 1 : -1;
      select(
        state.tabs[(index + delta + state.tabs.length) % state.tabs.length]
          .path,
        pane,
      );
    }
  };
  const group = (pane: 1 | 2) => {
    const path = pane === 1 ? editor.primary : editor.secondary,
      draft = editor.tabs.find((t) => t.path === path);
    return (
      <section
        className={`editor-group ${editor.focusedPane === pane ? "active-group" : ""}`}
        aria-label={`Editor group ${pane}`}
        onFocusCapture={() => {
          if (current.current.focusedPane !== pane)
            void persist({ ...current.current, focusedPane: pane });
        }}
      >
        <div className="editor-tabbar">
          <div
            className="file-tabs"
            role="tablist"
            aria-label={`Files in editor ${pane}`}
          >
            {editor.tabs.map((tab) => (
              <div
                className={`file-tab ${path === tab.path ? "selected" : ""}`}
                key={tab.path}
              >
                <button
                  role="tab"
                  aria-selected={path === tab.path}
                  title={tab.path}
                  onClick={() => select(tab.path, pane)}
                >
                  <FileIcon path={tab.path} />
                  <span>{tab.path.split(/[\\/]/).at(-1)}</span>
                  {tab.dirty && (
                    <i className="dirty-dot" title="Unsaved draft" />
                  )}
                </button>
                <button
                  title={`Close ${tab.path}`}
                  onClick={() => void close(tab.path)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <button
            title="Toggle split editor"
            aria-pressed={preferences.splitEditor}
            onClick={() => {
              if (!editor.secondary && editor.primary)
                void persist({ ...current.current, secondary: editor.primary });
              onPreferences({ splitEditor: !preferences.splitEditor });
            }}
          >
            <Columns2 size={14} />
          </button>
        </div>
        {draft ? (
          <>
            <div className="file-breadcrumb">
              <span title={draft.path}>
                {project.name} › {draft.path.replaceAll("/", " › ")}
              </span>
              <button
                title="Reload file from disk"
                onClick={() => void reload(draft.path)}
              >
                <RotateCcw size={12} />
              </button>
              <button
                title="Save file"
                onClick={() => {
                  select(draft.path, pane);
                  void saveRef.current();
                }}
              >
                <Save size={13} />
              </button>
            </div>
            <Editor
              path={draft.path}
              content={draft.content}
              projectId={project.id}
              dark={preferences.theme === "dark"}
              onChange={(content) => {
                void persist({
                  ...current.current,
                  tabs: current.current.tabs.map((t) =>
                    t.path === draft.path ? { ...t, content, dirty: true } : t,
                  ),
                });
              }}
            />
            <div className="editor-footer">
              <span>
                {languageForFile(draft.path)?.name || "Plain text"} · UTF-8
              </span>
              <span>
                {draft.dirty ? "Draft saved locally" : "Saved to file"}
              </span>
            </div>
          </>
        ) : (
          <div className="editor-welcome">
            <FileCode2 size={34} />
            <h3>{pane === 2 ? "Second editor" : project.name}</h3>
            <p>Choose a file from the explorer or an open tab.</p>
            <span>⌘ / Ctrl S · Save file</span>
          </div>
        )}
      </section>
    );
  };
  return (
    <section
      className={`file-workspace ${preferences.showExplorer ? "" : "explorer-hidden"}`}
      style={
        {
          "--explorer-width": `${preferences.explorerWidth}px`,
        } as React.CSSProperties
      }
    >
      {preferences.showExplorer && (
        <>
          <Sidebar
            project={project}
            projects={projects}
            panel={preferences.sidebarPanel || "explorer"}
            onPanel={(sidebarPanel) => onPreferences({ sidebarPanel })}
            selected={active || undefined}
            onOpenEntry={(entry) => void open(entry.path)}
            onOpenPath={(path) => void open(path)}
            onError={onError}
          />
          <ResizeHandle
            axis="x"
            label="Resize explorer"
            value={preferences.explorerWidth}
            min={140}
            max={Math.min(600, window.innerWidth * 0.3)}
            onChange={(explorerWidth) => onPreferences({ explorerWidth })}
          />
        </>
      )}
      <div
        ref={groups}
        className={`editor-groups ${preferences.splitEditor ? "split" : ""}`}
        style={
          {
            "--editor-split": `${preferences.editorSplit}%`,
          } as React.CSSProperties
        }
      >
        {group(1)}
        {preferences.splitEditor && (
          <>
            <ResizeHandle
              axis="x"
              label="Resize editor split"
              value={preferences.editorSplit}
              min={20}
              max={80}
              scale={100 / (groups.current?.clientWidth || 600)}
              onChange={(editorSplit) => onPreferences({ editorSplit })}
            />
            {group(2)}
          </>
        )}
      </div>
    </section>
  );
}
