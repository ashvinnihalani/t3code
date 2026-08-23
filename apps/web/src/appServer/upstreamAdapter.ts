import type {
  EnvironmentProject,
  EnvironmentThread,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  DEFAULT_SERVER_SETTINGS,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  ThreadId,
  TurnId,
  type ModelSelection,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationSession,
  type OrchestrationThreadActivity,
  type ServerConfig,
  type ServerProvider,
} from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";

import { APP_VERSION } from "../branding";
import type { AppServerController } from "./context";
import type { EnvironmentProject as AppServerProject } from "./useAppServerController";
import type {
  ThreadDetail,
  ThreadSettings,
  ThreadSummary,
  ThreadTurn,
  TimelineItem,
} from "./presentation";

const CODEX_INSTANCE_ID = ProviderInstanceId.make("codex");
const CODEX_DRIVER = ProviderDriverKind.make("codex");

function isoTimestamp(value: number): string {
  const milliseconds = value > 0 && value < 10_000_000_000 ? value * 1_000 : value;
  return new Date(milliseconds > 0 ? milliseconds : Date.now()).toISOString();
}

function hashWorkspace(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

export function environmentIdFor(connectionId: string) {
  return EnvironmentId.make(connectionId);
}

export function projectIdForWorkspace(workspace: string) {
  return ProjectId.make(`workspace-${hashWorkspace(workspace)}`);
}

export function isNewAppServerThreadSelection(
  initialThreadId: string | null,
  selectedThreadId: string | null,
): selectedThreadId is string {
  return selectedThreadId !== null && selectedThreadId !== initialThreadId;
}

function workspaceTitle(workspace: string): string {
  const normalized = workspace.replace(/[\\/]+$/u, "");
  return normalized.split(/[\\/]/u).at(-1) || workspace;
}

function threadTitle(thread: ThreadSummary): string {
  return thread.name?.trim() || thread.preview.trim().split("\n")[0] || "Untitled thread";
}

function modelSelection(
  controller: AppServerController,
  connectionId: string,
  settings: ThreadSettings | null,
): ModelSelection {
  const environment = controller.environments.find(
    (candidate) => candidate.profile.id === connectionId,
  );
  const model =
    settings?.model ??
    environment?.models.find((candidate) => candidate.isDefault)?.model ??
    environment?.models[0]?.model ??
    "gpt-5.4";
  const options = [
    ...(settings?.effort ? [{ id: "reasoningEffort", value: settings.effort }] : []),
    ...(settings?.serviceTier ? [{ id: "serviceTier", value: settings.serviceTier }] : []),
  ];
  return {
    instanceId: CODEX_INSTANCE_ID,
    model,
    ...(options.length > 0 ? { options } : {}),
  };
}

function settingsForThread(
  controller: AppServerController,
  connectionId: string,
  thread: ThreadSummary | ThreadDetail,
): ThreadSettings | null {
  if ("settings" in thread && thread.settings) return thread.settings;
  if (
    controller.selectedEnvironmentId === connectionId &&
    controller.thread?.id === thread.id &&
    controller.thread.settings
  ) {
    return controller.thread.settings;
  }
  return (
    controller.environments.find((candidate) => candidate.profile.id === connectionId)?.snapshot
      ?.details[thread.id]?.settings ?? null
  );
}

export function toServerProvider(
  controller: AppServerController,
  connectionId: string,
): ServerProvider {
  const environment = controller.environments.find(
    (candidate) => candidate.profile.id === connectionId,
  );
  return {
    instanceId: CODEX_INSTANCE_ID,
    driver: CODEX_DRIVER,
    displayName: "Codex",
    showInteractionModeToggle: true,
    enabled: true,
    installed: true,
    version: null,
    status:
      environment?.phase === "connected" || (environment?.models.length ?? 0) > 0
        ? "ready"
        : "warning",
    auth: {
      status: environment?.account === null ? "unknown" : "authenticated",
      type: "OpenAI",
    },
    checkedAt: new Date().toISOString(),
    availability: "available",
    models: (environment?.models ?? []).map((model) => ({
      slug: model.model,
      name: model.displayName,
      shortName: model.displayName,
      isCustom: false,
      isDefault: model.isDefault,
      capabilities: {
        optionDescriptors: [
          ...(model.supportedReasoningEfforts.length === 0
            ? []
            : [
                {
                  id: "reasoningEffort",
                  label: "Reasoning",
                  type: "select" as const,
                  currentValue: model.defaultReasoningEffort,
                  options: model.supportedReasoningEfforts.map((effort) => ({
                    id: effort.reasoningEffort,
                    label:
                      effort.reasoningEffort === "xhigh"
                        ? "Extra High"
                        : `${effort.reasoningEffort.charAt(0).toUpperCase()}${effort.reasoningEffort.slice(1)}`,
                    description: effort.description || undefined,
                    isDefault: effort.reasoningEffort === model.defaultReasoningEffort,
                  })),
                },
              ]),
          ...(model.serviceTiers.length === 0
            ? []
            : [
                {
                  id: "serviceTier",
                  label: "Service Tier",
                  type: "select" as const,
                  currentValue: model.defaultServiceTier ?? undefined,
                  options: model.serviceTiers.map((tier) => ({
                    id: tier.id,
                    label: tier.name,
                    description: tier.description || undefined,
                    isDefault: tier.id === model.defaultServiceTier,
                  })),
                },
              ]),
        ],
      },
    })),
    slashCommands: [],
    skills: [],
  };
}

export function toServerConfig(
  controller: AppServerController,
  connectionId: string,
): ServerConfig {
  const environment = controller.environments.find(
    (candidate) => candidate.profile.id === connectionId,
  );
  const profile = environment?.profile;
  return {
    environment: {
      environmentId: environmentIdFor(connectionId),
      label: profile?.name ?? connectionId,
      platform: { os: "unknown", arch: "other" },
      // This config is synthesized by the client adapter; there is no T3
      // server whose version or updater should be presented to the user.
      serverVersion: APP_VERSION,
      capabilities: {
        repositoryIdentity: false,
        connectionProbe: false,
        threadSettlement: false,
        threadSnooze: false,
        threadPinning: false,
        threadPinReorder: false,
        threadTitleRegeneration: false,
      },
    },
    auth: {
      policy: "loopback-browser",
      bootstrapMethods: [],
      sessionMethods: [],
      sessionCookieName: "t3_codex_unused",
    },
    cwd: profile?.connection.workspace ?? "/",
    keybindingsConfigPath: "app-server://keybindings",
    keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
    issues: [],
    providers: [toServerProvider(controller, connectionId)],
    availableEditors: environment?.workspaceOpeners ?? [],
    observability: {
      logsDirectoryPath: profile?.connection.workspace ?? "/",
      localTracingEnabled: false,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: DEFAULT_SERVER_SETTINGS,
  };
}

function latestTurn(turn: ThreadTurn | undefined): OrchestrationLatestTurn | null {
  if (turn === undefined) return null;
  const state =
    turn.status === "inProgress"
      ? "running"
      : turn.status === "failed"
        ? "error"
        : turn.status === "interrupted"
          ? "interrupted"
          : "completed";
  return {
    turnId: TurnId.make(turn.id),
    state,
    requestedAt: isoTimestamp(turn.startedAt ?? 0),
    startedAt: turn.startedAt === null ? null : isoTimestamp(turn.startedAt),
    completedAt: turn.completedAt === null ? null : isoTimestamp(turn.completedAt),
    assistantMessageId: null,
  };
}

function session(
  threadId: string,
  turn: ThreadTurn | undefined,
  runtimeMode: ThreadSettings["runtimeMode"],
): OrchestrationSession | null {
  if (turn === undefined) return null;
  return {
    threadId: ThreadId.make(threadId),
    status:
      turn.status === "inProgress"
        ? "running"
        : turn.status === "failed"
          ? "error"
          : turn.status === "interrupted"
            ? "interrupted"
            : "idle",
    providerName: "Codex",
    providerInstanceId: CODEX_INSTANCE_ID,
    runtimeMode,
    activeTurnId: turn.status === "inProgress" ? TurnId.make(turn.id) : null,
    lastError: turn.error,
    updatedAt: isoTimestamp(turn.completedAt ?? turn.startedAt ?? 0),
  };
}

export function toEnvironmentProject(project: AppServerProject): EnvironmentProject {
  const createdAt = Math.min(...project.threads.map((thread) => thread.createdAt).filter(Boolean));
  const updatedAt = Math.max(...project.threads.map((thread) => thread.updatedAt).filter(Boolean));
  return {
    environmentId: environmentIdFor(project.environmentId),
    id: projectIdForWorkspace(project.cwd),
    title: workspaceTitle(project.cwd),
    workspaceRoot: project.cwd,
    repositoryIdentity: null,
    defaultModelSelection: null,
    // Direct app-server projects always start in their selected workspace.
    // Mark that explicitly so upstream's new-thread flow does not try to
    // resolve a fork-specific t3.json through the removed T3 RPC backend
    // before it can navigate to the draft.
    defaultThreadEnvMode: DEFAULT_SERVER_SETTINGS.defaultThreadEnvMode,
    faviconPath: null,
    scripts: [],
    createdAt: isoTimestamp(Number.isFinite(createdAt) ? createdAt : 0),
    updatedAt: isoTimestamp(Number.isFinite(updatedAt) ? updatedAt : 0),
  };
}

export function toEnvironmentThreadShell(
  controller: AppServerController,
  connectionId: string,
  thread: ThreadSummary,
): EnvironmentThreadShell {
  const settings = settingsForThread(controller, connectionId, thread);
  const activeTurn =
    controller.thread?.id === thread.id
      ? controller.thread.turns.findLast((turn) => turn.status === "inProgress")
      : undefined;
  const lastTurn =
    activeTurn ??
    (controller.thread?.id === thread.id ? controller.thread.turns.at(-1) : undefined);
  return {
    environmentId: environmentIdFor(connectionId),
    id: ThreadId.make(thread.id),
    projectId: projectIdForWorkspace(thread.cwd),
    title: threadTitle(thread),
    modelSelection: modelSelection(controller, connectionId, settings),
    runtimeMode: settings?.runtimeMode ?? "full-access",
    interactionMode: settings?.interactionMode ?? "default",
    branch: null,
    worktreePath: null,
    latestTurn: latestTurn(lastTurn),
    createdAt: isoTimestamp(thread.createdAt),
    updatedAt: isoTimestamp(thread.updatedAt),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    pinOrderKey: null,
    titleRegeneration: null,
    session: session(thread.id, lastTurn, settings?.runtimeMode ?? "full-access"),
    latestUserMessageAt: null,
    hasPendingApprovals:
      controller.pendingApproval?.environmentId === connectionId &&
      controller.pendingApproval.threadId === thread.id,
    hasPendingUserInput:
      controller.pendingUserInput?.environmentId === connectionId &&
      controller.pendingUserInput.threadId === thread.id,
    hasActionableProposedPlan: false,
    backgroundLiveness: null,
    planProgress: null,
  };
}

function messageFromItem(
  turn: ThreadTurn,
  item: TimelineItem,
  index: number,
): OrchestrationMessage | null {
  const role =
    item.type === "userMessage"
      ? "user"
      : item.type === "agentMessage" || item.type === "plan"
        ? "assistant"
        : null;
  if (role === null) return null;
  const timestamp = isoTimestamp(turn.startedAt ?? 0);
  return {
    id: MessageId.make(item.id || `${turn.id}-message-${String(index)}`),
    role,
    text: item.text,
    attachments: [],
    turnId: TurnId.make(turn.id),
    streaming: role === "assistant" && turn.status === "inProgress",
    createdAt: timestamp,
    updatedAt: isoTimestamp(turn.completedAt ?? turn.startedAt ?? 0),
  };
}

function activityFromItem(
  turn: ThreadTurn,
  item: TimelineItem,
  index: number,
): OrchestrationThreadActivity | null {
  if (item.type === "userMessage" || item.type === "agentMessage" || item.type === "plan") {
    return null;
  }
  return {
    id: EventId.make(item.id || `${turn.id}-activity-${String(index)}`),
    tone: item.status === "failed" ? "error" : "tool",
    kind: item.type,
    summary: item.title || item.detail || item.type,
    payload: { text: item.text, detail: item.detail, status: item.status },
    turnId: TurnId.make(turn.id),
    createdAt: isoTimestamp(turn.startedAt ?? 0),
  };
}

export function toEnvironmentThread(
  controller: AppServerController,
  connectionId: string,
  detail: ThreadDetail,
): EnvironmentThread {
  const shell = toEnvironmentThreadShell(controller, connectionId, detail);
  const messages = detail.turns.flatMap((turn) =>
    turn.items.flatMap((item, index) => {
      const message = messageFromItem(turn, item, index);
      return message === null ? [] : [message];
    }),
  );
  const timelineActivities = detail.turns.flatMap((turn) =>
    turn.items.flatMap((item, index) => {
      const activity = activityFromItem(turn, item, index);
      return activity === null ? [] : [activity];
    }),
  );
  const approval =
    controller.pendingApproval?.environmentId === connectionId &&
    controller.pendingApproval.threadId === detail.id
      ? controller.pendingApproval
      : null;
  const userInput =
    controller.pendingUserInput?.environmentId === connectionId &&
    controller.pendingUserInput.threadId === detail.id
      ? controller.pendingUserInput
      : null;
  const approvalActivities =
    approval === null
      ? timelineActivities
      : [
          ...timelineActivities,
          {
            id: EventId.make(`approval-${approval.id}`),
            tone: "approval" as const,
            kind: "approval.requested",
            summary:
              approval.kind === "command"
                ? "Command approval requested"
                : "File-change approval requested",
            payload: {
              requestId: approval.id,
              requestKind: approval.kind === "command" ? "command" : "file-change",
              detail: approval.reason ?? approval.detail ?? approval.title,
            },
            turnId: detail.turns.at(-1)?.id ? TurnId.make(detail.turns.at(-1)!.id) : null,
            createdAt: isoTimestamp(approval.createdAt),
          },
        ];
  const activities =
    userInput === null
      ? approvalActivities
      : [
          ...approvalActivities,
          {
            id: EventId.make(`user-input-${userInput.id}`),
            tone: "info" as const,
            kind: "user-input.requested",
            summary: "User input requested",
            payload: { requestId: userInput.id, questions: userInput.questions },
            turnId: detail.turns.at(-1)?.id ? TurnId.make(detail.turns.at(-1)!.id) : null,
            createdAt: isoTimestamp(userInput.createdAt),
          },
        ];
  return {
    environmentId: shell.environmentId,
    id: shell.id,
    projectId: shell.projectId,
    title: shell.title,
    modelSelection: shell.modelSelection,
    runtimeMode: shell.runtimeMode,
    interactionMode: shell.interactionMode,
    branch: shell.branch,
    worktreePath: shell.worktreePath,
    latestTurn: shell.latestTurn,
    createdAt: shell.createdAt,
    updatedAt: shell.updatedAt,
    archivedAt: shell.archivedAt,
    settledOverride: shell.settledOverride,
    settledAt: shell.settledAt,
    snoozedUntil: shell.snoozedUntil,
    snoozedAt: shell.snoozedAt,
    pinnedAt: shell.pinnedAt,
    pinOrderKey: shell.pinOrderKey,
    titleRegeneration: shell.titleRegeneration,
    deletedAt: null,
    messages,
    proposedPlans: [],
    activities,
    checkpoints: [],
    session: shell.session,
  };
}
