import {
  ChevronDownIcon,
  FolderIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  WifiIcon,
  WifiOffIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { ThreadSummary } from "../appServer/presentation";
import type { EnvironmentProject, EnvironmentState } from "../appServer/useAppServerController";
import type { TimestampFormat } from "../settings/presentationPreferences";
import { T3Wordmark } from "./T3Wordmark";

function projectLabel(cwd: string): string {
  return cwd.split(/[\\/]/u).filter(Boolean).at(-1) ?? cwd;
}

function threadLabel(thread: ThreadSummary): string {
  return (thread.name ?? thread.preview) || "Untitled thread";
}

function threadTime(updatedAt: number, format: TimestampFormat): string {
  if (updatedAt <= 0) return "";
  const date = new Date(updatedAt * 1_000);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      ...(format === "12-hour" ? { hour12: true } : {}),
      ...(format === "24-hour" ? { hour12: false } : {}),
    });
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function SidebarV2({
  projects,
  environments,
  selectedEnvironmentId,
  selectedThreadId,
  settingsActive,
  groupProjects,
  timestampFormat,
  onSelectThread,
  onSelectProject,
  onNewThread,
  onAddProject,
  onOpenSettings,
}: {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly environments: ReadonlyArray<EnvironmentState>;
  readonly selectedEnvironmentId: string | null;
  readonly selectedThreadId: string | null;
  readonly settingsActive: boolean;
  readonly groupProjects: boolean;
  readonly timestampFormat: TimestampFormat;
  readonly onSelectThread: (environmentId: string, threadId: string) => void;
  readonly onSelectProject: (environmentId: string, workspace: string) => void;
  readonly onNewThread: (environmentId: string | null) => void;
  readonly onAddProject: () => void;
  readonly onOpenSettings: () => void;
}) {
  const [query, setQuery] = useState("");
  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const source = groupProjects
      ? projects
      : environments.map((environment) => ({
          key: `${environment.profile.id}:all`,
          environmentId: environment.profile.id,
          environmentName: environment.profile.name,
          cwd: "",
          threads: projects
            .filter((project) => project.environmentId === environment.profile.id)
            .flatMap((project) => project.threads),
        }));
    if (!normalized) return source;
    return source
      .map((project) => ({
        ...project,
        threads: project.threads.filter((thread) =>
          `${threadLabel(thread)} ${thread.cwd}`.toLocaleLowerCase().includes(normalized),
        ),
      }))
      .filter((project) => project.threads.length > 0);
  }, [environments, groupProjects, projects, query]);
  const connectedCount = environments.filter(
    (environment) => environment.phase === "connected",
  ).length;

  return (
    <aside
      className="flex w-[272px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
      data-sidebar-version="v2"
    >
      <header className="drag-region flex h-[var(--workspace-topbar-height)] shrink-0 items-center pl-[90px] pr-3">
        <button
          className="no-drag-region flex min-w-0 items-center gap-1 rounded-md outline-none ring-ring focus-visible:ring-2"
          onClick={() => onNewThread(selectedEnvironmentId)}
        >
          <T3Wordmark />
          <span className="truncate text-sm font-medium tracking-tight text-muted-foreground">
            Codex
          </span>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        <label className="group mb-4 flex h-8 items-center gap-2 rounded-md px-2 text-sidebar-muted-foreground hover:bg-sidebar-row-hover">
          <SearchIcon className="size-4 shrink-0" />
          <input
            className="min-w-0 flex-1 bg-transparent text-sm text-sidebar-foreground outline-none placeholder:text-sidebar-muted-foreground"
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd className="rounded bg-sidebar-control-surface px-1.5 py-0.5 text-[10px]">⌘K</kbd>
        </label>

        <div className="mb-2 flex h-7 items-center px-2 text-xs font-medium text-sidebar-muted-foreground">
          <span className="flex-1">Projects</span>
          <button
            className="grid size-6 place-items-center rounded hover:bg-sidebar-row-hover"
            aria-label="Add project"
            onClick={onAddProject}
          >
            <PlusIcon className="size-3.5" />
          </button>
        </div>

        {environments.length > 1 ? (
          <div className="mb-4 grid gap-1 px-1">
            {environments.map((environment) => (
              <button
                className={`flex h-8 items-center gap-2 rounded-md px-2 text-left text-xs transition-colors ${selectedEnvironmentId === environment.profile.id && selectedThreadId === null ? "bg-sidebar-row-active text-sidebar-foreground" : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"}`}
                key={environment.profile.id}
                title={`New thread in ${environment.profile.name}`}
                type="button"
                onClick={() => onNewThread(environment.profile.id)}
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${environment.phase === "connected" ? "bg-emerald-500" : "bg-amber-500"}`}
                />
                <span className="min-w-0 flex-1 truncate">{environment.profile.name}</span>
                <PlusIcon className="size-3.5" />
              </button>
            ))}
          </div>
        ) : null}

        {filteredProjects.map((project) => (
          <section className="mb-4" key={project.key}>
            {groupProjects ? (
              <button
                className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-sm font-medium hover:bg-sidebar-row-hover"
                title={project.cwd}
                type="button"
                onClick={() => onSelectProject(project.environmentId, project.cwd)}
              >
                <ChevronDownIcon className="size-3.5 text-sidebar-muted-foreground" />
                <FolderIcon className="size-4 text-sidebar-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{projectLabel(project.cwd)}</span>
                {environments.length > 1 ? (
                  <span className="max-w-20 truncate text-[10px] font-normal text-sidebar-muted-foreground/70">
                    {project.environmentName}
                  </span>
                ) : null}
              </button>
            ) : environments.length > 1 ? (
              <div className="h-7 truncate px-2 text-[11px] font-medium text-sidebar-muted-foreground">
                {project.environmentName}
              </div>
            ) : null}
            <div className={`grid gap-0.5 ${groupProjects ? "pl-4" : ""}`}>
              {project.threads.map((thread) => {
                const active =
                  !settingsActive &&
                  selectedEnvironmentId === project.environmentId &&
                  selectedThreadId === thread.id;
                return (
                  <button
                    className={`group relative flex min-h-8 w-full items-center rounded-md px-2 text-left transition-colors ${
                      active
                        ? "bg-sidebar-row-active text-sidebar-foreground shadow-sm"
                        : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                    }`}
                    key={`${project.environmentId}:${thread.id}`}
                    onClick={() => onSelectThread(project.environmentId, thread.id)}
                  >
                    {thread.status === "active" ? (
                      <span className="mr-2 size-1.5 shrink-0 rounded-full bg-blue-500" />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate pr-2 text-[13px] font-medium">
                      {threadLabel(thread)}
                    </span>
                    <span className="shrink-0 text-[10px] text-sidebar-muted-foreground/70">
                      {threadTime(thread.updatedAt, timestampFormat)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        {filteredProjects.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs leading-relaxed text-sidebar-muted-foreground">
            {query
              ? "No matching threads."
              : "Threads from connected app-servers will appear here."}
          </p>
        ) : null}
      </div>

      <footer className="grid gap-1 p-2.5">
        <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-sidebar-muted-foreground">
          <span
            className={`size-2 shrink-0 rounded-full ${connectedCount === environments.length && connectedCount > 0 ? "bg-emerald-500" : "bg-amber-500"}`}
          />
          <span className="min-w-0 flex-1 truncate">
            {connectedCount === environments.length && connectedCount > 0
              ? `${connectedCount} connected`
              : `${connectedCount} of ${environments.length} connected`}
          </span>
          {connectedCount === environments.length && connectedCount > 0 ? (
            <WifiIcon className="size-3.5" />
          ) : (
            <WifiOffIcon className="size-3.5" />
          )}
        </div>
        <button
          className={`flex h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors ${
            settingsActive
              ? "bg-sidebar-row-active text-sidebar-foreground shadow-sm"
              : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
          }`}
          onClick={onOpenSettings}
        >
          <SettingsIcon className="size-4" />
          Settings
        </button>
      </footer>
    </aside>
  );
}
