import {
  ArchiveIcon,
  ArrowLeftIcon,
  Link2Icon,
  PaletteIcon,
  SearchIcon,
  Settings2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { T3Wordmark } from "../T3Wordmark";

export type SettingsSectionId = "general" | "appearance" | "connections" | "archive";

export const SETTINGS_SECTIONS: ReadonlyArray<{
  readonly id: SettingsSectionId;
  readonly label: string;
  readonly icon: LucideIcon;
}> = [
  { id: "general", label: "General", icon: Settings2Icon },
  { id: "appearance", label: "Appearance", icon: PaletteIcon },
  { id: "connections", label: "Connections", icon: Link2Icon },
  { id: "archive", label: "Archive", icon: ArchiveIcon },
];

const SEARCH_ITEMS: ReadonlyArray<{
  readonly title: string;
  readonly section: SettingsSectionId;
}> = [
  { title: "Project grouping", section: "general" },
  { title: "Time format", section: "general" },
  { title: "Local thread cache", section: "general" },
  { title: "Automatic reconnection", section: "general" },
  { title: "Version", section: "general" },
  { title: "Color scheme", section: "appearance" },
  { title: "Interface font size", section: "appearance" },
  { title: "Prompt font size", section: "appearance" },
  { title: "Code font size", section: "appearance" },
  { title: "App-server location", section: "connections" },
  { title: "Executable", section: "connections" },
  { title: "Workspace", section: "connections" },
  { title: "Remote SSH", section: "connections" },
  { title: "Archived threads", section: "archive" },
  { title: "Restore thread", section: "archive" },
];

export function SettingsSidebarNav({
  activeSection,
  onSelectSection,
  onBack,
}: {
  readonly activeSection: SettingsSectionId;
  readonly onSelectSection: (section: SettingsSectionId) => void;
  readonly onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? SEARCH_ITEMS.filter((item) => item.title.toLocaleLowerCase().includes(normalized))
      : [];
  }, [query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select")) return;
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <aside className="flex w-[272px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <header className="drag-region flex h-[var(--workspace-topbar-height)] shrink-0 items-center pl-[90px] pr-3">
        <div className="flex min-w-0 items-center gap-1">
          <T3Wordmark />
          <span className="truncate text-sm font-medium tracking-tight text-muted-foreground">
            Codex
          </span>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        <label className="group mb-3 flex h-8 items-center gap-2 rounded-md px-2 text-sidebar-muted-foreground hover:bg-sidebar-row-hover">
          <SearchIcon className="size-4 shrink-0" />
          <input
            ref={input}
            aria-label="Search settings"
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-sidebar-foreground outline-none placeholder:text-sidebar-muted-foreground"
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              aria-label="Clear search"
              className="grid size-5 place-items-center rounded hover:bg-sidebar-control-surface"
              type="button"
              onClick={() => setQuery("")}
            >
              <XIcon className="size-3" />
            </button>
          ) : (
            <kbd className="rounded bg-sidebar-control-surface px-1.5 py-0.5 text-[10px]">/</kbd>
          )}
        </label>
        <div className="grid gap-0.5">
          {query
            ? results.map((item) => {
                const section = SETTINGS_SECTIONS.find(
                  (candidate) => candidate.id === item.section,
                );
                const Icon = section?.icon ?? Settings2Icon;
                return (
                  <button
                    className="flex min-h-10 items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-sidebar-row-hover"
                    key={`${item.section}:${item.title}`}
                    onClick={() => {
                      onSelectSection(item.section);
                      setQuery("");
                    }}
                  >
                    <Icon className="mt-0.5 size-3.5 text-sidebar-muted-foreground/60" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.title}</span>
                      <span className="block text-[11px] text-sidebar-muted-foreground/75">
                        {section?.label}
                      </span>
                    </span>
                  </button>
                );
              })
            : SETTINGS_SECTIONS.map(({ id, label, icon: Icon }) => (
                <button
                  className={`flex h-9 items-center gap-2 rounded-md px-2 text-sm font-medium transition-colors ${activeSection === id ? "bg-sidebar-row-active text-sidebar-foreground shadow-sm" : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"}`}
                  key={id}
                  onClick={() => onSelectSection(id)}
                >
                  <Icon className="size-4" />
                  <span>{label}</span>
                </button>
              ))}
        </div>
        {query && results.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground">
            No settings found
          </p>
        ) : null}
      </div>
      <footer className="p-2.5">
        <button
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
          onClick={onBack}
        >
          <ArrowLeftIcon className="size-4" /> Back
        </button>
      </footer>
    </aside>
  );
}
