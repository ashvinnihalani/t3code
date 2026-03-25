import {
  ProjectId,
  type ModelSelection,
  type ProjectRemoteTarget,
  type ServerProviderStatus,
  type ThreadId,
} from "@t3tools/contracts";
import { type ChatMessage, type Thread, type ThreadSession } from "../types";
import { randomUUID } from "~/lib/utils";
import { type ComposerImageAttachment, type DraftThreadState } from "../composerDraftStore";
import { Schema } from "effect";
import {
  filterTerminalContextsWithText,
  stripInlineTerminalContextPlaceholders,
  type TerminalContextDraft,
} from "../lib/terminalContext";

export const LAST_INVOKED_SCRIPT_BY_PROJECT_KEY = "t3code:last-invoked-script-by-project";
const WORKTREE_BRANCH_PREFIX = "t3code";

export const LastInvokedScriptByProjectSchema = Schema.Record(ProjectId, Schema.String);

export function buildLocalDraftThread(
  threadId: ThreadId,
  draftThread: DraftThreadState,
  fallbackModelSelection: ModelSelection,
  error: string | null,
): Thread {
  return {
    id: threadId,
    codexThreadId: null,
    projectId: draftThread.projectId,
    title: "New thread",
    modelSelection: fallbackModelSelection,
    runtimeMode: draftThread.runtimeMode,
    interactionMode: draftThread.interactionMode,
    session: null,
    messages: [],
    error,
    createdAt: draftThread.createdAt,
    latestTurn: null,
    lastVisitedAt: draftThread.createdAt,
    branch: draftThread.branch,
    worktreePath: draftThread.worktreePath,
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
  };
}

export function revokeBlobPreviewUrl(previewUrl: string | undefined): void {
  if (!previewUrl || typeof URL === "undefined" || !previewUrl.startsWith("blob:")) {
    return;
  }
  URL.revokeObjectURL(previewUrl);
}

export function revokeUserMessagePreviewUrls(message: ChatMessage): void {
  if (message.role !== "user" || !message.attachments) {
    return;
  }
  for (const attachment of message.attachments) {
    if (attachment.type !== "image") {
      continue;
    }
    revokeBlobPreviewUrl(attachment.previewUrl);
  }
}

export function collectUserMessageBlobPreviewUrls(message: ChatMessage): string[] {
  if (message.role !== "user" || !message.attachments) {
    return [];
  }
  const previewUrls: string[] = [];
  for (const attachment of message.attachments) {
    if (attachment.type !== "image") continue;
    if (!attachment.previewUrl || !attachment.previewUrl.startsWith("blob:")) continue;
    previewUrls.push(attachment.previewUrl);
  }
  return previewUrls;
}

export type SendPhase = "idle" | "preparing-worktree" | "sending-turn";

export interface PullRequestDialogState {
  initialReference: string | null;
  key: number;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read image data."));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read image."));
    });
    reader.readAsDataURL(file);
  });
}

export function buildTemporaryWorktreeBranchName(): string {
  // Keep the 8-hex suffix shape for backend temporary-branch detection.
  const token = randomUUID().slice(0, 8).toLowerCase();
  return `${WORKTREE_BRANCH_PREFIX}/${token}`;
}

export function cloneComposerImageForRetry(
  image: ComposerImageAttachment,
): ComposerImageAttachment {
  if (typeof URL === "undefined" || !image.previewUrl.startsWith("blob:")) {
    return image;
  }
  try {
    return {
      ...image,
      previewUrl: URL.createObjectURL(image.file),
    };
  } catch {
    return image;
  }
}

export function deriveComposerSendState(options: {
  prompt: string;
  imageCount: number;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
}): {
  trimmedPrompt: string;
  sendableTerminalContexts: TerminalContextDraft[];
  expiredTerminalContextCount: number;
  hasSendableContent: boolean;
} {
  const trimmedPrompt = stripInlineTerminalContextPlaceholders(options.prompt).trim();
  const sendableTerminalContexts = filterTerminalContextsWithText(options.terminalContexts);
  const expiredTerminalContextCount =
    options.terminalContexts.length - sendableTerminalContexts.length;
  return {
    trimmedPrompt,
    sendableTerminalContexts,
    expiredTerminalContextCount,
    hasSendableContent:
      trimmedPrompt.length > 0 || options.imageCount > 0 || sendableTerminalContexts.length > 0,
  };
}

export function buildExpiredTerminalContextToastCopy(
  expiredTerminalContextCount: number,
  variant: "omitted" | "empty",
): { title: string; description: string } {
  const count = Math.max(1, Math.floor(expiredTerminalContextCount));
  const noun = count === 1 ? "Expired terminal context" : "Expired terminal contexts";
  if (variant === "empty") {
    return {
      title: `${noun} won't be sent`,
      description: "Remove it or re-add it to include terminal output.",
    };
  }
  return {
    title: `${noun} omitted from message`,
    description: "Re-add it if you want that terminal output included.",
  };
}

export function resolveVisibleProviderThreadId(thread: Thread | null): string | null {
  if (!thread) {
    return null;
  }

  const sessionProviderThreadId = thread.session?.providerThreadId?.trim();
  if (sessionProviderThreadId) {
    return sessionProviderThreadId;
  }

  const legacyThreadId = thread.codexThreadId?.trim();
  return legacyThreadId ? legacyThreadId : null;
}

export type VisibleProviderHealthStatus =
  | {
      kind: "local";
      status: ServerProviderStatus;
    }
  | {
      kind: "remote";
      status: "info" | "warning" | "error";
      title: string;
      message: string;
    }
  | null;

const SUPPRESSED_REMOTE_THREAD_MANAGEMENT_MESSAGES = [
  "Started a new provider session.",
  "The provider service stopped and can reconnect on the next turn.",
  "Cannot reconnect automatically because no persisted remote provider thread is available.",
  "Automatic reconnect to the persisted remote provider session failed.",
] as const;

function isSuppressedRemoteThreadManagementMessage(message: string | null | undefined): boolean {
  if (!message) {
    return false;
  }
  if (SUPPRESSED_REMOTE_THREAD_MANAGEMENT_MESSAGES.includes(message as never)) {
    return true;
  }
  return message.startsWith("Reconnected to provider thread ");
}

function isOlderThanOrEqualToDismissedAt(
  checkedAt: string | undefined,
  dismissedAt: string | null | undefined,
): boolean {
  if (!checkedAt || !dismissedAt) {
    return false;
  }

  const checkedAtMs = Date.parse(checkedAt);
  const dismissedAtMs = Date.parse(dismissedAt);
  if (!Number.isFinite(checkedAtMs) || !Number.isFinite(dismissedAtMs)) {
    return false;
  }

  return checkedAtMs <= dismissedAtMs;
}

function buildRemoteProviderHealthStatus(input: {
  projectRemote: ProjectRemoteTarget;
  session: ThreadSession | null;
  localProviderStatus: ServerProviderStatus | null;
}): VisibleProviderHealthStatus {
  const hostAlias = input.projectRemote.hostAlias;
  const session = input.session;

  if (!session) {
    if (!input.localProviderStatus || input.localProviderStatus.status === "ready") {
      return null;
    }
    return {
      kind: "remote",
      status: input.localProviderStatus.status === "error" ? "error" : "warning",
      title: "Remote Codex launcher status",
      message:
        input.localProviderStatus.message ??
        `Local Codex is unavailable, so remote sessions on ${hostAlias} cannot start.`,
    };
  }

  switch (session.orchestrationStatus) {
    case "error":
      if (!session.lastError || isSuppressedRemoteThreadManagementMessage(session.lastError)) {
        return null;
      }
      return {
        kind: "remote",
        status: "error",
        title: "Remote Codex session status",
        message: session.lastError ?? `The remote Codex session on ${hostAlias} failed.`,
      };
    case "starting":
    case "stopped":
    case "idle":
    case "disconnected":
      return null;
    case "ready":
    case "running":
    case "interrupted":
      return null;
  }
}

export function resolveVisibleProviderHealthStatus(input: {
  status: ServerProviderStatus | null;
  projectRemote: ProjectRemoteTarget | null;
  session: ThreadSession | null;
  localCodexErrorsDismissedAfter?: string | null;
}): VisibleProviderHealthStatus {
  if (input.projectRemote) {
    return buildRemoteProviderHealthStatus({
      projectRemote: input.projectRemote,
      session: input.session,
      localProviderStatus: input.status,
    });
  }

  if (
    input.status?.provider === "codex" &&
    input.status.status !== "ready" &&
    isOlderThanOrEqualToDismissedAt(input.status.checkedAt, input.localCodexErrorsDismissedAfter)
  ) {
    return null;
  }

  return input.status ? { kind: "local", status: input.status } : null;
}

export function resolveVisibleThreadError(input: {
  thread: Thread | null;
  projectRemote: ProjectRemoteTarget | null;
  localCodexErrorsDismissedAfter?: string | null;
}): string | null {
  const error = input.thread?.error ?? null;
  if (!error) {
    return null;
  }

  if (input.projectRemote) {
    if (isSuppressedRemoteThreadManagementMessage(error)) {
      return null;
    }
    return error;
  }

  const session = input.thread?.session ?? null;
  if (session?.provider !== "codex" || session.lastError !== error) {
    return error;
  }

  return isOlderThanOrEqualToDismissedAt(session.updatedAt, input.localCodexErrorsDismissedAfter)
    ? null
    : error;
}
