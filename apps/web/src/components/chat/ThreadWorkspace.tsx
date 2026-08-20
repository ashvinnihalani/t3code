import type { AppServerConnectionProfile } from "effect-codex-app-server/connection";
import { RefreshCwIcon } from "lucide-react";
import { useCallback, useState } from "react";

import type { ModelOption, ThreadDetail, ThreadSummary } from "../../appServer/presentation";
import type { ComposerOptions } from "../../appServer/composerOptions";
import type { ConnectionState, PendingApproval } from "../../appServer/useAppServerController";
import { ChatComposer } from "./ChatComposer";
import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel";
import { OpenInPicker } from "./OpenInPicker";
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
  environment,
  models,
  connection,
  loading,
  actionError,
  pendingApproval,
  onRetry,
  onStart,
  onSend,
  onInterrupt,
}: {
  readonly summary: ThreadSummary | null;
  readonly thread: ThreadDetail | null;
  readonly workspace: string;
  readonly environment: AppServerConnectionProfile;
  readonly models: ReadonlyArray<ModelOption>;
  readonly connection: ConnectionState;
  readonly loading: boolean;
  readonly actionError: string | null;
  readonly pendingApproval: PendingApproval | null;
  readonly onRetry: () => void;
  readonly onStart: (prompt: string, options: ComposerOptions) => Promise<void> | void;
  readonly onSend: (prompt: string, options: ComposerOptions) => Promise<void> | void;
  readonly onInterrupt: () => Promise<void> | void;
}) {
  const [workspaceOpenError, setWorkspaceOpenError] = useState<string | null>(null);
  const updateWorkspaceOpenError = useCallback((message: string | null) => {
    setWorkspaceOpenError(message);
  }, []);
  const isNew = summary === null;
  const running = thread?.turns.some((turn) => turn.status === "inProgress") ?? false;
  const cwd = thread?.cwd ?? summary?.cwd ?? workspace;

  return (
    <>
      <header className="drag-region @container/header-actions flex h-[var(--workspace-topbar-height)] shrink-0 items-center gap-3 border-b border-border px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <span className="truncate text-muted-foreground">{environment.name}</span>
          <span className="text-muted-foreground/50">/</span>
          <span className="truncate text-muted-foreground">{projectLabel(cwd)}</span>
          <span className="text-muted-foreground/50">/</span>
          <strong className="truncate font-medium text-foreground">
            {title(thread ?? summary)}
          </strong>
        </div>
        {connection.phase !== "connected" ? (
          <button
            className="no-drag-region inline-flex h-8 items-center gap-2 rounded-md border border-input bg-card px-3 text-xs font-medium hover:bg-accent"
            onClick={onRetry}
          >
            <RefreshCwIcon className="size-3.5" /> Retry
          </button>
        ) : null}
        <OpenInPicker cwd={cwd} profile={environment} onError={updateWorkspaceOpenError} />
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
            {pendingApproval ? <ComposerPendingApprovalPanel approval={pendingApproval} /> : null}
            {actionError || workspaceOpenError ? (
              <p className="mb-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-xs text-destructive-foreground">
                {actionError ?? workspaceOpenError}
              </p>
            ) : null}
            <ChatComposer
              disabled={connection.phase !== "connected" || loading}
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
