import * as CodexClient from "effect-codex-app-server/client";
import type * as CodexError from "effect-codex-app-server/errors";
import type {
  AppServerConnectionProfile,
  AppServerConnectionSettings,
  AppServerDesktopSettings,
  DiscoveredSshHost,
} from "effect-codex-app-server/connection";
import * as Remote from "effect-codex-app-server/remote";
import type * as CodexSchema from "effect-codex-app-server/schema";
import { fromMessagePort } from "effect-codex-app-server/transport";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  appendAgentMessageDelta,
  isRecord,
  projectModels,
  projectThreadDetail,
  projectThreadSummary,
  upsertTimelineItem,
  upsertTurn,
  type ModelOption,
  type ThreadDetail,
  type ThreadSummary,
} from "./presentation";

const RETRY_DELAYS_MS = [3_000, 4_000, 8_000, 16_000] as const;
const CACHE_PREFIX = "t3-codex:app-server-cache:v3:";
let nextDraftId = 0;

type Client = CodexClient.CodexAppServerClient["Service"];

export interface SettingsDraft {
  readonly id: string;
  readonly name: string;
  readonly kind: "local" | "ssh";
  readonly executable: string;
  readonly args: string;
  readonly workspace: string;
  readonly env: string;
  readonly host: string;
  readonly username: string;
  readonly port: string;
  readonly identityFile: string;
}

export interface CachedSnapshot {
  readonly updatedAt: number;
  readonly threads: ReadonlyArray<ThreadSummary>;
}

export interface ConnectionState {
  readonly phase: "connecting" | "reconnecting" | "connected";
  readonly attempt: number;
  readonly error: string | null;
  readonly retryAt: number | null;
  readonly snapshot: CachedSnapshot | null;
  readonly account: unknown;
  readonly remote: Remote.RemoteControlStatus | null;
}

export interface EnvironmentState extends ConnectionState {
  readonly profile: AppServerConnectionProfile;
  readonly models: ReadonlyArray<ModelOption>;
}

export interface EnvironmentProject {
  readonly key: string;
  readonly environmentId: string;
  readonly environmentName: string;
  readonly cwd: string;
  readonly threads: ReadonlyArray<ThreadSummary>;
}

export interface RemoteDialogState {
  readonly connectionId: string | null;
  readonly pairing: Remote.RemoteControlPairing | null;
  readonly clients: ReadonlyArray<Remote.RemoteControlClient>;
  readonly error: string | null;
  readonly busy: boolean;
}

export type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export interface PendingApproval {
  readonly id: string;
  readonly environmentId: string;
  readonly threadId: string;
  readonly kind: "command" | "fileChange";
  readonly title: string;
  readonly detail: string | null;
  readonly reason: string | null;
  readonly respond: (decision: ApprovalDecision) => void;
}

interface EnvironmentRuntime {
  readonly close: () => void;
  readonly retry: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cacheKey(profile: AppServerConnectionProfile): string {
  const connection = profile.connection;
  const location = connection.kind === "ssh" ? connection.host : "local";
  return `${CACHE_PREFIX}${encodeURIComponent(`${profile.id}:${connection.kind}:${location}:${connection.workspace}`)}`;
}

function readCache(profile: AppServerConnectionProfile): CachedSnapshot | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(profile));
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.updatedAt !== "number" || !Array.isArray(value.threads)) {
      return null;
    }
    const threads = value.threads
      .map(projectThreadSummary)
      .filter((thread): thread is ThreadSummary => thread !== null);
    return { updatedAt: value.updatedAt, threads };
  } catch {
    return null;
  }
}

function writeCache(profile: AppServerConnectionProfile, snapshot: CachedSnapshot): void {
  try {
    window.localStorage.setItem(cacheKey(profile), JSON.stringify(snapshot));
  } catch {
    // A full or disabled presentation cache must never break a live connection.
  }
}

function initialEnvironmentState(profile: AppServerConnectionProfile): EnvironmentState {
  return {
    profile,
    phase: "connecting",
    attempt: 1,
    error: null,
    retryAt: null,
    snapshot: readCache(profile),
    account: null,
    remote: null,
    models: [],
  };
}

export function toSettingsDraft(profile: AppServerConnectionProfile): SettingsDraft {
  const connection = profile.connection;
  return {
    id: profile.id,
    name: profile.name,
    kind: connection.kind,
    executable: connection.executable,
    args: JSON.stringify(connection.args, null, 2),
    workspace: connection.workspace,
    env: JSON.stringify(connection.env, null, 2),
    host: connection.kind === "ssh" ? connection.host : "",
    username: connection.kind === "ssh" ? connection.username : "",
    port: connection.kind === "ssh" && connection.port !== null ? String(connection.port) : "",
    identityFile: connection.kind === "ssh" ? connection.identityFile : "",
  };
}

export function newSshSettingsDraft(
  localProfile: AppServerConnectionProfile,
  host = "",
): SettingsDraft {
  const base = toSettingsDraft(localProfile);
  return {
    ...base,
    id: `ssh-${Date.now().toString(36)}-${(nextDraftId += 1).toString(36)}`,
    name: host || "Remote environment",
    kind: "ssh",
    host,
    username: "",
    port: "",
    identityFile: "",
  };
}

function parseStringArray(value: string): ReadonlyArray<string> {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error("Arguments must be a JSON array of strings.");
  }
  return parsed;
}

function parseEnvironment(value: string): Readonly<Record<string, string>> {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || Object.values(parsed).some((entry) => typeof entry !== "string")) {
    throw new Error("Environment must be a JSON object containing string values.");
  }
  return parsed as Record<string, string>;
}

export function fromSettingsDraft(draft: SettingsDraft): AppServerConnectionProfile {
  const name = draft.name.trim();
  const common = {
    executable: draft.executable.trim(),
    args: parseStringArray(draft.args),
    workspace: draft.workspace.trim(),
    env: parseEnvironment(draft.env),
  };
  if (!name || !common.executable || !common.workspace) {
    throw new Error("Name, executable, and workspace are required.");
  }
  if (draft.kind === "local") {
    return { id: draft.id, name, connection: { kind: "local", ...common } };
  }
  if (!draft.host.trim()) throw new Error("SSH host is required.");
  const parsedPort = draft.port.trim() ? Number(draft.port) : null;
  if (
    parsedPort !== null &&
    (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535)
  ) {
    throw new Error("SSH port must be an integer from 1 to 65535.");
  }
  return {
    id: draft.id,
    name,
    connection: {
      kind: "ssh",
      ...common,
      host: draft.host.trim(),
      username: draft.username.trim(),
      port: parsedPort,
      identityFile: draft.identityFile.trim(),
    },
  };
}

function readAllThreads(
  client: Client,
): Effect.Effect<ReadonlyArray<ThreadSummary>, CodexError.CodexAppServerError> {
  return Effect.gen(function* () {
    const threads: ThreadSummary[] = [];
    let cursor: string | null = null;
    do {
      const response: CodexSchema.V2ThreadListResponse = yield* client.request(
        "thread/list",
        cursor === null ? {} : { cursor },
      );
      for (const value of response.data) {
        const thread = projectThreadSummary(value);
        if (thread !== null) threads.push(thread);
      }
      cursor = response.nextCursor ?? null;
    } while (cursor !== null);
    return threads;
  });
}

export function connectionLabel(connection: AppServerConnectionSettings): string {
  return connection.kind === "local"
    ? `Local · ${connection.workspace}`
    : `SSH · ${connection.username ? `${connection.username}@` : ""}${connection.host}`;
}

export function connectionStatusText(connection: ConnectionState): string {
  if (connection.phase === "connected") return "Connected";
  if (connection.phase === "connecting") return "Connecting…";
  return connection.error
    ? `Failed to connect. Reconnecting… ${connection.error}`
    : "Reconnecting…";
}

export function projectEnvironmentProjects(
  environments: ReadonlyArray<EnvironmentState>,
): ReadonlyArray<EnvironmentProject> {
  const result: EnvironmentProject[] = [];
  for (const environment of environments) {
    const grouped = new Map<string, ThreadSummary[]>();
    for (const item of environment.snapshot?.threads ?? []) {
      const current = grouped.get(item.cwd) ?? [];
      current.push(item);
      grouped.set(item.cwd, current);
    }
    for (const [cwd, threads] of grouped) {
      result.push({
        key: `${environment.profile.id}:${cwd}`,
        environmentId: environment.profile.id,
        environmentName: environment.profile.name,
        cwd,
        threads,
      });
    }
  }
  return result;
}

export function useAppServerController() {
  const [settings, setSettings] = useState<AppServerDesktopSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [sshHosts, setSshHosts] = useState<ReadonlyArray<DiscoveredSshHost>>([]);
  const [environmentStates, setEnvironmentStates] = useState<
    Readonly<Record<string, EnvironmentState>>
  >({});
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadEnvironmentId, setThreadEnvironmentId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<ReadonlyArray<PendingApproval>>([]);
  const [remote, setRemote] = useState<RemoteDialogState>({
    connectionId: null,
    pairing: null,
    clients: [],
    error: null,
    busy: false,
  });
  const clientsRef = useRef(new Map<string, Client>());
  const runtimesRef = useRef(new Map<string, EnvironmentRuntime>());
  const selectionRef = useRef({ environmentId: selectedEnvironmentId, threadId: selectedThreadId });
  selectionRef.current = { environmentId: selectedEnvironmentId, threadId: selectedThreadId };

  const updateEnvironment = useCallback(
    (environmentId: string, update: (current: EnvironmentState) => EnvironmentState) => {
      setEnvironmentStates((current) => {
        const environment = current[environmentId];
        if (environment === undefined) return current;
        return { ...current, [environmentId]: update(environment) };
      });
    },
    [],
  );

  const replaceThreads = useCallback(
    (profile: AppServerConnectionProfile, threads: ReadonlyArray<ThreadSummary>) => {
      const snapshot = { updatedAt: Date.now(), threads };
      writeCache(profile, snapshot);
      updateEnvironment(profile.id, (current) => ({ ...current, snapshot }));
    },
    [updateEnvironment],
  );

  const updateThreadSnapshot = useCallback(
    (
      profile: AppServerConnectionProfile,
      update: (threads: ReadonlyArray<ThreadSummary>) => ReadonlyArray<ThreadSummary>,
    ) => {
      updateEnvironment(profile.id, (current) => {
        const snapshot = {
          updatedAt: Date.now(),
          threads: update(current.snapshot?.threads ?? []),
        };
        writeCache(profile, snapshot);
        return { ...current, snapshot };
      });
    },
    [updateEnvironment],
  );

  const upsertThreadSummary = useCallback(
    (profile: AppServerConnectionProfile, value: unknown) => {
      const summary = projectThreadSummary(value);
      if (summary === null) return;
      updateThreadSnapshot(profile, (threads) => [
        summary,
        ...threads.filter((candidate) => candidate.id !== summary.id),
      ]);
    },
    [updateThreadSnapshot],
  );

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (bridge === undefined) {
      setSettingsError("The Electron app-server bridge is unavailable.");
      return;
    }
    void bridge.getAppServerSettings().then(
      (loaded) => {
        setSettings(loaded);
        setEnvironmentStates(
          Object.fromEntries(
            loaded.connections.map((profile) => [profile.id, initialEnvironmentState(profile)]),
          ),
        );
        setSelectedEnvironmentId((current) =>
          current !== null && loaded.connections.some((profile) => profile.id === current)
            ? current
            : (loaded.connections[0]?.id ?? null),
        );
      },
      (error: unknown) => setSettingsError(errorMessage(error)),
    );
    void bridge.discoverSshHosts().then(setSshHosts, () => setSshHosts([]));
  }, []);

  useEffect(() => {
    if (settings === null) return;
    const bridge = window.desktopBridge;
    if (bridge === undefined) return;

    for (const runtime of runtimesRef.current.values()) runtime.close();
    runtimesRef.current.clear();
    clientsRef.current.clear();

    setEnvironmentStates((current) =>
      Object.fromEntries(
        settings.connections.map((profile) => {
          const previous = current[profile.id];
          return [
            profile.id,
            previous === undefined
              ? initialEnvironmentState(profile)
              : {
                  ...previous,
                  profile,
                  phase: "connecting",
                  attempt: 1,
                  error: null,
                  retryAt: null,
                },
          ];
        }),
      ),
    );

    for (const profile of settings.connections) {
      let active = true;
      let attempt = 0;
      let port: MessagePort | undefined;
      let scope: Scope.Closeable | undefined;
      let unsubscribe: (() => void) | undefined;
      let retryTimer: ReturnType<typeof setTimeout> | undefined;

      const closeCurrent = () => {
        unsubscribe?.();
        unsubscribe = undefined;
        const currentPort = port;
        port = undefined;
        currentPort?.close();
        if (scope !== undefined) Effect.runFork(Scope.close(scope, Exit.void));
        scope = undefined;
        clientsRef.current.delete(profile.id);
      };

      const connect = () => {
        if (!active) return;
        updateEnvironment(profile.id, (current) => ({
          ...current,
          phase: attempt === 0 ? "connecting" : "reconnecting",
          attempt: attempt + 1,
          error: attempt === 0 ? null : current.error,
          retryAt: null,
        }));
        unsubscribe = bridge.connectAppServer(profile, scheduleReconnect);
      };

      const scheduleReconnect = (message: string) => {
        if (!active || retryTimer !== undefined) return;
        closeCurrent();
        if (selectionRef.current.environmentId === profile.id) {
          setThreadEnvironmentId(null);
        }
        const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 16_000;
        attempt += 1;
        updateEnvironment(profile.id, (current) => ({
          ...current,
          phase: "reconnecting",
          attempt: attempt + 1,
          error: message,
          retryAt: Date.now() + delay,
        }));
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          connect();
        }, delay);
      };

      const removeApproval = (id: string) => {
        setPendingApprovals((current) => current.filter((approval) => approval.id !== id));
      };

      const connectClient = (connectedPort: MessagePort) =>
        Effect.gen(function* () {
          const nextScope = yield* Scope.make();
          const client = yield* CodexClient.make(fromMessagePort(connectedPort)).pipe(
            Effect.provideService(Scope.Scope, nextScope),
          );

          yield* client.handleServerNotification("remoteControl/status/changed", (status) =>
            Effect.sync(() => {
              if (!active) return;
              updateEnvironment(profile.id, (current) => ({
                ...current,
                remote: {
                  environmentId: status.environmentId ?? null,
                  installationId: status.installationId ?? "",
                  serverName: status.serverName ?? "",
                  status: status.status,
                },
              }));
            }),
          );
          yield* client.handleServerNotification("thread/started", ({ thread: started }) =>
            Effect.sync(() => upsertThreadSummary(profile, started)),
          );
          yield* client.handleServerNotification(
            "thread/name/updated",
            ({ threadId, threadName }) =>
              Effect.sync(() =>
                updateThreadSnapshot(profile, (threads) =>
                  threads.map((item) =>
                    item.id === threadId ? { ...item, name: threadName ?? null } : item,
                  ),
                ),
              ),
          );
          yield* client.handleServerNotification("thread/status/changed", ({ threadId, status }) =>
            Effect.sync(() =>
              updateThreadSnapshot(profile, (threads) =>
                threads.map((item) =>
                  item.id === threadId ? { ...item, status: status.type } : item,
                ),
              ),
            ),
          );
          yield* client.handleServerRequest("item/commandExecution/requestApproval", (request) =>
            Effect.callback<CodexSchema.CommandExecutionRequestApprovalResponse>((resume) => {
              const id = `${profile.id}:${request.turnId}:${request.approvalId ?? request.itemId}`;
              setPendingApprovals((current) => [
                ...current.filter((approval) => approval.id !== id),
                {
                  id,
                  environmentId: profile.id,
                  threadId: request.threadId,
                  kind: "command",
                  title: request.command ?? "Run command",
                  detail: request.cwd ?? null,
                  reason: request.reason ?? null,
                  respond: (decision) => {
                    removeApproval(id);
                    resume(Effect.succeed({ decision }));
                  },
                },
              ]);
              return Effect.sync(() => removeApproval(id));
            }),
          );
          yield* client.handleServerRequest("item/fileChange/requestApproval", (request) =>
            Effect.callback<CodexSchema.FileChangeRequestApprovalResponse>((resume) => {
              const id = `${profile.id}:${request.turnId}:${request.itemId}`;
              setPendingApprovals((current) => [
                ...current.filter((approval) => approval.id !== id),
                {
                  id,
                  environmentId: profile.id,
                  threadId: request.threadId,
                  kind: "fileChange",
                  title: request.grantRoot
                    ? `Write files under ${request.grantRoot}`
                    : "Apply file changes",
                  detail: request.grantRoot ?? null,
                  reason: request.reason ?? null,
                  respond: (decision) => {
                    removeApproval(id);
                    resume(Effect.succeed({ decision }));
                  },
                },
              ]);
              return Effect.sync(() => removeApproval(id));
            }),
          );
          yield* client.handleServerNotification("turn/started", ({ threadId, turn }) =>
            Effect.sync(() => {
              const selected = selectionRef.current;
              if (selected.environmentId !== profile.id || selected.threadId !== threadId) return;
              setThread((current) =>
                current?.id === threadId ? upsertTurn(current, turn) : current,
              );
            }),
          );
          yield* client.handleServerNotification("turn/completed", ({ threadId, turn }) =>
            Effect.sync(() => {
              const selected = selectionRef.current;
              if (selected.environmentId !== profile.id || selected.threadId !== threadId) return;
              setThread((current) =>
                current?.id === threadId ? upsertTurn(current, turn) : current,
              );
            }),
          );
          yield* client.handleServerNotification("item/started", ({ item, threadId, turnId }) =>
            Effect.sync(() => {
              const selected = selectionRef.current;
              if (selected.environmentId !== profile.id || selected.threadId !== threadId) return;
              setThread((current) =>
                current?.id === threadId ? upsertTimelineItem(current, turnId, item) : current,
              );
            }),
          );
          yield* client.handleServerNotification("item/completed", ({ item, threadId, turnId }) =>
            Effect.sync(() => {
              const selected = selectionRef.current;
              if (selected.environmentId !== profile.id || selected.threadId !== threadId) return;
              setThread((current) =>
                current?.id === threadId ? upsertTimelineItem(current, turnId, item) : current,
              );
            }),
          );
          yield* client.handleServerNotification(
            "item/agentMessage/delta",
            ({ delta, itemId, threadId, turnId }) =>
              Effect.sync(() => {
                const selected = selectionRef.current;
                if (selected.environmentId !== profile.id || selected.threadId !== threadId) return;
                setThread((current) =>
                  current?.id === threadId
                    ? appendAgentMessageDelta(current, turnId, itemId, delta)
                    : current,
                );
              }),
          );
          yield* client.request("initialize", {
            clientInfo: {
              name: "t3-codex",
              title: "T3 Codex",
              version: import.meta.env.APP_VERSION,
            },
            capabilities: { experimentalApi: true, optOutNotificationMethods: null },
          });
          yield* client.notify("initialized", undefined);

          const [threads, account, modelResponse, remoteStatus] = yield* Effect.all(
            [
              readAllThreads(client),
              client.request("account/read", {}),
              client.request("model/list", {}),
              Remote.readStatus(client).pipe(Effect.option),
            ],
            { concurrency: "unbounded" },
          );
          return {
            client,
            scope: nextScope,
            threads,
            account,
            models: projectModels(modelResponse),
            remote: remoteStatus._tag === "Some" ? remoteStatus.value : null,
          };
        });

      const handlePortMessage = (event: MessageEvent<unknown>) => {
        if (
          event.source !== window ||
          !isRecord(event.data) ||
          event.data.type !== bridge.appServerPortMessage ||
          event.data.connectionId !== profile.id
        ) {
          return;
        }
        const connectedPort = event.ports[0];
        if (connectedPort === undefined) return;
        if (!active) {
          connectedPort.close();
          return;
        }
        port = connectedPort;
        connectedPort.addEventListener("close", () => {
          if (port === connectedPort) {
            scheduleReconnect("The app-server transport disconnected.");
          }
        });
        Effect.runPromise(connectClient(connectedPort)).then(
          (loaded) => {
            if (!active) {
              Effect.runFork(Scope.close(loaded.scope, Exit.void));
              return;
            }
            scope = loaded.scope;
            clientsRef.current.set(profile.id, loaded.client);
            attempt = 0;
            replaceThreads(profile, loaded.threads);
            updateEnvironment(profile.id, (current) => ({
              ...current,
              phase: "connected",
              attempt: 1,
              error: null,
              retryAt: null,
              account: loaded.account,
              remote: loaded.remote,
              models: loaded.models,
            }));
          },
          (error: unknown) => scheduleReconnect(errorMessage(error)),
        );
      };

      window.addEventListener("message", handlePortMessage);
      connect();
      const runtime: EnvironmentRuntime = {
        close: () => {
          if (!active) return;
          active = false;
          window.removeEventListener("message", handlePortMessage);
          if (retryTimer !== undefined) clearTimeout(retryTimer);
          closeCurrent();
          setPendingApprovals((current) =>
            current.filter((approval) => approval.environmentId !== profile.id),
          );
        },
        retry: () => {
          if (!active) return;
          if (retryTimer !== undefined) {
            clearTimeout(retryTimer);
            retryTimer = undefined;
          }
          closeCurrent();
          connect();
        },
      };
      runtimesRef.current.set(profile.id, runtime);
    }

    return () => {
      for (const runtime of runtimesRef.current.values()) runtime.close();
      runtimesRef.current.clear();
    };
  }, [replaceThreads, settings, updateEnvironment, updateThreadSnapshot, upsertThreadSummary]);

  const selectThread = useCallback(
    async (environmentId: string, threadId: string | null) => {
      setSelectedEnvironmentId(environmentId);
      setSelectedThreadId(threadId);
      selectionRef.current = { environmentId, threadId };
      setActionError(null);
      if (threadId === null) {
        setThread(null);
        setThreadEnvironmentId(null);
        return;
      }
      const client = clientsRef.current.get(environmentId);
      if (client === undefined) {
        setThread(null);
        setThreadEnvironmentId(null);
        return;
      }
      setThreadLoading(true);
      try {
        const response = await Effect.runPromise(client.request("thread/resume", { threadId }));
        const projected = projectThreadDetail(response.thread);
        if (projected === null) throw new Error("The app-server returned an invalid thread.");
        const selected = selectionRef.current;
        if (selected.environmentId !== environmentId || selected.threadId !== threadId) return;
        setThread(projected);
        setThreadEnvironmentId(environmentId);
        const profile = settings?.connections.find((candidate) => candidate.id === environmentId);
        if (profile !== undefined) upsertThreadSummary(profile, response.thread);
      } catch (error) {
        setActionError(errorMessage(error));
      } finally {
        setThreadLoading(false);
      }
    },
    [settings?.connections, upsertThreadSummary],
  );

  const selectedEnvironment =
    selectedEnvironmentId === null ? null : (environmentStates[selectedEnvironmentId] ?? null);
  const fallbackEnvironment = settings?.connections[0]
    ? (environmentStates[settings.connections[0].id] ?? null)
    : null;
  const connection = selectedEnvironment ?? fallbackEnvironment;

  useEffect(() => {
    if (
      connection?.phase !== "connected" ||
      selectedThreadId === null ||
      selectedEnvironmentId === null
    ) {
      return;
    }
    if (thread?.id === selectedThreadId && threadEnvironmentId === selectedEnvironmentId) return;
    void selectThread(selectedEnvironmentId, selectedThreadId);
  }, [
    connection?.phase,
    selectThread,
    selectedEnvironmentId,
    selectedThreadId,
    thread?.id,
    threadEnvironmentId,
  ]);

  const startThread = useCallback(
    async (prompt: string, model: string | null) => {
      if (selectedEnvironmentId === null || prompt.trim().length === 0) return;
      const client = clientsRef.current.get(selectedEnvironmentId);
      const profile = environmentStates[selectedEnvironmentId]?.profile;
      if (client === undefined || profile === undefined) return;
      setActionError(null);
      setThreadLoading(true);
      try {
        const started = await Effect.runPromise(
          client.request("thread/start", {
            cwd: profile.connection.workspace,
            ...(model ? { model } : {}),
          }),
        );
        const projected = projectThreadDetail(started.thread);
        if (projected === null) throw new Error("The app-server returned an invalid thread.");
        setSelectedThreadId(projected.id);
        selectionRef.current = { environmentId: selectedEnvironmentId, threadId: projected.id };
        setThread(projected);
        setThreadEnvironmentId(selectedEnvironmentId);
        upsertThreadSummary(profile, started.thread);
        const response = await Effect.runPromise(
          client.request("turn/start", {
            threadId: projected.id,
            input: [{ type: "text", text: prompt.trim() }],
            ...(model ? { model } : {}),
          }),
        );
        setThread((current) => (current ? upsertTurn(current, response.turn) : current));
      } catch (error) {
        setActionError(errorMessage(error));
      } finally {
        setThreadLoading(false);
      }
    },
    [environmentStates, selectedEnvironmentId, upsertThreadSummary],
  );

  const sendTurn = useCallback(
    async (prompt: string, model: string | null) => {
      if (selectedEnvironmentId === null || thread === null || prompt.trim().length === 0) return;
      const client = clientsRef.current.get(selectedEnvironmentId);
      if (client === undefined) return;
      setActionError(null);
      try {
        const activeTurn = thread.turns.find((turn) => turn.status === "inProgress");
        if (activeTurn) {
          await Effect.runPromise(
            client.request("turn/steer", {
              threadId: thread.id,
              expectedTurnId: activeTurn.id,
              input: [{ type: "text", text: prompt.trim() }],
            }),
          );
        } else {
          const response = await Effect.runPromise(
            client.request("turn/start", {
              threadId: thread.id,
              input: [{ type: "text", text: prompt.trim() }],
              ...(model ? { model } : {}),
            }),
          );
          setThread((current) => (current ? upsertTurn(current, response.turn) : current));
        }
      } catch (error) {
        setActionError(errorMessage(error));
      }
    },
    [selectedEnvironmentId, thread],
  );

  const interruptTurn = useCallback(async () => {
    if (selectedEnvironmentId === null) return;
    const client = clientsRef.current.get(selectedEnvironmentId);
    const activeTurn = thread?.turns.find((turn) => turn.status === "inProgress");
    if (client === undefined || thread === null || activeTurn === undefined) return;
    try {
      await Effect.runPromise(
        client.request("turn/interrupt", { threadId: thread.id, turnId: activeTurn.id }),
      );
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }, [selectedEnvironmentId, thread]);

  const applySavedSettings = useCallback((saved: AppServerDesktopSettings) => {
    setSettings(saved);
    setEnvironmentStates((current) =>
      Object.fromEntries(
        saved.connections.map((profile) => {
          const previous = current[profile.id];
          return [
            profile.id,
            previous === undefined ? initialEnvironmentState(profile) : { ...previous, profile },
          ];
        }),
      ),
    );
    setSelectedEnvironmentId((current) =>
      current !== null && saved.connections.some((profile) => profile.id === current)
        ? current
        : (saved.connections[0]?.id ?? null),
    );
  }, []);

  const saveEnvironment = useCallback(
    async (draft: SettingsDraft) => {
      if (window.desktopBridge === undefined || settings === null) return false;
      setSettingsError(null);
      try {
        const profile = fromSettingsDraft(draft);
        const exists = settings.connections.some((candidate) => candidate.id === profile.id);
        const connections = exists
          ? settings.connections.map((candidate) =>
              candidate.id === profile.id ? profile : candidate,
            )
          : [...settings.connections, profile];
        const saved = await window.desktopBridge.saveAppServerSettings({ connections });
        applySavedSettings(saved);
        return true;
      } catch (error) {
        setSettingsError(errorMessage(error));
        return false;
      }
    },
    [applySavedSettings, settings],
  );

  const removeEnvironment = useCallback(
    async (environmentId: string) => {
      if (window.desktopBridge === undefined || settings === null || environmentId === "local") {
        return false;
      }
      setSettingsError(null);
      try {
        const saved = await window.desktopBridge.saveAppServerSettings({
          connections: settings.connections.filter((profile) => profile.id !== environmentId),
        });
        applySavedSettings(saved);
        if (selectedEnvironmentId === environmentId) {
          setSelectedThreadId(null);
          setThread(null);
          setThreadEnvironmentId(null);
        }
        return true;
      } catch (error) {
        setSettingsError(errorMessage(error));
        return false;
      }
    },
    [applySavedSettings, selectedEnvironmentId, settings],
  );

  const retry = useCallback(
    (environmentId = selectedEnvironmentId) => {
      if (environmentId !== null) runtimesRef.current.get(environmentId)?.retry();
    },
    [selectedEnvironmentId],
  );

  const beginRemotePairing = useCallback(
    async (environmentId = selectedEnvironmentId) => {
      if (environmentId === null) return;
      const client = clientsRef.current.get(environmentId);
      const environment = environmentStates[environmentId];
      if (client === undefined || environment === undefined) return;
      setRemote({
        connectionId: environmentId,
        pairing: null,
        clients: [],
        error: null,
        busy: true,
      });
      try {
        const status =
          environment.remote?.status === "connected"
            ? environment.remote
            : await Effect.runPromise(Remote.enable(client));
        const pairing = await Effect.runPromise(Remote.startPairing(client, { manualCode: true }));
        const clients = status.environmentId
          ? (await Effect.runPromise(Remote.listClients(client, status.environmentId))).data
          : [];
        updateEnvironment(environmentId, (current) => ({ ...current, remote: status }));
        setRemote({ connectionId: environmentId, pairing, clients, error: null, busy: false });
      } catch (error) {
        setRemote((current) => ({ ...current, busy: false, error: errorMessage(error) }));
      }
    },
    [environmentStates, selectedEnvironmentId, updateEnvironment],
  );

  const checkRemotePairing = useCallback(async () => {
    if (remote.connectionId === null || remote.pairing === null) return;
    const client = clientsRef.current.get(remote.connectionId);
    if (client === undefined) return;
    setRemote((current) => ({ ...current, busy: true }));
    try {
      const claimed = await Effect.runPromise(Remote.readPairingStatus(client, remote.pairing));
      if (!claimed) {
        setRemote((current) => ({
          ...current,
          busy: false,
          error: "The app-server reports that this pairing has not been claimed yet.",
        }));
        return;
      }
      const clients = (
        await Effect.runPromise(Remote.listClients(client, remote.pairing.environmentId))
      ).data;
      setRemote((current) => ({ ...current, pairing: null, clients, error: null, busy: false }));
    } catch (error) {
      setRemote((current) => ({ ...current, busy: false, error: errorMessage(error) }));
    }
  }, [remote.connectionId, remote.pairing]);

  const environments = useMemo(
    () =>
      settings?.connections
        .map((profile) => environmentStates[profile.id])
        .filter((environment): environment is EnvironmentState => environment !== undefined) ?? [],
    [environmentStates, settings?.connections],
  );
  const projects = useMemo(() => projectEnvironmentProjects(environments), [environments]);
  const pendingApproval =
    pendingApprovals.find(
      (approval) =>
        approval.environmentId === selectedEnvironmentId &&
        (selectedThreadId === null || approval.threadId === selectedThreadId),
    ) ?? null;

  return {
    settings,
    settingsError,
    sshHosts,
    environments,
    connection,
    selectedEnvironment,
    models: selectedEnvironment?.models ?? [],
    projects,
    selectedEnvironmentId,
    selectedThreadId,
    thread,
    threadLoading,
    actionError,
    pendingApproval,
    remote,
    selectThread,
    startThread,
    sendTurn,
    interruptTurn,
    saveEnvironment,
    removeEnvironment,
    retry,
    beginRemotePairing,
    checkRemotePairing,
  };
}
