import {
  type OrchestrationSessionReconnectState,
  ProjectId,
  type ProjectRemoteTarget,
  type ProviderKind,
  type ServerProviderStatus,
  type ThreadId,
} from "@t3tools/contracts";
import { type ChatMessage, type Thread, type ThreadSession } from "../types";
import { randomUUID } from "~/lib/utils";
import { getAppModelOptions } from "../appSettings";
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
  fallbackModel: string,
  error: string | null,
): Thread {
  return {
    id: threadId,
    codexThreadId: null,
    projectId: draftThread.projectId,
    title: "New thread",
    model: fallbackModel,
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

export function getCustomModelOptionsByProvider(settings: {
  customCodexModels: readonly string[];
}): Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>> {
  return {
    codex: getAppModelOptions("codex", settings.customCodexModels),
  };
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

function buildRemoteReconnectSummary(input: {
  reconnectState?: OrchestrationSessionReconnectState | undefined;
  resumeAvailable?: boolean | undefined;
  reconnectSummary?: string | undefined;
  providerThreadId?: string | undefined;
}): string | null {
  if (input.reconnectSummary) {
    return input.reconnectSummary;
  }

  switch (input.reconnectState) {
    case "resume-thread":
      return input.providerThreadId
        ? `Reconnected to provider thread ${input.providerThreadId}.`
        : "Reconnected to the persisted remote provider session.";
    case "adopt-existing":
      return "Reattached to an existing remote provider session.";
    case "resume-unavailable":
      return "Automatic reconnect is not available for this remote session.";
    case "resume-failed":
      return "Automatic reconnect failed for this remote session.";
    case "fresh-start":
      return null;
    default:
      return input.resumeAvailable && input.providerThreadId
        ? `Resume is available for provider thread ${input.providerThreadId}.`
        : input.resumeAvailable
          ? "Automatic reconnect is available for this remote session."
          : null;
  }
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

  const reconnectSummary = buildRemoteReconnectSummary({
    reconnectState: session.reconnectState,
    reconnectSummary: session.reconnectSummary,
    resumeAvailable: session.resumeAvailable,
    providerThreadId: session.providerThreadId,
  });

  switch (session.orchestrationStatus) {
    case "starting":
      return {
        kind: "remote",
        status: "warning",
        title: "Remote Codex session status",
        message: reconnectSummary ?? `Connecting to the remote Codex session on ${hostAlias}.`,
      };
    case "error":
      return {
        kind: "remote",
        status: "error",
        title: "Remote Codex session status",
        message:
          session.lastError ??
          reconnectSummary ??
          `The remote Codex session on ${hostAlias} failed.`,
      };
    case "stopped":
    case "idle":
      return {
        kind: "remote",
        status: "warning",
        title: "Remote Codex session status",
        message: reconnectSummary ?? `The remote Codex session on ${hostAlias} is disconnected.`,
      };
    case "ready":
    case "running":
    case "interrupted":
      if (!reconnectSummary || session.reconnectState === "fresh-start") {
        return null;
      }
      return {
        kind: "remote",
        status: "info",
        title: "Remote Codex session status",
        message: reconnectSummary,
      };
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
