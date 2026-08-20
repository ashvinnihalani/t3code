import * as CodexClient from "effect-codex-app-server/client";
import type * as CodexError from "effect-codex-app-server/errors";
import type {
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
const CACHE_PREFIX = "t3-codex:app-server-cache:v2:";

type Client = CodexClient.CodexAppServerClient["Service"];

export interface SettingsDraft {
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
  readonly phase: "connecting" | "reconnecting" | "ready";
  readonly attempt: number;
  readonly error: string | null;
  readonly retryAt: number | null;
  readonly snapshot: CachedSnapshot | null;
  readonly account: unknown;
  readonly remote: Remote.RemoteControlStatus | null;
}

export interface RemoteDialogState {
  readonly pairing: Remote.RemoteControlPairing | null;
  readonly clients: ReadonlyArray<Remote.RemoteControlClient>;
  readonly error: string | null;
  readonly busy: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cacheKey(settings: AppServerDesktopSettings): string {
  const connection = settings.connection;
  const location = connection.kind === "ssh" ? connection.host : "local";
  return `${CACHE_PREFIX}${encodeURIComponent(`${connection.kind}:${location}:${connection.workspace}`)}`;
}

function readCache(settings: AppServerDesktopSettings): CachedSnapshot | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(settings));
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

function writeCache(settings: AppServerDesktopSettings, snapshot: CachedSnapshot): void {
  try {
    window.localStorage.setItem(cacheKey(settings), JSON.stringify(snapshot));
  } catch {
    // A full or disabled presentation cache must never break a live connection.
  }
}

export function toSettingsDraft(settings: AppServerDesktopSettings): SettingsDraft {
  const connection = settings.connection;
  return {
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

export function fromSettingsDraft(draft: SettingsDraft): AppServerDesktopSettings {
  const common = {
    executable: draft.executable.trim(),
    args: parseStringArray(draft.args),
    workspace: draft.workspace.trim(),
    env: parseEnvironment(draft.env),
  };
  if (!common.executable || !common.workspace) {
    throw new Error("Executable and workspace are required.");
  }
  if (draft.kind === "local") return { connection: { kind: "local", ...common } };
  if (!draft.host.trim()) throw new Error("SSH host is required.");
  const parsedPort = draft.port.trim() ? Number(draft.port) : null;
  if (
    parsedPort !== null &&
    (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535)
  ) {
    throw new Error("SSH port must be an integer from 1 to 65535.");
  }
  return {
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

export function useAppServerController() {
  const [settings, setSettings] = useState<AppServerDesktopSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [sshHosts, setSshHosts] = useState<ReadonlyArray<DiscoveredSshHost>>([]);
  const [connectionGeneration, setConnectionGeneration] = useState(0);
  const [connection, setConnection] = useState<ConnectionState>({
    phase: "connecting",
    attempt: 1,
    error: null,
    retryAt: null,
    snapshot: null,
    account: null,
    remote: null,
  });
  const [models, setModels] = useState<ReadonlyArray<ModelOption>>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteDialogState>({
    pairing: null,
    clients: [],
    error: null,
    busy: false,
  });
  const clientRef = useRef<Client | null>(null);

  const replaceThreads = useCallback(
    (threads: ReadonlyArray<ThreadSummary>) => {
      if (settings === null) return;
      const snapshot = { updatedAt: Date.now(), threads };
      writeCache(settings, snapshot);
      setConnection((current) => ({ ...current, snapshot }));
    },
    [settings],
  );

  const upsertThreadSummary = useCallback(
    (value: unknown) => {
      const summary = projectThreadSummary(value);
      if (summary === null) return;
      setConnection((current) => {
        const existing = current.snapshot?.threads ?? [];
        const threads = [summary, ...existing.filter((candidate) => candidate.id !== summary.id)];
        const snapshot = { updatedAt: Date.now(), threads };
        if (settings !== null) writeCache(settings, snapshot);
        return { ...current, snapshot };
      });
    },
    [settings],
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
        setConnection((current) => ({ ...current, snapshot: readCache(loaded) }));
      },
      (error: unknown) => setSettingsError(errorMessage(error)),
    );
    void bridge.discoverSshHosts().then(setSshHosts, () => setSshHosts([]));
  }, []);

  useEffect(() => {
    if (settings === null) return;
    const bridge = window.desktopBridge;
    if (bridge === undefined) return;

    let active = true;
    let attempt = 0;
    let port: MessagePort | undefined;
    let scope: Scope.Closeable | undefined;
    let unsubscribe: (() => void) | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const closeCurrent = () => {
      unsubscribe?.();
      unsubscribe = undefined;
      port?.close();
      port = undefined;
      if (scope !== undefined) Effect.runFork(Scope.close(scope, Exit.void));
      scope = undefined;
      clientRef.current = null;
    };

    const scheduleReconnect = (message: string) => {
      if (!active || retryTimer !== undefined) return;
      closeCurrent();
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 16_000;
      attempt += 1;
      setConnection((current) => ({
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

    const connectClient = (connectedPort: MessagePort) =>
      Effect.gen(function* () {
        const nextScope = yield* Scope.make();
        const client = yield* CodexClient.make(fromMessagePort(connectedPort)).pipe(
          Effect.provideService(Scope.Scope, nextScope),
        );

        yield* client.handleServerNotification("remoteControl/status/changed", (status) =>
          Effect.sync(() => {
            if (!active) return;
            setConnection((current) => ({
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
          Effect.sync(() => upsertThreadSummary(started)),
        );
        yield* client.handleServerNotification("thread/name/updated", ({ threadId, threadName }) =>
          Effect.sync(() => {
            setConnection((current) => ({
              ...current,
              snapshot: current.snapshot
                ? {
                    ...current.snapshot,
                    threads: current.snapshot.threads.map((item) =>
                      item.id === threadId ? { ...item, name: threadName ?? null } : item,
                    ),
                  }
                : null,
            }));
          }),
        );
        yield* client.handleServerNotification("turn/started", ({ threadId, turn }) =>
          Effect.sync(() => {
            setThread((current) =>
              current?.id === threadId ? upsertTurn(current, turn) : current,
            );
          }),
        );
        yield* client.handleServerNotification("turn/completed", ({ threadId, turn }) =>
          Effect.sync(() => {
            setThread((current) =>
              current?.id === threadId ? upsertTurn(current, turn) : current,
            );
          }),
        );
        yield* client.handleServerNotification("item/started", ({ item, threadId, turnId }) =>
          Effect.sync(() => {
            setThread((current) =>
              current?.id === threadId ? upsertTimelineItem(current, turnId, item) : current,
            );
          }),
        );
        yield* client.handleServerNotification("item/completed", ({ item, threadId, turnId }) =>
          Effect.sync(() => {
            setThread((current) =>
              current?.id === threadId ? upsertTimelineItem(current, turnId, item) : current,
            );
          }),
        );
        yield* client.handleServerNotification(
          "item/agentMessage/delta",
          ({ delta, itemId, threadId, turnId }) =>
            Effect.sync(() => {
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
      if (event.source !== window || event.data !== bridge.appServerPortMessage) return;
      const connectedPort = event.ports[0];
      if (connectedPort === undefined) return;
      if (!active) {
        connectedPort.close();
        return;
      }
      port = connectedPort;
      connectedPort.addEventListener("close", () =>
        scheduleReconnect("The app-server transport disconnected."),
      );
      Effect.runPromise(connectClient(connectedPort)).then(
        (loaded) => {
          if (!active) {
            Effect.runFork(Scope.close(loaded.scope, Exit.void));
            return;
          }
          scope = loaded.scope;
          clientRef.current = loaded.client;
          attempt = 0;
          replaceThreads(loaded.threads);
          setModels(loaded.models);
          setConnection((current) => ({
            ...current,
            phase: "ready",
            attempt: 1,
            error: null,
            retryAt: null,
            account: loaded.account,
            remote: loaded.remote,
          }));
        },
        (error: unknown) => scheduleReconnect(errorMessage(error)),
      );
    };

    window.addEventListener("message", handlePortMessage);

    const connect = () => {
      if (!active) return;
      setConnection((current) => ({
        ...current,
        phase: attempt === 0 ? "connecting" : "reconnecting",
        attempt: attempt + 1,
        error: attempt === 0 ? null : current.error,
        retryAt: null,
      }));
      unsubscribe = bridge.connectAppServer(settings, scheduleReconnect);
    };

    connect();
    return () => {
      active = false;
      window.removeEventListener("message", handlePortMessage);
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      closeCurrent();
    };
  }, [connectionGeneration, replaceThreads, settings, upsertThreadSummary]);

  const selectThread = useCallback(
    async (threadId: string | null) => {
      setSelectedThreadId(threadId);
      setActionError(null);
      if (threadId === null) {
        setThread(null);
        return;
      }
      const client = clientRef.current;
      if (client === null) return;
      setThreadLoading(true);
      try {
        const response = await Effect.runPromise(client.request("thread/resume", { threadId }));
        const projected = projectThreadDetail(response.thread);
        if (projected === null) throw new Error("The app-server returned an invalid thread.");
        setThread(projected);
        upsertThreadSummary(response.thread);
      } catch (error) {
        setActionError(errorMessage(error));
      } finally {
        setThreadLoading(false);
      }
    },
    [upsertThreadSummary],
  );

  useEffect(() => {
    if (connection.phase !== "ready" || selectedThreadId === null) return;
    if (thread?.id === selectedThreadId) return;
    void selectThread(selectedThreadId);
  }, [connection.phase, selectedThreadId, selectThread, thread?.id]);

  const startThread = useCallback(
    async (prompt: string, model: string | null) => {
      const client = clientRef.current;
      if (client === null || settings === null || prompt.trim().length === 0) return;
      setActionError(null);
      setThreadLoading(true);
      try {
        const started = await Effect.runPromise(
          client.request("thread/start", {
            cwd: settings.connection.workspace,
            ...(model ? { model } : {}),
          }),
        );
        const projected = projectThreadDetail(started.thread);
        if (projected === null) throw new Error("The app-server returned an invalid thread.");
        setSelectedThreadId(projected.id);
        setThread(projected);
        upsertThreadSummary(started.thread);
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
    [settings, upsertThreadSummary],
  );

  const sendTurn = useCallback(
    async (prompt: string, model: string | null) => {
      const client = clientRef.current;
      if (client === null || thread === null || prompt.trim().length === 0) return;
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
    [thread],
  );

  const interruptTurn = useCallback(async () => {
    const client = clientRef.current;
    const activeTurn = thread?.turns.find((turn) => turn.status === "inProgress");
    if (client === null || thread === null || activeTurn === undefined) return;
    try {
      await Effect.runPromise(
        client.request("turn/interrupt", { threadId: thread.id, turnId: activeTurn.id }),
      );
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }, [thread]);

  const saveSettings = useCallback(async (draft: SettingsDraft) => {
    if (window.desktopBridge === undefined) return false;
    setSettingsError(null);
    try {
      const saved = await window.desktopBridge.saveAppServerSettings(fromSettingsDraft(draft));
      setSettings(saved);
      setThread(null);
      setSelectedThreadId(null);
      setConnection((current) => ({ ...current, snapshot: readCache(saved) }));
      setConnectionGeneration((value) => value + 1);
      return true;
    } catch (error) {
      setSettingsError(errorMessage(error));
      return false;
    }
  }, []);

  const retry = useCallback(() => setConnectionGeneration((value) => value + 1), []);

  const beginRemotePairing = useCallback(async () => {
    const client = clientRef.current;
    if (client === null) return;
    setRemote((current) => ({ ...current, busy: true, error: null }));
    try {
      const status =
        connection.remote?.status === "connected"
          ? connection.remote
          : await Effect.runPromise(Remote.enable(client));
      const pairing = await Effect.runPromise(Remote.startPairing(client, { manualCode: true }));
      const clients = status.environmentId
        ? (await Effect.runPromise(Remote.listClients(client, status.environmentId))).data
        : [];
      setConnection((current) => ({ ...current, remote: status }));
      setRemote({ pairing, clients, error: null, busy: false });
    } catch (error) {
      setRemote((current) => ({ ...current, busy: false, error: errorMessage(error) }));
    }
  }, [connection.remote]);

  const checkRemotePairing = useCallback(async () => {
    const client = clientRef.current;
    if (client === null || remote.pairing === null) return;
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
      setRemote({ pairing: null, clients, error: null, busy: false });
    } catch (error) {
      setRemote((current) => ({ ...current, busy: false, error: errorMessage(error) }));
    }
  }, [remote.pairing]);

  const projects = useMemo(() => {
    const grouped = new Map<string, ThreadSummary[]>();
    for (const item of connection.snapshot?.threads ?? []) {
      const current = grouped.get(item.cwd) ?? [];
      current.push(item);
      grouped.set(item.cwd, current);
    }
    return [...grouped.entries()].map(([cwd, threads]) => ({ cwd, threads }));
  }, [connection.snapshot]);

  return {
    settings,
    settingsError,
    sshHosts,
    connection,
    models,
    projects,
    selectedThreadId,
    thread,
    threadLoading,
    actionError,
    remote,
    selectThread,
    startThread,
    sendTurn,
    interruptTurn,
    saveSettings,
    retry,
    beginRemotePairing,
    checkRemotePairing,
  };
}
