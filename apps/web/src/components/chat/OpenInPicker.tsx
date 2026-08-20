import type {
  AppServerConnectionProfile,
  WorkspaceOpener,
  WorkspaceOpenerId,
} from "effect-codex-app-server/connection";
import {
  ChevronDownIcon,
  Code2Icon,
  FolderClosedIcon,
  MousePointer2Icon,
  ZapIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentType, type SVGProps } from "react";

const PREFERRED_OPENER_KEY = "t3-codex.preferred-workspace-opener";

const ICONS: Readonly<Record<WorkspaceOpenerId, ComponentType<SVGProps<SVGSVGElement>>>> = {
  cursor: MousePointer2Icon,
  vscode: Code2Icon,
  zed: ZapIcon,
  "file-manager": FolderClosedIcon,
};

function storedPreference(): WorkspaceOpenerId | null {
  const value = window.localStorage.getItem(PREFERRED_OPENER_KEY);
  return value === "cursor" || value === "vscode" || value === "zed" || value === "file-manager"
    ? value
    : null;
}

export function OpenInPicker({
  profile,
  cwd,
  onError,
}: {
  readonly profile: AppServerConnectionProfile;
  readonly cwd: string;
  readonly onError: (message: string | null) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [openers, setOpeners] = useState<ReadonlyArray<WorkspaceOpener>>([]);
  const [preferred, setPreferred] = useState<WorkspaceOpenerId | null>(storedPreference);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (bridge === undefined) return;
    let active = true;
    onError(null);
    void bridge
      .listWorkspaceOpeners(profile)
      .then((available) => {
        if (active) setOpeners(available);
      })
      .catch((error: unknown) => {
        if (active) onError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [profile, onError]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const primary = useMemo(
    () => openers.find((candidate) => candidate.id === preferred) ?? openers[0] ?? null,
    [openers, preferred],
  );
  const PrimaryIcon = primary ? ICONS[primary.id] : Code2Icon;
  const unavailable = !cwd || primary === null || window.desktopBridge === undefined;

  const launch = async (opener: WorkspaceOpener) => {
    const bridge = window.desktopBridge;
    if (bridge === undefined) return;
    setOpen(false);
    setPreferred(opener.id);
    window.localStorage.setItem(PREFERRED_OPENER_KEY, opener.id);
    onError(null);
    const result = await bridge.openWorkspace({
      connection: profile.connection,
      cwd,
      opener: opener.id,
    });
    if (!result.ok) onError(result.error ?? `Could not open ${cwd} in ${opener.label}.`);
  };

  return (
    <div className="no-drag-region relative" ref={rootRef}>
      <div
        aria-label="Open workspace"
        className="flex overflow-hidden rounded-md border border-input bg-card"
      >
        <button
          aria-label={primary ? `Open in ${primary.label}` : "Open workspace"}
          className="inline-flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          disabled={unavailable}
          type="button"
          onClick={() => primary && void launch(primary)}
        >
          <PrimaryIcon aria-hidden="true" className="size-3.5" />
          <span className="sr-only @3xl/header-actions:not-sr-only">Open</span>
        </button>
        <span aria-hidden="true" className="w-px bg-border" />
        <button
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="Choose where to open workspace"
          className="grid size-8 place-items-center hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          disabled={openers.length === 0}
          type="button"
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDownIcon className="size-3.5" />
        </button>
      </div>
      {open ? (
        <div
          className="absolute right-0 top-full z-50 mt-1.5 min-w-44 rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl"
          role="menu"
        >
          {openers.map((opener) => {
            const Icon = ICONS[opener.id];
            return (
              <button
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent"
                key={opener.id}
                role="menuitem"
                type="button"
                onClick={() => void launch(opener)}
              >
                <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
                {opener.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
