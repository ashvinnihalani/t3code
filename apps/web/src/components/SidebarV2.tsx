import {
  ArchiveIcon,
  ChevronDownIcon,
  FolderIcon,
  FolderOpenIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  Trash2Icon,
  WifiIcon,
  WifiOffIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";

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

type ContextMenuState =
  | {
      readonly kind: "project";
      readonly project: EnvironmentProject;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: "thread";
      readonly project: EnvironmentProject;
      readonly thread: ThreadSummary;
      readonly x: number;
      readonly y: number;
    };

type ConfirmationState =
  | { readonly kind: "project"; readonly project: EnvironmentProject }
  | {
      readonly kind: "thread";
      readonly project: EnvironmentProject;
      readonly thread: ThreadSummary;
    };

type ProjectMenuAction = "open-project" | "remove-project";
type ThreadMenuAction = "open-thread" | "archive-thread" | "delete-thread";

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
  onArchiveThread,
  onDeleteThread,
  onRemoveProject,
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
  readonly onArchiveThread: (environmentId: string, threadId: string) => Promise<boolean>;
  readonly onDeleteThread: (environmentId: string, threadId: string) => Promise<boolean>;
  readonly onRemoveProject: (environmentId: string, workspace: string) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const [destructiveActionRunning, setDestructiveActionRunning] = useState(false);
  const [destructiveError, setDestructiveError] = useState<string | null>(null);
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
  const environmentConnected = (environmentId: string) =>
    environments.find((environment) => environment.profile.id === environmentId)?.phase ===
    "connected";

  useEffect(() => {
    if (contextMenu === null) return;
    const close = () => setContextMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", close);
    };
  }, [contextMenu]);

  const openProjectMenu = async (event: ReactMouseEvent, project: EnvironmentProject) => {
    event.preventDefault();
    event.stopPropagation();
    const position = { x: event.clientX, y: event.clientY };
    const bridge = window.desktopBridge;
    if (bridge !== undefined) {
      const action = await bridge.showContextMenu<ProjectMenuAction>(
        [
          { id: "open-project", label: "Open project" },
          {
            id: "remove-project",
            label: "Remove project",
            destructive: true,
            disabled: project.threads.length > 0 && !environmentConnected(project.environmentId),
            separatorBefore: true,
          },
        ],
        position,
      );
      if (action === "open-project") {
        onSelectProject(project.environmentId, project.cwd);
      } else if (action === "remove-project") {
        setDestructiveError(null);
        setConfirmation({ kind: "project", project });
      }
      return;
    }
    setContextMenu({ kind: "project", project, ...position });
  };

  const openThreadMenu = async (
    event: ReactMouseEvent,
    project: EnvironmentProject,
    thread: ThreadSummary,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const position = { x: event.clientX, y: event.clientY };
    const bridge = window.desktopBridge;
    if (bridge !== undefined) {
      const connected = environmentConnected(project.environmentId);
      const action = await bridge.showContextMenu<ThreadMenuAction>(
        [
          { id: "open-thread", label: "Open thread" },
          {
            id: "archive-thread",
            label: "Archive thread",
            disabled: !connected,
            separatorBefore: true,
          },
          {
            id: "delete-thread",
            label: "Delete thread",
            destructive: true,
            disabled: !connected,
          },
        ],
        position,
      );
      if (action === "open-thread") {
        onSelectThread(project.environmentId, thread.id);
      } else if (action === "archive-thread") {
        void onArchiveThread(project.environmentId, thread.id);
      } else if (action === "delete-thread") {
        setDestructiveError(null);
        setConfirmation({ kind: "thread", project, thread });
      }
      return;
    }
    setContextMenu({ kind: "thread", project, thread, ...position });
  };

  const confirmDestructiveAction = async () => {
    if (confirmation === null) return;
    setDestructiveError(null);
    setDestructiveActionRunning(true);
    const completed =
      confirmation.kind === "project"
        ? await onRemoveProject(confirmation.project.environmentId, confirmation.project.cwd)
        : await onDeleteThread(confirmation.project.environmentId, confirmation.thread.id);
    setDestructiveActionRunning(false);
    if (completed) {
      setConfirmation(null);
    } else {
      setDestructiveError("The app-server action failed. Check the connection and try again.");
    }
  };

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
                onContextMenu={(event) => void openProjectMenu(event, project)}
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
                  <div
                    className={`group relative flex min-h-8 w-full items-center rounded-md transition-colors ${
                      active
                        ? "bg-sidebar-row-active text-sidebar-foreground shadow-sm"
                        : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                    }`}
                    key={`${project.environmentId}:${thread.id}`}
                    onContextMenu={(event) => void openThreadMenu(event, project, thread)}
                  >
                    <button
                      className="flex min-h-8 min-w-0 flex-1 items-center px-2 text-left"
                      type="button"
                      onClick={() => onSelectThread(project.environmentId, thread.id)}
                    >
                      {thread.status === "active" ? (
                        <span className="mr-2 size-1.5 shrink-0 rounded-full bg-blue-500" />
                      ) : null}
                      <span className="min-w-0 flex-1 truncate pr-2 text-[13px] font-medium">
                        {threadLabel(thread)}
                      </span>
                      <span className="shrink-0 pr-1 text-[10px] text-sidebar-muted-foreground/70 group-hover:opacity-0">
                        {threadTime(thread.updatedAt, timestampFormat)}
                      </span>
                    </button>
                    <button
                      aria-label={`Archive ${threadLabel(thread)}`}
                      className="absolute right-1 grid size-6 place-items-center rounded opacity-0 hover:bg-sidebar-control-surface group-hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
                      disabled={!environmentConnected(project.environmentId)}
                      title="Archive"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void onArchiveThread(project.environmentId, thread.id);
                      }}
                    >
                      <ArchiveIcon className="size-3.5" />
                    </button>
                  </div>
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
      {contextMenu ? (
        <div
          className="fixed z-50 min-w-48 rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl"
          role="menu"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 208),
            top: Math.min(contextMenu.y, window.innerHeight - 180),
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent"
            role="menuitem"
            type="button"
            onClick={() => {
              if (contextMenu.kind === "project") {
                onSelectProject(contextMenu.project.environmentId, contextMenu.project.cwd);
              } else {
                onSelectThread(contextMenu.project.environmentId, contextMenu.thread.id);
              }
              setContextMenu(null);
            }}
          >
            <FolderOpenIcon className="size-4 text-muted-foreground" />
            {contextMenu.kind === "project" ? "Open project" : "Open thread"}
          </button>
          {contextMenu.kind === "thread" ? (
            <button
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent disabled:opacity-40"
              disabled={!environmentConnected(contextMenu.project.environmentId)}
              role="menuitem"
              type="button"
              onClick={() => {
                const target = contextMenu;
                setContextMenu(null);
                void onArchiveThread(target.project.environmentId, target.thread.id);
              }}
            >
              <ArchiveIcon className="size-4 text-muted-foreground" /> Archive thread
            </button>
          ) : null}
          <div className="my-1 h-px bg-border" />
          <button
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={
              (contextMenu.kind === "thread" || contextMenu.project.threads.length > 0) &&
              !environmentConnected(contextMenu.project.environmentId)
            }
            role="menuitem"
            type="button"
            onClick={() => {
              setDestructiveError(null);
              setConfirmation(
                contextMenu.kind === "project"
                  ? { kind: "project", project: contextMenu.project }
                  : {
                      kind: "thread",
                      project: contextMenu.project,
                      thread: contextMenu.thread,
                    },
              );
              setContextMenu(null);
            }}
          >
            <Trash2Icon className="size-4" />
            {contextMenu.kind === "project" ? "Remove project" : "Delete thread"}
          </button>
        </div>
      ) : null}
      {confirmation ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
          role="presentation"
          onMouseDown={() => !destructiveActionRunning && setConfirmation(null)}
        >
          <div
            aria-label={confirmation.kind === "project" ? "Remove project" : "Delete thread"}
            aria-modal="true"
            className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-base font-semibold">
                {confirmation.kind === "project" ? "Remove project?" : "Delete thread?"}
              </h2>
              <p className="mt-2 text-sm leading-5 text-muted-foreground">
                {confirmation.kind === "project"
                  ? `This removes ${projectLabel(confirmation.project.cwd)} and permanently deletes its ${confirmation.project.threads.length} app-server thread${confirmation.project.threads.length === 1 ? "" : "s"}. Files on disk are not changed.`
                  : `This permanently deletes “${threadLabel(confirmation.thread)}” from its app-server. This action cannot be undone.`}
              </p>
              {destructiveError ? (
                <p className="mt-3 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-xs text-destructive-foreground">
                  {destructiveError}
                </p>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4">
              <button
                className="h-9 rounded-md border border-input bg-card px-4 text-xs font-medium hover:bg-accent disabled:opacity-50"
                disabled={destructiveActionRunning}
                type="button"
                onClick={() => setConfirmation(null)}
              >
                Cancel
              </button>
              <button
                className="h-9 rounded-md bg-destructive px-4 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                disabled={destructiveActionRunning}
                type="button"
                onClick={() => void confirmDestructiveAction()}
              >
                {destructiveActionRunning
                  ? "Working…"
                  : confirmation.kind === "project"
                    ? "Remove project"
                    : "Delete thread"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
