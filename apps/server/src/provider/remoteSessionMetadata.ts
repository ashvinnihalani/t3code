import type {
  OrchestrationSessionReconnectState,
  ProviderSession,
  TurnId,
} from "@t3tools/contracts";

const RECONNECT_STATE_VALUES = new Set<OrchestrationSessionReconnectState>([
  "fresh-start",
  "adopt-existing",
  "resume-thread",
  "resume-unavailable",
  "resume-failed",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readIsoDateTime(value: unknown): string | undefined {
  const normalized = readTrimmedString(value);
  if (!normalized) {
    return undefined;
  }
  return Number.isNaN(Date.parse(normalized)) ? undefined : normalized;
}

export interface PersistedRemoteSessionMetadata {
  readonly activeTurnId?: TurnId | null;
  readonly lastError?: string | null;
  readonly providerThreadId?: string;
  readonly resumeAvailable?: boolean;
  readonly reconnectState?: OrchestrationSessionReconnectState;
  readonly reconnectSummary?: string;
  readonly reconnectUpdatedAt?: string;
}

export function readProviderThreadIdFromResumeCursor(resumeCursor: unknown): string | undefined {
  if (!isRecord(resumeCursor)) {
    return undefined;
  }
  return readTrimmedString(resumeCursor.threadId);
}

export function buildRemoteSessionRuntimeMetadataPatch(input: {
  readonly session?: ProviderSession;
  readonly activeTurnId?: TurnId | null;
  readonly lastError?: string | null;
  readonly providerThreadId?: string;
  readonly resumeAvailable?: boolean;
  readonly reconnectState: OrchestrationSessionReconnectState;
  readonly reconnectSummary: string;
  readonly reconnectUpdatedAt?: string;
}): Record<string, unknown> {
  const providerThreadId =
    readTrimmedString(input.providerThreadId) ??
    (input.session ? readProviderThreadIdFromResumeCursor(input.session.resumeCursor) : undefined);
  const reconnectSummary = readTrimmedString(input.reconnectSummary);
  const reconnectUpdatedAt =
    readIsoDateTime(input.reconnectUpdatedAt) ??
    (input.session ? readIsoDateTime(input.session.updatedAt) : undefined) ??
    new Date().toISOString();

  return {
    ...(input.activeTurnId !== undefined ? { activeTurnId: input.activeTurnId } : {}),
    ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
    ...(providerThreadId ? { providerThreadId } : {}),
    ...(input.resumeAvailable !== undefined
      ? { resumeAvailable: input.resumeAvailable }
      : input.session
        ? { resumeAvailable: input.session.resumeCursor !== undefined }
        : {}),
    reconnectState: input.reconnectState,
    ...(reconnectSummary ? { reconnectSummary } : {}),
    reconnectUpdatedAt,
  };
}

export function readPersistedRemoteSessionMetadata(
  runtimePayload: unknown,
): PersistedRemoteSessionMetadata {
  if (!isRecord(runtimePayload)) {
    return {};
  }

  const reconnectStateRaw = readTrimmedString(runtimePayload.reconnectState);
  const reconnectState =
    reconnectStateRaw &&
    RECONNECT_STATE_VALUES.has(reconnectStateRaw as OrchestrationSessionReconnectState)
      ? (reconnectStateRaw as OrchestrationSessionReconnectState)
      : undefined;
  const providerThreadId = readTrimmedString(runtimePayload.providerThreadId);
  const lastErrorRaw = runtimePayload.lastError;
  const lastError = lastErrorRaw === null ? null : (readTrimmedString(lastErrorRaw) ?? undefined);
  const activeTurnIdRaw = runtimePayload.activeTurnId;
  const activeTurnId =
    activeTurnIdRaw === null ? null : (readTrimmedString(activeTurnIdRaw) as TurnId | undefined);
  const reconnectSummary = readTrimmedString(runtimePayload.reconnectSummary);
  const reconnectUpdatedAt = readIsoDateTime(runtimePayload.reconnectUpdatedAt);

  return {
    ...(activeTurnId !== undefined ? { activeTurnId } : {}),
    ...(lastError !== undefined ? { lastError } : {}),
    ...(providerThreadId ? { providerThreadId } : {}),
    ...(typeof runtimePayload.resumeAvailable === "boolean"
      ? { resumeAvailable: runtimePayload.resumeAvailable }
      : {}),
    ...(reconnectState ? { reconnectState } : {}),
    ...(reconnectSummary ? { reconnectSummary } : {}),
    ...(reconnectUpdatedAt ? { reconnectUpdatedAt } : {}),
  };
}
