import { Box, Files, GitBranch, Search } from "lucide-react";
import FileTree from "./FileTree";
import SearchPanel from "./SearchPanel";
import SourceControl from "./SourceControl";
import Containers from "./Containers";
import type { FileEntry, Project, SidebarPanel } from "./types";

const panels: {
  id: SidebarPanel;
  name: string;
  icon: typeof Files;
}[] = [
  { id: "explorer", name: "Explorer", icon: Files },
  { id: "search", name: "Search", icon: Search },
  { id: "source-control", name: "Source control", icon: GitBranch },
  { id: "containers", name: "Containers", icon: Box },
];

// One sidebar, four panels, the editor always visible beside it — the shape
// every editor uses, rather than sending each panel to its own full page.
export default function Sidebar({
  project,
  projects,
  panel,
  onPanel,
  selected,
  onOpenEntry,
  onOpenPath,
  onError,
}: {
  project: Project;
  projects: Project[];
  panel: SidebarPanel;
  onPanel: (panel: SidebarPanel) => void;
  selected?: string;
  onOpenEntry: (entry: FileEntry) => void;
  onOpenPath: (path: string) => void;
  onError: (error: unknown) => void;
}) {
  return (
    <aside className="workbench-sidebar">
      <div className="sidebar-tabs" role="tablist" aria-label="Sidebar panels">
        {panels.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={panel === item.id}
            title={item.name}
            aria-label={item.name}
            onClick={() => onPanel(item.id)}
          >
            <item.icon size={16} strokeWidth={1.7} />
          </button>
        ))}
      </div>
      <div className="sidebar-body">
        {panel === "explorer" && (
          <FileTree
            project={project}
            selected={selected}
            onOpen={onOpenEntry}
            onError={onError}
          />
        )}
        {panel === "search" && (
          <SearchPanel
            project={project}
            onOpen={(file) => onOpenPath(file)}
            onError={onError}
          />
        )}
        {panel === "source-control" && (
          <SourceControl
            project={project}
            onOpenFile={onOpenPath}
            onError={onError}
          />
        )}
        {panel === "containers" && (
          <Containers
            projects={projects}
            projectId={project.id}
            onError={onError}
          />
        )}
      </div>
    </aside>
  );
}
