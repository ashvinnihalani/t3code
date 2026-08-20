import { RefreshCwIcon, SmartphoneIcon } from "lucide-react";

import type { ModelOption, ThreadDetail, ThreadSummary } from "../../appServer/presentation";
import type { ConnectionState } from "../../appServer/useAppServerController";
import { ChatComposer } from "./ChatComposer";
import { ThreadTimeline } from "./ThreadTimeline";

function title(thread: ThreadSummary | ThreadDetail | null): string {
  return thread ? (thread.name ?? thread.preview) || "New thread" : "New thread";
}

function projectLabel(cwd: string): string {
  return cwd.split(/[\\/]/u).filter(Boolean).at(-1) ?? cwd;
}

export function ThreadWorkspace({
  summary,
  thread,
  workspace,
  models,
  connection,
  loading,
  actionError,
  onRetry,
  onRemote,
  onStart,
  onSend,
  onInterrupt,
}: {
  readonly summary: ThreadSummary | null;
  readonly thread: ThreadDetail | null;
  readonly workspace: string;
  readonly models: ReadonlyArray<ModelOption>;
  readonly connection: ConnectionState;
  readonly loading: boolean;
  readonly actionError: string | null;
  readonly onRetry: () => void;
  readonly onRemote: () => void;
  readonly onStart: (prompt: string, model: string | null) => Promise<void> | void;
  readonly onSend: (prompt: string, model: string | null) => Promise<void> | void;
  readonly onInterrupt: () => Promise<void> | void;
}) {
  const isNew = summary === null;
  const running = thread?.turns.some((turn) => turn.status === "inProgress") ?? false;
  const cwd = thread?.cwd ?? summary?.cwd ?? workspace;

  return (
    <>
      <header className="drag-region flex h-[var(--workspace-topbar-height)] shrink-0 items-center gap-3 border-b border-border px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <span className="truncate text-muted-foreground">{projectLabel(cwd)}</span>
          <span className="text-muted-foreground/50">/</span>
          <strong className="truncate font-medium text-foreground">
            {title(thread ?? summary)}
          </strong>
        </div>
        {connection.phase !== "ready" ? (
          <button
            className="no-drag-region inline-flex h-8 items-center gap-2 rounded-md border border-input bg-card px-3 text-xs font-medium hover:bg-accent"
            onClick={onRetry}
          >
            <RefreshCwIcon className="size-3.5" /> Retry
          </button>
        ) : null}
        <button
          className="no-drag-region inline-flex h-8 items-center gap-2 rounded-md border border-input bg-card px-3 text-xs font-medium hover:bg-accent disabled:opacity-40"
          disabled={connection.phase !== "ready"}
          onClick={onRemote}
        >
          <SmartphoneIcon className="size-3.5" /> Remote
        </button>
      </header>

      {connection.error ? (
        <div className="border-b border-amber-500/20 bg-amber-500/8 px-5 py-2.5 text-xs text-amber-700 dark:text-amber-300">
          Reconnecting to app-server · {connection.error}
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {isNew ? (
          <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-8 pb-44">
            <h1 className="text-center text-[32px] font-medium tracking-tight">
              What should we build in{" "}
              <span className="underline decoration-muted-foreground/50 decoration-dotted underline-offset-4">
                {projectLabel(workspace)}
              </span>
              ?
            </h1>
          </div>
        ) : thread ? (
          <div className="min-h-0 flex-1 overflow-y-auto pb-40">
            <ThreadTimeline thread={thread} />
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 place-items-center text-sm text-muted-foreground">
            {loading ? "Loading thread…" : "Select a thread to resume it."}
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background to-transparent px-6 pb-6 pt-16">
          <div className="pointer-events-auto mx-auto max-w-3xl">
            {actionError ? (
              <p className="mb-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-xs text-destructive-foreground">
                {actionError}
              </p>
            ) : null}
            <ChatComposer
              disabled={connection.phase !== "ready" || loading}
              models={models}
              placeholder={
                isNew
                  ? "Ask Codex to build, fix, or explore"
                  : "Ask for follow-up changes or attach images"
              }
              running={running}
              onInterrupt={onInterrupt}
              onSend={isNew ? onStart : onSend}
            />
          </div>
        </div>
      </div>
    </>
  );
}
