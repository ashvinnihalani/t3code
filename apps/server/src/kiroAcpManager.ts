import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  ApprovalRequestId,
  EventId,
  type ProviderEvent,
  type ProviderRequestKind,
  type ProviderApprovalDecision,
  type ProviderInteractionMode,
  ProviderItemId,
  ThreadId,
  TurnId,
  type ProviderSession,
} from "@t3tools/contracts";

import { buildSshExecArgs } from "./sshCommand.ts";
import type { ProjectRemoteTarget } from "@t3tools/contracts";

const PROVIDER = "kiro" as const;
const DEFAULT_BINARY_PATH = "kiro-cli";
const KIRO_CANCEL_TIMEOUT_MS = 5_000;
const KIRO_CANCEL_GRACE_PERIOD_MS = 5_000;

interface KiroModeDescriptor {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
}

interface KiroModeState {
  readonly currentModeId: string | undefined;
  readonly defaultModeId: string | undefined;
  readonly availableModes: ReadonlyArray<KiroModeDescriptor>;
}

interface KiroModelDescriptor {
  readonly modelId: string;
  readonly name?: string;
  readonly description?: string;
}

interface KiroModelState {
  readonly currentModelId: string | undefined;
  readonly availableModels: ReadonlyArray<KiroModelDescriptor>;
}

interface KiroCommandsSnapshot {
  readonly commands: ReadonlyArray<Record<string, unknown>>;
  readonly prompts: ReadonlyArray<Record<string, unknown>>;
  readonly tools: ReadonlyArray<Record<string, unknown>>;
  readonly mcpServers: ReadonlyArray<Record<string, unknown>>;
}

interface PendingPermissionRequest {
  readonly rpcRequestId: number | string;
  readonly requestId: ApprovalRequestId;
  readonly toolCallId: string | undefined;
  readonly requestKind: ProviderRequestKind | undefined;
  readonly method: string;
  readonly options: ReadonlyArray<{
    readonly optionId: string;
    readonly kind?: string;
  }>;
}

interface KiroTurnSnapshot {
  readonly id: TurnId;
  readonly items: ReadonlyArray<unknown>;
}

interface KiroSessionState {
  readonly threadId: ThreadId;
  readonly process: ChildProcessWithoutNullStreams;
  rpc: JsonRpcConnection;
  readonly runtimeMode: ProviderSession["runtimeMode"];
  readonly cwd: string | undefined;
  createdAt: string;
  updatedAt: string;
  status: ProviderSession["status"];
  model: string | undefined;
  sessionId: string | undefined;
  activeTurnId: TurnId | undefined;
  modeState: KiroModeState;
  modelState: KiroModelState;
  commandsSnapshot: KiroCommandsSnapshot;
  turns: Array<KiroTurnSnapshot>;
  pendingPermissionRequests: Map<string, PendingPermissionRequest>;
  suppressReplay: boolean;
}

interface JsonRpcRequestMessage {
  readonly jsonrpc: "2.0";
  readonly id: number | string;
  readonly method: string;
  readonly params?: unknown;
}

interface JsonRpcNotificationMessage {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: unknown;
}

interface JsonRpcResponseMessage {
  readonly jsonrpc: "2.0";
  readonly id: number | string | null;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

type JsonRpcMessage = JsonRpcRequestMessage | JsonRpcNotificationMessage | JsonRpcResponseMessage;

function nowIso(): string {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asArray(value: unknown): ReadonlyArray<unknown> | undefined {
  return Array.isArray(value) ? value : undefined;
}

function normalizeNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function readKiroTextChunk(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value.trim().length > 0 ? value : undefined;
}

function truncateProcessDetail(detail: string, maxLength = 1_024): string {
  if (detail.length <= maxLength) {
    return detail;
  }
  return `${detail.slice(0, maxLength - 1).trimEnd()}…`;
}

export function formatKiroProcessExitMessage(input: {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly command: string;
}): string {
  const baseMessage = input.signal
    ? `Kiro ACP process exited with signal ${input.signal} while running '${input.command}'.`
    : `Kiro ACP process exited with code ${input.code ?? -1} while running '${input.command}'.`;
  const stderr = input.stderr.trim();
  const lowerStderr = stderr.toLowerCase();
  const commandMissing =
    input.code === 127 ||
    lowerStderr.includes("command not found") ||
    lowerStderr.includes("not recognized as an internal or external command");
  const detail = stderr.length > 0 ? ` stderr: ${truncateProcessDetail(stderr)}` : "";
  const hint = commandMissing
    ? " Set the Kiro binary path to the full `kiro-cli` executable path if it is not on PATH."
    : "";
  return `${baseMessage}${detail}${hint}`;
}

function isIgnorableCancelError(cause: unknown): boolean {
  if (!(cause instanceof Error)) {
    return false;
  }
  const normalized = cause.message.trim().toLowerCase();
  return normalized === "internal error" || normalized.includes("nothing to cancel");
}

function timeoutAfter(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });
}

function resumeCursorFromSessionId(sessionId: string | undefined): unknown {
  return sessionId ? { sessionId, threadId: sessionId } : undefined;
}

function readResumeSessionId(resumeCursor: unknown): string | undefined {
  if (!resumeCursor || typeof resumeCursor !== "object" || Array.isArray(resumeCursor)) {
    return undefined;
  }
  return normalizeNonEmpty(
    (resumeCursor as Record<string, unknown>).sessionId as string | undefined,
  );
}

function modeTokens(mode: KiroModeDescriptor): string {
  return [mode.id, mode.name, mode.description]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
}

function interactionModeFromModeDescriptor(mode: KiroModeDescriptor): ProviderInteractionMode {
  const tokens = modeTokens(mode);
  if (tokens.includes("help")) return "help";
  if (tokens.includes("plan") || tokens.includes("architect") || tokens.includes("planner")) {
    return "plan";
  }
  return "default";
}

function defaultModeId(modeState: KiroModeState): string | undefined {
  if (modeState.defaultModeId) return modeState.defaultModeId;
  const currentMode = modeState.availableModes.find((mode) => mode.id === modeState.currentModeId);
  if (currentMode && interactionModeFromModeDescriptor(currentMode) === "default") {
    return currentMode.id;
  }
  return modeState.availableModes.find(
    (mode) => interactionModeFromModeDescriptor(mode) === "default",
  )?.id;
}

function resolveInteractionMode(modeState: KiroModeState): ProviderInteractionMode | undefined {
  const currentMode = modeState.availableModes.find((mode) => mode.id === modeState.currentModeId);
  return currentMode ? interactionModeFromModeDescriptor(currentMode) : undefined;
}

function resolveModeIdForInteractionMode(
  modeState: KiroModeState,
  interactionMode: ProviderInteractionMode,
): string | undefined {
  if (interactionMode === "default") {
    return defaultModeId(modeState) ?? modeState.currentModeId;
  }
  return modeState.availableModes.find(
    (mode) => interactionModeFromModeDescriptor(mode) === interactionMode,
  )?.id;
}

function extractModeState(value: unknown): KiroModeState | undefined {
  const result = asRecord(value);
  const modes = asRecord(result?.modes);
  if (!modes) return undefined;
  const availableModes = (asArray(modes.availableModes) ?? [])
    .map((entry) => {
      const mode = asRecord(entry);
      const id = normalizeNonEmpty(asString(mode?.id));
      if (!id) return undefined;
      const descriptor: { id: string; name?: string; description?: string } = { id };
      const name = normalizeNonEmpty(asString(mode?.name));
      const description = normalizeNonEmpty(asString(mode?.description));
      if (name) {
        descriptor.name = name;
      }
      if (description) {
        descriptor.description = description;
      }
      return descriptor;
    })
    .filter((mode): mode is KiroModeDescriptor => mode !== undefined);
  if (availableModes.length === 0) return undefined;
  const currentModeId = normalizeNonEmpty(asString(modes.currentModeId));
  const inferredDefaultModeId =
    availableModes.find((mode) => interactionModeFromModeDescriptor(mode) === "default")?.id ??
    currentModeId;
  return {
    currentModeId,
    defaultModeId: inferredDefaultModeId,
    availableModes,
  };
}

function extractModelState(value: unknown): KiroModelState | undefined {
  const result = asRecord(value);
  const models = asRecord(result?.models);
  if (!models) return undefined;
  const availableModels = (asArray(models.availableModels) ?? [])
    .map((entry) => {
      const model = asRecord(entry);
      const modelId = normalizeNonEmpty(asString(model?.modelId));
      if (!modelId) return undefined;
      const descriptor: { modelId: string; name?: string; description?: string } = { modelId };
      const name = normalizeNonEmpty(asString(model?.name));
      const description = normalizeNonEmpty(asString(model?.description));
      if (name) {
        descriptor.name = name;
      }
      if (description) {
        descriptor.description = description;
      }
      return descriptor;
    })
    .filter((model): model is KiroModelDescriptor => model !== undefined);
  return {
    currentModelId: normalizeNonEmpty(asString(models.currentModelId)),
    availableModels,
  };
}

function emptyCommandsSnapshot(): KiroCommandsSnapshot {
  return {
    commands: [],
    prompts: [],
    tools: [],
    mcpServers: [],
  };
}

function extractCommandsSnapshot(value: unknown): KiroCommandsSnapshot | undefined {
  const result = asRecord(value);
  if (!result) return undefined;
  return {
    commands: (asArray(result.commands) ?? []).flatMap((entry) => {
      const record = asRecord(entry);
      return record ? [record] : [];
    }),
    prompts: (asArray(result.prompts) ?? []).flatMap((entry) => {
      const record = asRecord(entry);
      return record ? [record] : [];
    }),
    tools: (asArray(result.tools) ?? []).flatMap((entry) => {
      const record = asRecord(entry);
      return record ? [record] : [];
    }),
    mcpServers: (asArray(result.mcpServers) ?? []).flatMap((entry) => {
      const record = asRecord(entry);
      return record ? [record] : [];
    }),
  };
}

function permissionRequestKind(kind: string | undefined): ProviderRequestKind | undefined {
  switch ((kind ?? "").toLowerCase()) {
    case "execute":
    case "switch_mode":
      return "command";
    case "read":
      return "file-read";
    case "edit":
    case "move":
    case "delete":
      return "file-change";
    default:
      return undefined;
  }
}

function permissionRequestMethod(kind: string | undefined): string {
  const requestKind = permissionRequestKind(kind);
  switch (requestKind) {
    case "command":
      return "item/commandExecution/requestApproval";
    case "file-read":
      return "item/fileRead/requestApproval";
    case "file-change":
      return "item/fileChange/requestApproval";
    default:
      return "item/requestApproval";
  }
}

function toolItemType(kind: string | undefined): string {
  switch ((kind ?? "").toLowerCase()) {
    case "execute":
      return "commandExecution";
    case "edit":
    case "move":
    case "delete":
      return "fileChange";
    case "search":
    case "fetch":
      return "webSearch";
    default:
      return "dynamicToolCall";
  }
}

function permissionDecisionForOptionKinds(
  options: ReadonlyArray<{ readonly optionId: string; readonly kind?: string }>,
  decision: ProviderApprovalDecision,
):
  | { readonly outcome: { readonly outcome: "selected"; readonly optionId: string } }
  | {
      readonly outcome: { readonly outcome: "cancelled" };
    } {
  if (decision === "cancel") {
    return { outcome: { outcome: "cancelled" } };
  }

  const preferredKinds =
    decision === "acceptForSession"
      ? ["allow_always", "allow_once"]
      : decision === "accept"
        ? ["allow_once", "allow_always"]
        : ["reject_once", "reject_always"];
  const preferred = preferredKinds
    .map((kind) => options.find((option) => option.kind === kind))
    .find((option) => option !== undefined);
  const fallback = decision === "decline" ? options[0] : options[0];
  const selected = preferred ?? fallback;
  if (!selected) {
    return { outcome: { outcome: "cancelled" } };
  }
  return { outcome: { outcome: "selected", optionId: selected.optionId } };
}

function autoApproveDecisionForRuntimeMode(
  runtimeMode: ProviderSession["runtimeMode"],
): ProviderApprovalDecision | undefined {
  return runtimeMode === "full-access" ? "acceptForSession" : undefined;
}

export function buildKiroAcpArgs(input: {
  readonly runtimeMode: ProviderSession["runtimeMode"];
  readonly model?: string;
}): ReadonlyArray<string> {
  return [
    "acp",
    ...(input.model ? ["--model", input.model] : []),
    ...(input.runtimeMode === "full-access" ? ["--trust-all-tools"] : []),
  ];
}

function buildPromptBlocks(input: {
  readonly text?: string;
  readonly attachments?: ReadonlyArray<{ readonly mimeType: string; readonly data: string }>;
}): ReadonlyArray<Record<string, unknown>> {
  const prompt: Array<Record<string, unknown>> = [];
  const normalizedText = normalizeNonEmpty(input.text);
  if (normalizedText) {
    prompt.push({
      type: "text",
      text: normalizedText,
    });
  }
  for (const attachment of input.attachments ?? []) {
    prompt.push({
      type: "image",
      mimeType: attachment.mimeType,
      data: attachment.data,
    });
  }
  return prompt;
}

class JsonRpcConnection {
  private nextRequestId = 1;
  private readonly pending = new Map<
    number,
    {
      readonly resolve: (value: unknown) => void;
      readonly reject: (error: Error) => void;
    }
  >();
  private buffer = "";
  private stderrBuffer = "";

  constructor(
    private readonly process: ChildProcessWithoutNullStreams,
    private readonly command: string,
    private readonly onRequest: (message: JsonRpcRequestMessage) => void,
    private readonly onNotification: (method: string, params: unknown) => void,
    private readonly onClosed: (error?: Error) => void,
  ) {
    this.process.stdout.setEncoding("utf8");
    this.process.stderr.setEncoding("utf8");
    this.process.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.drainBuffer();
    });
    this.process.stderr.on("data", (chunk: string) => {
      this.stderrBuffer += chunk;
    });
    this.process.on("exit", (code, signal) => {
      const error =
        code === 0 && signal === null
          ? undefined
          : new Error(
              formatKiroProcessExitMessage({
                code,
                signal,
                stderr: this.stderrBuffer,
                command: this.command,
              }),
            );
      this.closePending(error);
      this.onClosed(error);
    });
    this.process.on("error", (error) => {
      this.closePending(error instanceof Error ? error : new Error(String(error)));
      this.onClosed(error instanceof Error ? error : new Error(String(error)));
    });
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextRequestId++;
    this.write({
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  respond(
    id: number | string,
    result?: unknown,
    error?: { code: number; message: string; data?: unknown },
  ): void {
    this.write({
      jsonrpc: "2.0",
      id,
      ...(error ? { error } : { result: result ?? null }),
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({
      jsonrpc: "2.0",
      method,
      ...(params !== undefined ? { params } : {}),
    });
  }

  private write(message: Record<string, unknown>): void {
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private drainBuffer(): void {
    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcMessage | undefined;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }
    if (!message || message.jsonrpc !== "2.0") return;
    if ("method" in message) {
      if ("id" in message) {
        this.onRequest(message);
        return;
      }
      this.onNotification(message.method, message.params);
      return;
    }
    if (typeof message.id !== "number") {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message));
      return;
    }
    pending.resolve(message.result);
  }

  private closePending(error?: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error ?? new Error("Kiro ACP connection closed."));
    }
    this.pending.clear();
  }
}

export interface KiroAcpStartSessionInput {
  readonly threadId: ThreadId;
  readonly runtimeMode: ProviderSession["runtimeMode"];
  readonly cwd?: string;
  readonly model?: string;
  readonly resumeCursor?: unknown;
  readonly binaryPath?: string;
  readonly remote?: ProjectRemoteTarget;
}

export interface KiroAcpSendTurnInput {
  readonly threadId: ThreadId;
  readonly input?: string;
  readonly attachments?: ReadonlyArray<{ readonly mimeType: string; readonly data: string }>;
  readonly model?: string;
  readonly interactionMode?: ProviderInteractionMode;
}

export class KiroAcpManager extends EventEmitter {
  private readonly sessions = new Map<string, KiroSessionState>();

  listSessions(): ProviderSession[] {
    const sessions: ProviderSession[] = [];
    for (const session of this.sessions.values()) {
      const resumeCursor = resumeCursorFromSessionId(session.sessionId);
      sessions.push({
        provider: PROVIDER,
        status: session.status,
        runtimeMode: session.runtimeMode,
        ...(session.cwd ? { cwd: session.cwd } : {}),
        ...(session.model ? { model: session.model } : {}),
        threadId: session.threadId,
        ...(resumeCursor ? { resumeCursor } : {}),
        ...(session.activeTurnId ? { activeTurnId: session.activeTurnId } : {}),
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });
    }
    return sessions;
  }

  hasSession(threadId: ThreadId): boolean {
    return this.sessions.has(threadId);
  }

  async startSession(input: KiroAcpStartSessionInput): Promise<ProviderSession> {
    this.stopSession(input.threadId);
    const binaryPath = input.binaryPath ?? DEFAULT_BINARY_PATH;
    const { process, command } = this.spawnProcess({
      binaryPath,
      runtimeMode: input.runtimeMode,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.remote ? { remote: input.remote } : {}),
    });

    const now = nowIso();
    let session: KiroSessionState = {
      threadId: input.threadId,
      process,
      rpc: undefined as never,
      runtimeMode: input.runtimeMode,
      cwd: input.cwd,
      createdAt: now,
      updatedAt: now,
      status: "connecting",
      model: input.model,
      sessionId: undefined,
      activeTurnId: undefined,
      modeState: {
        currentModeId: undefined,
        defaultModeId: undefined,
        availableModes: [],
      },
      modelState: {
        currentModelId: input.model,
        availableModels: [],
      },
      commandsSnapshot: emptyCommandsSnapshot(),
      turns: [],
      pendingPermissionRequests: new Map(),
      suppressReplay: false,
    };
    const rpc = new JsonRpcConnection(
      process,
      command,
      (message) => {
        if (session) {
          void this.handleRequest(session, message);
        }
      },
      (method, params) => {
        if (session) {
          void this.handleNotification(session, method, params);
        }
      },
      (error) => {
        if (!session) return;
        session.status = error ? "error" : "closed";
        session.updatedAt = nowIso();
        this.emitSessionEvent(
          session,
          "session/exited",
          error?.message ?? `Kiro ACP process exited (${error ? "error" : "graceful"} shutdown).`,
          {
            exitKind: error ? "error" : "graceful",
            ...(error ? { reason: error.message } : {}),
          },
        );
        this.sessions.delete(session.threadId);
      },
    );
    session.rpc = rpc;
    this.emitSessionEvent(session, "session/connecting", `Starting ${command}`);

    const initializeResult = await rpc.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: {
          readTextFile: false,
          writeTextFile: false,
        },
        terminal: false,
      },
      clientInfo: {
        name: "t3code",
        title: "T3 Code",
        version: "0.0.0",
      },
    });
    this.emitNotificationEvent(session, "session/configured", {
      config: {
        initialize: initializeResult,
      },
    });

    const resumeSessionId = readResumeSessionId(input.resumeCursor);
    if (resumeSessionId) {
      session.sessionId = resumeSessionId;
      session.suppressReplay = true;
      try {
        const loadResult = await rpc.request("session/load", {
          sessionId: resumeSessionId,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          mcpServers: [],
        });
        this.applySessionBootstrap(session, loadResult);
        console.log("kiro session/load response", loadResult);
      } catch (error) {
        process.kill();
        throw error;
      } finally {
        session.suppressReplay = false;
      }
    } else {
      const created = asRecord(
        await rpc.request("session/new", {
          ...(input.cwd ? { cwd: input.cwd } : {}),
          mcpServers: [],
        }),
      );
      console.log("kiro session/new response", created);
      const sessionId = normalizeNonEmpty(asString(created?.sessionId));
      if (sessionId) {
        session.sessionId = sessionId;
      }
      this.applySessionBootstrap(session, created);
    }

    if (!session.sessionId) {
      process.kill();
      throw new Error("Kiro ACP session did not return a sessionId.");
    }

    session.status = "ready";
    session.updatedAt = nowIso();
    this.sessions.set(session.threadId, session);
    if (input.model && input.model !== session.model) {
      await this.setModel(session, input.model);
    }

    const accountSnapshot = readKiroAccountSnapshot({
      binaryPath,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.remote ? { remote: input.remote } : {}),
    });
    if (accountSnapshot !== undefined) {
      console.log("kiro account/read response", accountSnapshot);
      this.emitNotificationEvent(session, "account/updated", accountSnapshot);
    }

    console.log("kiro model/list response", {
      currentModelId: session.modelState.currentModelId ?? null,
      availableModels: session.modelState.availableModels,
    });
    this.emitSessionEvent(session, "session/started", "Kiro ACP session started", {
      resume: resumeCursorFromSessionId(session.sessionId),
    });
    this.emitNotificationEvent(session, "thread/started", {
      threadId: session.sessionId,
    });
    this.emitMetadataSnapshot(session);

    return {
      provider: PROVIDER,
      status: session.status,
      runtimeMode: session.runtimeMode,
      ...(session.cwd ? { cwd: session.cwd } : {}),
      ...(session.model ? { model: session.model } : {}),
      threadId: session.threadId,
      resumeCursor: resumeCursorFromSessionId(session.sessionId),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  async sendTurn(
    input: KiroAcpSendTurnInput,
  ): Promise<{ threadId: ThreadId; turnId: TurnId; resumeCursor?: unknown }> {
    const session = this.requireSession(input.threadId);
    if (input.model && input.model !== session.model) {
      await this.setModel(session, input.model);
    }
    if (input.interactionMode) {
      await this.setInteractionMode(session, input.interactionMode);
    }

    const turnId = TurnId.makeUnsafe(`kiro:${crypto.randomUUID()}`);
    session.activeTurnId = turnId;
    session.updatedAt = nowIso();
    session.turns.push({
      id: turnId,
      items: [],
    });
    this.emitNotificationEvent(
      session,
      "turn/started",
      {
        turn: {
          id: turnId,
          ...(session.model ? { model: session.model } : {}),
        },
      },
      { turnId },
    );

    await session.rpc
      .request("session/prompt", {
        sessionId: session.sessionId,
        prompt: buildPromptBlocks({
          ...(input.input !== undefined ? { text: input.input } : {}),
          ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
        }),
      })
      .then(
        (result) => {
          const payload = asRecord(result);
          const stopReason = normalizeNonEmpty(asString(payload?.stopReason));
          this.completeTurn(session, turnId, {
            state: "completed",
            ...(stopReason ? { stopReason } : {}),
          });
        },
        (error) => {
          if (session.activeTurnId !== turnId) {
            return;
          }
          this.completeTurn(session, turnId, {
            state: "failed",
            errorMessage: error instanceof Error ? error.message : String(error),
          });
          throw error;
        },
      );

    return {
      threadId: input.threadId,
      turnId,
      resumeCursor: resumeCursorFromSessionId(session.sessionId),
    };
  }

  async interruptTurn(threadId: ThreadId): Promise<void> {
    const session = this.requireSession(threadId);
    const turnId = session.activeTurnId;
    if (!turnId) {
      return;
    }
    try {
      await Promise.race([
        session.rpc.request("session/cancel", {
          sessionId: session.sessionId,
        }),
        timeoutAfter(
          KIRO_CANCEL_TIMEOUT_MS,
          `Timed out waiting for session/cancel after ${KIRO_CANCEL_TIMEOUT_MS}ms.`,
        ),
      ]);
    } catch (error) {
      if (isIgnorableCancelError(error)) {
        this.forceAbortTurnAndStopSession(
          session,
          turnId,
          "Kiro ACP could not cancel the active turn. Stopped the stuck session instead.",
        );
        return;
      }
      this.forceAbortTurnAndStopSession(
        session,
        turnId,
        error instanceof Error
          ? error.message
          : "Kiro ACP failed to cancel the active turn. Stopped the stuck session instead.",
      );
      return;
    }

    const interruptedGracefully = await this.waitForTurnToClear(
      session,
      turnId,
      KIRO_CANCEL_GRACE_PERIOD_MS,
    );
    if (interruptedGracefully) {
      return;
    }

    this.forceAbortTurnAndStopSession(
      session,
      turnId,
      "Kiro ACP did not stop after cancel. Stopped the stuck session instead.",
    );
  }

  async respondToRequest(
    threadId: ThreadId,
    requestId: string,
    decision: ProviderApprovalDecision,
  ): Promise<void> {
    const session = this.requireSession(threadId);
    const pending = session.pendingPermissionRequests.get(requestId);
    if (!pending) {
      throw new Error(`Unknown pending permission request: ${requestId}`);
    }
    session.pendingPermissionRequests.delete(requestId);
    session.rpc.respond(
      pending.rpcRequestId,
      permissionDecisionForOptionKinds(pending.options, decision),
    );
    this.emitNotificationEvent(
      session,
      "item/requestApproval/decision",
      {
        requestId,
        ...(pending.requestKind ? { requestKind: pending.requestKind } : {}),
        decision,
      },
      {
        ...(session.activeTurnId ? { turnId: session.activeTurnId } : {}),
        ...(pending.toolCallId ? { itemId: ProviderItemId.makeUnsafe(pending.toolCallId) } : {}),
        requestId: pending.requestId,
        ...(pending.requestKind ? { requestKind: pending.requestKind } : {}),
      },
    );
  }

  async respondToUserInput(): Promise<void> {
    throw new Error("Kiro ACP does not support structured user-input responses.");
  }

  readThread(threadId: ThreadId): { threadId: ThreadId; turns: ReadonlyArray<KiroTurnSnapshot> } {
    const session = this.requireSession(threadId);
    return {
      threadId,
      turns: session.turns,
    };
  }

  async rollbackThread(threadId: ThreadId): Promise<never> {
    throw new Error(`Kiro rollback is not supported for thread ${threadId}.`);
  }

  stopSession(threadId: ThreadId): void {
    const session = this.sessions.get(threadId);
    if (!session) return;
    this.sessions.delete(threadId);
    try {
      session.process.kill();
    } catch {
      // Ignore process shutdown failures during cleanup.
    }
  }

  stopAll(): void {
    for (const threadId of this.sessions.keys()) {
      this.stopSession(ThreadId.makeUnsafe(threadId));
    }
  }

  private spawnProcess(input: {
    readonly binaryPath: string;
    readonly runtimeMode: ProviderSession["runtimeMode"];
    readonly cwd?: string;
    readonly model?: string;
    readonly remote?: ProjectRemoteTarget;
  }): { readonly process: ChildProcessWithoutNullStreams; readonly command: string } {
    const acpArgs = buildKiroAcpArgs({
      runtimeMode: input.runtimeMode,
      ...(input.model ? { model: input.model } : {}),
    });
    if (input.remote?.kind === "ssh") {
      return {
        process: spawn(
          "ssh",
          buildSshExecArgs({
            hostAlias: input.remote.hostAlias,
            command: input.binaryPath,
            args: acpArgs,
            ...(input.cwd ? { cwd: input.cwd } : {}),
            localCwd: process.cwd(),
          }),
          {
            cwd: process.cwd(),
            env: process.env,
            stdio: ["pipe", "pipe", "pipe"],
            shell: process.platform === "win32",
          },
        ),
        command: `ssh ${input.remote.hostAlias} ${input.binaryPath} ${acpArgs.join(" ")}`,
      };
    }

    return {
      process: spawn(input.binaryPath, acpArgs, {
        cwd: input.cwd ?? process.cwd(),
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
        shell: process.platform === "win32",
      }),
      command: `${input.binaryPath} ${acpArgs.join(" ")}`,
    };
  }

  private completeTurn(
    session: KiroSessionState,
    turnId: TurnId,
    payload: {
      readonly state: "completed" | "failed" | "cancelled";
      readonly stopReason?: string;
      readonly errorMessage?: string;
    },
  ): boolean {
    if (session.activeTurnId !== turnId) {
      return false;
    }

    session.activeTurnId = undefined;
    session.updatedAt = nowIso();
    this.emitNotificationEvent(
      session,
      "turn/completed",
      {
        turn: {
          id: turnId,
          status: payload.state,
          ...(payload.stopReason ? { stopReason: payload.stopReason } : {}),
          ...(payload.errorMessage
            ? {
                error: {
                  message: payload.errorMessage,
                },
              }
            : {}),
        },
      },
      { turnId },
    );
    return true;
  }

  private abortTurn(session: KiroSessionState, turnId: TurnId, reason: string): boolean {
    if (session.activeTurnId !== turnId) {
      return false;
    }

    session.activeTurnId = undefined;
    session.updatedAt = nowIso();
    this.emitNotificationEvent(
      session,
      "turn/aborted",
      {
        reason,
      },
      { turnId },
    );
    return true;
  }

  private turnCompletionFromUpdate(update: Record<string, unknown>): {
    readonly state: "completed" | "failed" | "cancelled";
    readonly stopReason?: string;
    readonly errorMessage?: string;
  } {
    const status = normalizeNonEmpty(asString(update.status))?.toLowerCase();
    const errorRecord = asRecord(update.error);
    const errorMessage =
      normalizeNonEmpty(asString(errorRecord?.message)) ??
      normalizeNonEmpty(asString(update.message));
    const stopReason = normalizeNonEmpty(asString(update.stopReason));

    if (status === "failed" || status === "error" || errorMessage) {
      return {
        state: "failed",
        ...(errorMessage ? { errorMessage } : {}),
        ...(stopReason ? { stopReason } : {}),
      };
    }

    if (
      status === "cancelled" ||
      status === "canceled" ||
      status === "aborted" ||
      status === "interrupted"
    ) {
      return {
        state: "cancelled",
        ...(stopReason ? { stopReason } : {}),
      };
    }

    return {
      state: "completed",
      ...(stopReason ? { stopReason } : {}),
    };
  }

  private requireSession(threadId: ThreadId): KiroSessionState {
    const session = this.sessions.get(threadId);
    if (!session) {
      throw new Error(`Unknown Kiro ACP session for thread ${threadId}`);
    }
    return session;
  }

  private async waitForTurnToClear(
    session: KiroSessionState,
    turnId: TurnId,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (session.activeTurnId !== turnId) {
        return true;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }
    return session.activeTurnId !== turnId;
  }

  private forceAbortTurnAndStopSession(
    session: KiroSessionState,
    turnId: TurnId,
    reason: string,
  ): void {
    this.abortTurn(session, turnId, reason);
    this.stopSession(session.threadId);
  }

  private async setModel(session: KiroSessionState, model: string): Promise<void> {
    await session.rpc.request("session/set_model", {
      sessionId: session.sessionId,
      modelId: model,
    });
    session.model = model;
    session.modelState = {
      ...session.modelState,
      currentModelId: model,
    };
    session.updatedAt = nowIso();
    this.emitMetadataSnapshot(session);
  }

  private async setInteractionMode(
    session: KiroSessionState,
    interactionMode: ProviderInteractionMode,
  ): Promise<void> {
    const modeId = resolveModeIdForInteractionMode(session.modeState, interactionMode);
    if (!modeId || modeId === session.modeState.currentModeId) {
      return;
    }
    await session.rpc.request("session/set_mode", {
      sessionId: session.sessionId,
      modeId,
    });
    session.modeState = {
      ...session.modeState,
      currentModeId: modeId,
      defaultModeId: session.modeState.defaultModeId ?? defaultModeId(session.modeState),
    };
    session.updatedAt = nowIso();
    this.emitMetadataSnapshot(session);
  }

  private async handleRequest(
    session: KiroSessionState,
    message: JsonRpcRequestMessage,
  ): Promise<void> {
    if (message.method !== "session/request_permission") {
      const detail = `Unsupported Kiro ACP request method '${message.method}'.`;
      this.emitErrorEvent(session, "session/requestUnsupported", detail, {
        method: message.method,
        params: message.params,
      });
      session.rpc.respond(message.id, undefined, {
        code: -32601,
        message: detail,
      });
      return;
    }

    const params = asRecord(message.params);
    const toolCall = asRecord(params?.toolCall);
    const requestKind = permissionRequestKind(normalizeNonEmpty(asString(toolCall?.kind)));
    const requestId = ApprovalRequestId.makeUnsafe(
      `kiro:${asString(toolCall?.toolCallId) ?? randomUUID()}`,
    );
    const options = (asArray(params?.options) ?? []).reduce<
      Array<{ optionId: string; kind?: string }>
    >((acc, entry) => {
      const option = asRecord(entry);
      const optionId = normalizeNonEmpty(asString(option?.optionId));
      if (!optionId) {
        return acc;
      }
      const kind = normalizeNonEmpty(asString(option?.kind));
      acc.push(kind ? { optionId, kind } : { optionId });
      return acc;
    }, []);
    const toolCallId = normalizeNonEmpty(asString(toolCall?.toolCallId));
    const method = permissionRequestMethod(normalizeNonEmpty(asString(toolCall?.kind)));
    const route = {
      ...(session.activeTurnId ? { turnId: session.activeTurnId } : {}),
      ...(toolCallId ? { itemId: ProviderItemId.makeUnsafe(toolCallId) } : {}),
      requestId,
      ...(requestKind ? { requestKind } : {}),
    } as const;
    const providerEventPayload = params ?? {};

    this.emit("event", {
      id: EventId.makeUnsafe(randomUUID()),
      kind: "request",
      provider: PROVIDER,
      threadId: session.threadId,
      createdAt: nowIso(),
      method,
      ...route,
      payload: providerEventPayload,
    } satisfies ProviderEvent);

    const autoDecision = autoApproveDecisionForRuntimeMode(session.runtimeMode);
    if (autoDecision) {
      session.rpc.respond(message.id, permissionDecisionForOptionKinds(options, autoDecision));
      this.emitNotificationEvent(
        session,
        "item/requestApproval/decision",
        {
          requestId,
          ...(requestKind ? { requestKind } : {}),
          decision: autoDecision,
          autoApproved: true,
        },
        route,
      );
      return;
    }

    session.pendingPermissionRequests.set(requestId, {
      rpcRequestId: message.id,
      requestId,
      toolCallId,
      requestKind,
      method,
      options,
    });
  }

  private async handleNotification(
    session: KiroSessionState,
    method: string,
    params: unknown,
  ): Promise<void> {
    if (method === "_kiro.dev/metadata") {
      const metadata = asRecord(params);
      if (metadata) {
        this.emitNotificationEvent(session, "thread/tokenUsage/updated", metadata);
      }
      return;
    }

    if (method === "_kiro.dev/commands/available") {
      const commandsSnapshot = extractCommandsSnapshot(params);
      if (commandsSnapshot) {
        session.commandsSnapshot = commandsSnapshot;
        console.log("kiro commands/available response", params);
        this.emitNotificationEvent(session, "session/configured", {
          config: {
            commands: commandsSnapshot.commands,
            prompts: commandsSnapshot.prompts,
            tools: commandsSnapshot.tools,
            mcpServers: commandsSnapshot.mcpServers,
          },
        });
        this.emitMetadataSnapshot(session);
      }
      return;
    }

    if (method !== "session/update") {
      return;
    }
    const update = asRecord(asRecord(params)?.update);
    const updateType = normalizeNonEmpty(asString(update?.sessionUpdate));
    if (!updateType) {
      return;
    }
    if (!update) {
      return;
    }

    if (updateType === "current_mode_update") {
      const modeId = normalizeNonEmpty(asString(update?.modeId));
      if (modeId) {
        session.modeState = {
          ...session.modeState,
          currentModeId: modeId,
          defaultModeId: session.modeState.defaultModeId ?? defaultModeId(session.modeState),
        };
        session.updatedAt = nowIso();
        this.emitMetadataSnapshot(session);
      }
      return;
    }

    if (session.suppressReplay) {
      return;
    }

    switch (updateType) {
      case "agent_message_chunk": {
        const content = asRecord(update?.content);
        const text = readKiroTextChunk(content?.text);
        if (!text) return;
        this.emitNotificationEvent(
          session,
          "item/agentMessage/delta",
          {
            delta: text,
          },
          session.activeTurnId ? { turnId: session.activeTurnId } : undefined,
        );
        return;
      }
      case "turn_end": {
        const turnId = session.activeTurnId;
        if (!turnId) {
          return;
        }
        this.completeTurn(session, turnId, this.turnCompletionFromUpdate(update));
        return;
      }
      case "plan": {
        const entries = (asArray(update?.entries) ?? [])
          .map((entry) => {
            const record = asRecord(entry);
            const step = normalizeNonEmpty(asString(record?.content));
            if (!step) return undefined;
            const rawStatus = normalizeNonEmpty(asString(record?.status));
            return {
              step,
              status:
                rawStatus === "completed"
                  ? "completed"
                  : rawStatus === "in_progress"
                    ? "inProgress"
                    : "pending",
            } as const;
          })
          .filter(
            (entry): entry is { step: string; status: "pending" | "inProgress" | "completed" } =>
              entry !== undefined,
          );
        if (entries.length === 0) return;
        this.emitNotificationEvent(
          session,
          "turn/plan/updated",
          {
            plan: entries,
          },
          session.activeTurnId ? { turnId: session.activeTurnId } : undefined,
        );
        return;
      }
      case "tool_call": {
        const toolCallId = normalizeNonEmpty(asString(update?.toolCallId));
        const kind = normalizeNonEmpty(asString(update?.kind));
        this.emitNotificationEvent(
          session,
          "item/started",
          {
            item: {
              ...(toolCallId ? { id: toolCallId } : {}),
              type: toolItemType(kind),
              status: "in_progress",
              ...(normalizeNonEmpty(asString(update?.title))
                ? { title: normalizeNonEmpty(asString(update?.title)) }
                : {}),
            },
          },
          {
            ...(session.activeTurnId ? { turnId: session.activeTurnId } : {}),
            ...(toolCallId ? { itemId: ProviderItemId.makeUnsafe(toolCallId) } : {}),
          },
        );
        return;
      }
      case "tool_call_update": {
        const toolCallId = normalizeNonEmpty(asString(update?.toolCallId));
        const status = normalizeNonEmpty(asString(update?.status));
        const content = asArray(update?.content);
        const detail = content
          ?.map((entry) => {
            const contentWrapper = asRecord(entry);
            const innerContent = asRecord(contentWrapper?.content);
            return normalizeNonEmpty(asString(innerContent?.text));
          })
          .find((value) => value !== undefined);
        this.emitNotificationEvent(
          session,
          status === "completed" || status === "failed" || status === "cancelled"
            ? "item/completed"
            : "item/updated",
          {
            item: {
              ...(toolCallId ? { id: toolCallId } : {}),
              type: "dynamicToolCall",
              ...(status ? { status } : {}),
              ...(detail ? { summary: detail } : {}),
            },
          },
          {
            ...(session.activeTurnId ? { turnId: session.activeTurnId } : {}),
            ...(toolCallId ? { itemId: ProviderItemId.makeUnsafe(toolCallId) } : {}),
          },
        );
        return;
      }
      default:
        return;
    }
  }

  private applySessionBootstrap(session: KiroSessionState, value: unknown): void {
    const modeState = extractModeState(value);
    if (modeState) {
      session.modeState = modeState;
    }
    const modelState = extractModelState(value);
    if (modelState) {
      session.modelState = modelState;
      session.model = modelState.currentModelId ?? session.model;
    }
  }

  private emitMetadataSnapshot(session: KiroSessionState): void {
    const interactionMode = resolveInteractionMode(session.modeState);
    const metadata: Record<string, unknown> = {};
    if (interactionMode) {
      metadata.interactionMode = interactionMode;
    }
    if (session.modeState.currentModeId) {
      metadata.providerModeId = session.modeState.currentModeId;
    }
    if (session.modeState.availableModes.length > 0) {
      metadata.providerModes = session.modeState.availableModes;
    }
    if (session.modelState.currentModelId) {
      metadata.providerModelId = session.modelState.currentModelId;
    }
    if (session.modelState.availableModels.length > 0) {
      metadata.providerModelsCatalog = session.modelState.availableModels;
    }
    if (session.commandsSnapshot.commands.length > 0) {
      metadata.providerCommands = session.commandsSnapshot.commands;
    }
    if (session.commandsSnapshot.tools.length > 0) {
      metadata.providerTools = session.commandsSnapshot.tools;
    }
    if (session.commandsSnapshot.mcpServers.length > 0) {
      metadata.providerMcpServers = session.commandsSnapshot.mcpServers;
    }
    if (Object.keys(metadata).length === 0) {
      return;
    }
    this.emitNotificationEvent(session, "thread/metadata/updated", {
      metadata,
    });
  }

  private emitSessionEvent(
    session: KiroSessionState,
    method: string,
    message: string,
    payload?: unknown,
  ): void {
    this.emit("event", {
      id: EventId.makeUnsafe(randomUUID()),
      kind: "session",
      provider: PROVIDER,
      threadId: session.threadId,
      createdAt: nowIso(),
      method,
      message,
      ...(payload !== undefined ? { payload } : {}),
    } satisfies ProviderEvent);
  }

  private emitNotificationEvent(
    session: KiroSessionState,
    method: string,
    payload?: unknown,
    route?: {
      readonly turnId?: TurnId;
      readonly itemId?: ProviderItemId;
      readonly requestId?: ApprovalRequestId;
      readonly requestKind?: ProviderRequestKind;
    },
  ): void {
    this.emit("event", {
      id: EventId.makeUnsafe(randomUUID()),
      kind: "notification",
      provider: PROVIDER,
      threadId: session.threadId,
      createdAt: nowIso(),
      method,
      ...(route?.turnId ? { turnId: route.turnId } : {}),
      ...(route?.itemId ? { itemId: route.itemId } : {}),
      ...(route?.requestId ? { requestId: route.requestId } : {}),
      ...(route?.requestKind ? { requestKind: route.requestKind } : {}),
      ...(payload !== undefined ? { payload } : {}),
    } satisfies ProviderEvent);
  }

  private emitErrorEvent(
    session: KiroSessionState,
    method: string,
    message: string,
    payload?: unknown,
  ): void {
    this.emit("event", {
      id: EventId.makeUnsafe(randomUUID()),
      kind: "error",
      provider: PROVIDER,
      threadId: session.threadId,
      createdAt: nowIso(),
      method,
      message,
      ...(payload !== undefined ? { payload } : {}),
    } satisfies ProviderEvent);
  }
}

function parseFirstJsonLine(value: string): unknown {
  for (const line of value.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      continue;
    }
  }
  return undefined;
}

function readKiroAccountSnapshot(input: {
  readonly binaryPath: string;
  readonly cwd?: string;
  readonly remote?: ProjectRemoteTarget;
}): unknown {
  const localCwd = process.cwd();
  const result =
    input.remote?.kind === "ssh"
      ? spawnSync(
          "ssh",
          buildSshExecArgs({
            hostAlias: input.remote.hostAlias,
            command: input.binaryPath,
            args: ["whoami", "--format", "json"],
            ...(input.cwd ? { cwd: input.cwd } : {}),
            localCwd,
          }),
          {
            cwd: localCwd,
            env: process.env,
            encoding: "utf8",
            shell: process.platform === "win32",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 5_000,
            maxBuffer: 1024 * 1024,
          },
        )
      : spawnSync(input.binaryPath, ["whoami", "--format", "json"], {
          cwd: input.cwd ?? localCwd,
          env: process.env,
          encoding: "utf8",
          shell: process.platform === "win32",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 5_000,
          maxBuffer: 1024 * 1024,
        });

  if (result.error || result.status !== 0) {
    return undefined;
  }

  return parseFirstJsonLine(result.stdout ?? "");
}
