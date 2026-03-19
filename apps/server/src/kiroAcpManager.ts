import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  type ProviderApprovalDecision,
  type ProviderInteractionMode,
  type ProviderRuntimeEvent,
  ProviderItemId,
  RuntimeItemId,
  RuntimeRequestId,
  ThreadId,
  TurnId,
  type ProviderSession,
} from "@t3tools/contracts";

import { buildSshExecArgs } from "./sshCommand.ts";
import type { ProjectRemoteTarget } from "@t3tools/contracts";

const PROVIDER = "kiro" as const;
const DEFAULT_BINARY_PATH = "kiro-cli";

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

interface PendingPermissionRequest {
  readonly rpcRequestId: number | string;
  readonly requestId: string;
  readonly toolCallId: string | undefined;
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
  readonly rpc: JsonRpcConnection;
  readonly runtimeMode: ProviderSession["runtimeMode"];
  readonly cwd: string | undefined;
  createdAt: string;
  updatedAt: string;
  status: ProviderSession["status"];
  model: string | undefined;
  sessionId: string | undefined;
  activeTurnId: TurnId | undefined;
  modeState: KiroModeState;
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

function resumeCursorFromSessionId(sessionId: string | undefined): unknown {
  return sessionId ? { sessionId } : undefined;
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

function toCanonicalItemType(
  kind: string | undefined,
): Extract<ProviderRuntimeEvent, { type: "item.started" }>["payload"]["itemType"] {
  switch ((kind ?? "").toLowerCase()) {
    case "execute":
      return "command_execution";
    case "edit":
    case "move":
    case "delete":
      return "file_change";
    case "search":
    case "fetch":
      return "web_search";
    default:
      return "dynamic_tool_call";
  }
}

function toCanonicalRequestType(
  kind: string | undefined,
): Extract<ProviderRuntimeEvent, { type: "request.opened" }>["payload"]["requestType"] {
  switch ((kind ?? "").toLowerCase()) {
    case "execute":
    case "switch_mode":
      return "command_execution_approval";
    case "read":
      return "file_read_approval";
    case "edit":
    case "move":
    case "delete":
      return "file_change_approval";
    default:
      return "unknown";
  }
}

function toItemStatus(
  status: string | undefined,
): "inProgress" | "completed" | "failed" | "declined" {
  switch ((status ?? "").toLowerCase()) {
    case "pending":
    case "in_progress":
      return "inProgress";
    case "failed":
      return "failed";
    case "cancelled":
    case "declined":
      return "declined";
    default:
      return "completed";
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
    const { process, command } = this.spawnProcess({
      binaryPath: input.binaryPath ?? DEFAULT_BINARY_PATH,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.remote ? { remote: input.remote } : {}),
    });

    let session = undefined as KiroSessionState | undefined;
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
        this.emit(
          "event",
          this.runtimeEvent(session, {
            type: "session.exited",
            payload: {
              exitKind: error ? ("error" as const) : ("graceful" as const),
              ...(error ? { reason: error.message } : {}),
            },
          }),
        );
        this.sessions.delete(session.threadId);
      },
    );

    await rpc.request("initialize", {
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

    session = {
      threadId: input.threadId,
      process,
      rpc,
      runtimeMode: input.runtimeMode,
      cwd: input.cwd,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: "ready",
      model: input.model,
      sessionId: undefined,
      activeTurnId: undefined,
      modeState: {
        currentModeId: undefined,
        defaultModeId: undefined,
        availableModes: [],
      },
      turns: [],
      pendingPermissionRequests: new Map(),
      suppressReplay: false,
    };

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
        const modeState = extractModeState(loadResult);
        if (modeState) {
          session.modeState = modeState;
        }
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
      const sessionId = normalizeNonEmpty(asString(created?.sessionId));
      if (sessionId) {
        session.sessionId = sessionId;
      }
      const modeState = extractModeState(created);
      if (modeState) {
        session.modeState = modeState;
      }
    }

    if (!session.sessionId) {
      process.kill();
      throw new Error("Kiro ACP session did not return a sessionId.");
    }

    this.sessions.set(session.threadId, session);
    if (input.model) {
      await this.setModel(session, input.model);
    }

    this.emit(
      "event",
      this.runtimeEvent(session, {
        type: "session.started",
        payload: {
          message: "Kiro ACP session started",
          resume: resumeCursorFromSessionId(session.sessionId),
        },
      }),
    );
    this.emit(
      "event",
      this.runtimeEvent(session, {
        type: "thread.started",
        payload: {
          providerThreadId: session.sessionId,
        },
      }),
    );
    this.emitModeMetadata(session);

    return {
      provider: PROVIDER,
      status: session.status,
      runtimeMode: session.runtimeMode,
      ...(session.cwd ? { cwd: session.cwd } : {}),
      ...(session.model ? { model: session.model } : {}),
      threadId: session.threadId,
      resumeCursor: { sessionId: session.sessionId },
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
    this.emit(
      "event",
      this.runtimeEvent(session, {
        type: "turn.started",
        turnId,
        payload: session.model ? { model: session.model } : {},
      }),
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
      resumeCursor: { sessionId: session.sessionId },
    };
  }

  async interruptTurn(threadId: ThreadId): Promise<void> {
    const session = this.requireSession(threadId);
    await session.rpc.request("session/cancel", {
      sessionId: session.sessionId,
    });
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
    this.emit(
      "event",
      this.runtimeEvent(session, {
        type: "request.resolved",
        ...(session.activeTurnId ? { turnId: session.activeTurnId } : {}),
        requestId: RuntimeRequestId.makeUnsafe(requestId),
        payload: {
          requestType: toCanonicalRequestType(undefined),
          decision,
        },
      }),
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
    readonly cwd?: string;
    readonly remote?: ProjectRemoteTarget;
  }): { readonly process: ChildProcessWithoutNullStreams; readonly command: string } {
    if (input.remote?.kind === "ssh") {
      return {
        process: spawn(
          "ssh",
          buildSshExecArgs({
            hostAlias: input.remote.hostAlias,
            command: input.binaryPath,
            args: ["acp"],
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
        command: `ssh ${input.remote.hostAlias} ${input.binaryPath} acp`,
      };
    }

    return {
      process: spawn(input.binaryPath, ["acp"], {
        cwd: input.cwd ?? process.cwd(),
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
        shell: process.platform === "win32",
      }),
      command: `${input.binaryPath} acp`,
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
    this.emit(
      "event",
      this.runtimeEvent(session, {
        type: "turn.completed",
        turnId,
        payload: {
          state: payload.state,
          ...(payload.stopReason ? { stopReason: payload.stopReason } : {}),
          ...(payload.errorMessage ? { errorMessage: payload.errorMessage } : {}),
        },
      }),
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

  private async setModel(session: KiroSessionState, model: string): Promise<void> {
    await session.rpc.request("session/set_model", {
      sessionId: session.sessionId,
      modelId: model,
    });
    session.model = model;
    session.updatedAt = nowIso();
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
    this.emitModeMetadata(session);
  }

  private async handleRequest(
    session: KiroSessionState,
    message: JsonRpcRequestMessage,
  ): Promise<void> {
    if (message.method !== "session/request_permission") {
      session.rpc.respond(message.id, null);
      return;
    }

    const params = asRecord(message.params);
    const toolCall = asRecord(params?.toolCall);
    const requestId = `kiro:${asString(toolCall?.toolCallId) ?? crypto.randomUUID()}`;
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
    session.pendingPermissionRequests.set(requestId, {
      rpcRequestId: message.id,
      requestId,
      toolCallId,
      options,
    });
    this.emit(
      "event",
      this.runtimeEvent(session, {
        type: "request.opened",
        ...(session.activeTurnId ? { turnId: session.activeTurnId } : {}),
        requestId: RuntimeRequestId.makeUnsafe(requestId),
        ...(toolCallId ? { itemId: RuntimeItemId.makeUnsafe(toolCallId) } : {}),
        payload: {
          requestType: toCanonicalRequestType(normalizeNonEmpty(asString(toolCall?.kind))),
          ...(normalizeNonEmpty(asString(toolCall?.title))
            ? { detail: normalizeNonEmpty(asString(toolCall?.title)) }
            : {}),
          args: params,
        },
        ...(toolCallId
          ? {
              providerRefs: {
                providerItemId: ProviderItemId.makeUnsafe(toolCallId),
                providerRequestId: requestId,
              },
            }
          : {}),
      }),
    );
  }

  private async handleNotification(
    session: KiroSessionState,
    method: string,
    params: unknown,
  ): Promise<void> {
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
        this.emitModeMetadata(session);
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
        this.emit(
          "event",
          this.runtimeEvent(session, {
            type: "content.delta",
            ...(session.activeTurnId ? { turnId: session.activeTurnId } : {}),
            payload: {
              streamKind: "assistant_text",
              delta: text,
            },
          }),
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
        this.emit(
          "event",
          this.runtimeEvent(session, {
            type: "turn.plan.updated",
            ...(session.activeTurnId ? { turnId: session.activeTurnId } : {}),
            payload: {
              plan: entries,
            },
          }),
        );
        return;
      }
      case "tool_call": {
        const toolCallId = normalizeNonEmpty(asString(update?.toolCallId));
        const kind = normalizeNonEmpty(asString(update?.kind));
        this.emit(
          "event",
          this.runtimeEvent(session, {
            type: "item.started",
            ...(session.activeTurnId ? { turnId: session.activeTurnId } : {}),
            ...(toolCallId ? { itemId: RuntimeItemId.makeUnsafe(toolCallId) } : {}),
            payload: {
              itemType: toCanonicalItemType(kind),
              status: "inProgress",
              ...(normalizeNonEmpty(asString(update?.title))
                ? { title: normalizeNonEmpty(asString(update?.title)) }
                : {}),
            },
            ...(toolCallId
              ? {
                  providerRefs: {
                    providerItemId: ProviderItemId.makeUnsafe(toolCallId),
                  },
                }
              : {}),
          }),
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
        const baseEvent = {
          ...(session.activeTurnId ? { turnId: session.activeTurnId } : {}),
          ...(toolCallId ? { itemId: RuntimeItemId.makeUnsafe(toolCallId) } : {}),
          ...(toolCallId
            ? {
                providerRefs: {
                  providerItemId: ProviderItemId.makeUnsafe(toolCallId),
                },
              }
            : {}),
        };
        this.emit(
          "event",
          this.runtimeEvent(session, {
            type:
              status === "completed" || status === "failed" || status === "cancelled"
                ? "item.completed"
                : "item.updated",
            ...baseEvent,
            payload: {
              itemType: "dynamic_tool_call",
              status: toItemStatus(status),
              ...(detail ? { detail } : {}),
            },
          }),
        );
        return;
      }
      default:
        return;
    }
  }

  private emitModeMetadata(session: KiroSessionState): void {
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
    if (Object.keys(metadata).length === 0) {
      return;
    }
    this.emit(
      "event",
      this.runtimeEvent(session, {
        type: "thread.metadata.updated",
        payload: {
          metadata,
        },
      }),
    );
  }

  private runtimeEvent(
    session: KiroSessionState,
    input: Omit<ProviderRuntimeEvent, "eventId" | "provider" | "threadId" | "createdAt" | "raw">,
  ): ProviderRuntimeEvent {
    return {
      eventId: crypto.randomUUID(),
      provider: PROVIDER,
      threadId: session.threadId,
      createdAt: nowIso(),
      ...input,
      raw: {
        source: "kiro-acp",
        payload: input,
      },
    } as ProviderRuntimeEvent;
  }
}
