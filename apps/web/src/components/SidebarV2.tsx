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
import type { ConnectionState } from "../appServer/useAppServerController";
import type { TimestampFormat } from "../settings/presentationPreferences";
import { T3Wordmark } from "./T3Wordmark";

interface ProjectGroup {
  readonly cwd: string;
  readonly threads: ReadonlyArray<ThreadSummary>;
}

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
  connection,
  selectedThreadId,
  settingsActive,
  groupProjects,
  timestampFormat,
  onSelectThread,
  onNewThread,
  onOpenSettings,
}: {
  readonly projects: ReadonlyArray<ProjectGroup>;
  readonly connection: ConnectionState;
  readonly selectedThreadId: string | null;
  readonly settingsActive: boolean;
  readonly groupProjects: boolean;
  readonly timestampFormat: TimestampFormat;
  readonly onSelectThread: (threadId: string) => void;
  readonly onNewThread: () => void;
  readonly onOpenSettings: () => void;
}) {
  const [query, setQuery] = useState("");
  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const source = groupProjects
      ? projects
      : [{ cwd: "", threads: projects.flatMap((project) => project.threads) }];
    if (!normalized) return source;
    return source
      .map((project) => ({
        ...project,
        threads: project.threads.filter((thread) =>
          `${threadLabel(thread)} ${thread.cwd}`.toLocaleLowerCase().includes(normalized),
        ),
      }))
      .filter((project) => project.threads.length > 0);
  }, [groupProjects, projects, query]);

  return (
    <aside
      className="flex w-[272px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
      data-sidebar-version="v2"
    >
      <header className="drag-region flex h-[var(--workspace-topbar-height)] shrink-0 items-center pl-[90px] pr-3">
        <button
          className="no-drag-region flex min-w-0 items-center gap-1 rounded-md outline-none ring-ring focus-visible:ring-2"
          onClick={onNewThread}
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
            aria-label="New thread"
            onClick={onNewThread}
          >
            <PlusIcon className="size-3.5" />
          </button>
        </div>

        {filteredProjects.map((project) => (
          <section className="mb-4" key={project.cwd}>
            {groupProjects ? (
              <div className="flex h-8 items-center gap-2 px-1.5 text-sm font-medium">
                <ChevronDownIcon className="size-3.5 text-sidebar-muted-foreground" />
                <FolderIcon className="size-4 text-sidebar-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{projectLabel(project.cwd)}</span>
              </div>
            ) : null}
            <div className={`grid gap-0.5 ${groupProjects ? "pl-4" : ""}`}>
              {project.threads.map((thread) => {
                const active = !settingsActive && selectedThreadId === thread.id;
                return (
                  <button
                    className={`group relative flex min-h-8 w-full items-center rounded-md px-2 text-left transition-colors ${
                      active
                        ? "bg-sidebar-row-active text-sidebar-foreground shadow-sm"
                        : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                    }`}
                    key={thread.id}
                    onClick={() => onSelectThread(thread.id)}
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
            {query ? "No matching threads." : "Threads from app-server will appear here."}
          </p>
        ) : null}
      </div>

      <footer className="grid gap-1 p-2.5">
        <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-sidebar-muted-foreground">
          <span
            className={`size-2 shrink-0 rounded-full ${connection.phase === "ready" ? "bg-emerald-500" : "bg-amber-500"}`}
          />
          <span className="min-w-0 flex-1 truncate">
            {connection.phase === "ready" ? "Connected" : "Reconnecting"}
          </span>
          {connection.phase === "ready" ? (
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
