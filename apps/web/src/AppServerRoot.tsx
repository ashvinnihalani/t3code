import * as CodexClient from "effect-codex-app-server/client";
import type {
  AppServerConnectionSettings,
  AppServerDesktopSettings,
  DiscoveredSshHost,
} from "effect-codex-app-server/connection";
import * as Remote from "effect-codex-app-server/remote";
import { fromMessagePort } from "effect-codex-app-server/transport";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import {
  CheckIcon,
  FolderIcon,
  MessageSquareIcon,
  MonitorCogIcon,
  RefreshCwIcon,
  SettingsIcon,
  SmartphoneIcon,
  WifiIcon,
  WifiOffIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const RETRY_DELAYS_MS = [3_000, 4_000, 8_000, 16_000] as const;
const CACHE_PREFIX = "t3-codex:app-server-cache:v1:";

interface CachedThread {
  readonly id: string;
  readonly cwd: string;
  readonly name: string | null;
  readonly preview: string;
  readonly updatedAt: number;
  readonly status: unknown;
}

interface CachedSnapshot {
  readonly updatedAt: number;
  readonly threads: ReadonlyArray<CachedThread>;
}

interface ConnectionState {
  readonly phase: "connecting" | "reconnecting" | "ready";
  readonly attempt: number;
  readonly error: string | null;
  readonly retryAt: number | null;
  readonly snapshot: CachedSnapshot | null;
  readonly account: unknown;
  readonly models: unknown;
  readonly remote: Remote.RemoteControlStatus | null;
}

interface SettingsDraft {
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

type Client = CodexClient.CodexAppServerClient["Service"];
type Page = "threads" | "settings";

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
    const parsed = JSON.parse(raw) as Partial<CachedSnapshot>;
    return typeof parsed.updatedAt === "number" && Array.isArray(parsed.threads)
      ? (parsed as CachedSnapshot)
      : null;
  } catch {
    return null;
  }
}

function writeCache(settings: AppServerDesktopSettings, snapshot: CachedSnapshot): void {
  try {
    window.localStorage.setItem(cacheKey(settings), JSON.stringify(snapshot));
  } catch {
    // A full or disabled browser store should not take down the live connection.
  }
}

function toDraft(settings: AppServerDesktopSettings): SettingsDraft {
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
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((entry) => typeof entry !== "string")
  ) {
    throw new Error("Environment must be a JSON object containing string values.");
  }
  return parsed as Record<string, string>;
}

function fromDraft(draft: SettingsDraft): AppServerDesktopSettings {
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

function threadFromUnknown(value: unknown): CachedThread | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const thread = value as Record<string, unknown>;
  if (typeof thread.id !== "string" || typeof thread.cwd !== "string") return null;
  return {
    id: thread.id,
    cwd: thread.cwd,
    name: typeof thread.name === "string" ? thread.name : null,
    preview: typeof thread.preview === "string" ? thread.preview : "",
    updatedAt: typeof thread.updatedAt === "number" ? thread.updatedAt : 0,
    status: thread.status,
  };
}

function readAllThreads(client: Client): Effect.Effect<ReadonlyArray<CachedThread>, unknown> {
  return Effect.gen(function* () {
    const threads: CachedThread[] = [];
    let cursor: string | null = null;
    do {
      const response: {
        readonly data: ReadonlyArray<unknown>;
        readonly nextCursor?: string | null;
      } = yield* client.request("thread/list", cursor === null ? {} : { cursor });
      for (const value of response.data) {
        const thread = threadFromUnknown(value);
        if (thread !== null) threads.push(thread);
      }
      cursor = response.nextCursor ?? null;
    } while (cursor !== null);
    return threads;
  });
}

function connectAndLoad(
  port: MessagePort,
  onRemoteStatus: (status: Remote.RemoteControlStatus) => void,
) {
  return Effect.gen(function* () {
    const scope = yield* Scope.make();
    const client = yield* CodexClient.make(fromMessagePort(port)).pipe(
      Effect.provideService(Scope.Scope, scope),
    );

    yield* client.handleServerNotification("remoteControl/status/changed", (status) =>
      Effect.sync(() => onRemoteStatus(status as Remote.RemoteControlStatus)),
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

    const [threads, account, models, remote] = yield* Effect.all(
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
      scope,
      threads,
      account,
      models,
      remote: remote._tag === "Some" ? remote.value : null,
    };
  });
}

function connectionLabel(connection: AppServerConnectionSettings): string {
  return connection.kind === "local"
    ? `Local · ${connection.workspace}`
    : `SSH · ${connection.username ? `${connection.username}@` : ""}${connection.host}`;
}

function projectLabel(cwd: string): string {
  return cwd.split(/[\\/]/u).filter(Boolean).at(-1) ?? cwd;
}

function threadLabel(thread: CachedThread): string {
  return (thread.name ?? thread.preview) || "Untitled thread";
}

function threadTime(updatedAt: number): string {
  if (updatedAt <= 0) return "Cached";
  const elapsed = Math.max(0, Date.now() / 1_000 - updatedAt);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (elapsed < 60) return "now";
  if (elapsed < 3_600) return formatter.format(-Math.round(elapsed / 60), "minute");
  if (elapsed < 86_400) return formatter.format(-Math.round(elapsed / 3_600), "hour");
  if (elapsed < 604_800) return formatter.format(-Math.round(elapsed / 86_400), "day");
  return new Date(updatedAt * 1_000).toLocaleDateString();
}

function T3Wordmark() {
  return (
    <svg
      aria-label="T3"
      className="h-2.5 w-auto shrink-0"
      viewBox="15.5309 37 94.3941 56.96"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function AppServerRoot() {
  const [settings, setSettings] = useState<AppServerDesktopSettings | null>(null);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [page, setPage] = useState<Page>("threads");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
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
    models: null,
    remote: null,
  });
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [remotePairing, setRemotePairing] = useState<Remote.RemoteControlPairing | null>(null);
  const [remoteClients, setRemoteClients] = useState<ReadonlyArray<Remote.RemoteControlClient>>([]);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const clientRef = useRef<Client | null>(null);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (bridge === undefined) {
      setSettingsError("The Electron app-server bridge is unavailable.");
      return;
    }
    void bridge.getAppServerSettings().then(
      (loaded) => {
        setSettings(loaded);
        setDraft(toDraft(loaded));
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
      Effect.runPromise(
        connectAndLoad(connectedPort, (remote) => {
          if (active) setConnection((current) => ({ ...current, remote }));
        }),
      ).then(
        (loaded) => {
          if (!active) {
            Effect.runFork(Scope.close(loaded.scope, Exit.void));
            return;
          }
          scope = loaded.scope;
          clientRef.current = loaded.client;
          attempt = 0;
          const snapshot = { updatedAt: Date.now(), threads: loaded.threads };
          writeCache(settings, snapshot);
          setConnection({
            phase: "ready",
            attempt: 1,
            error: null,
            retryAt: null,
            snapshot,
            account: loaded.account,
            models: loaded.models,
            remote: loaded.remote,
          });
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
  }, [settings, connectionGeneration]);

  const projects = useMemo(() => {
    const grouped = new Map<string, CachedThread[]>();
    for (const thread of connection.snapshot?.threads ?? []) {
      const current = grouped.get(thread.cwd) ?? [];
      current.push(thread);
      grouped.set(thread.cwd, current);
    }
    return [...grouped.entries()].map(([cwd, threads]) => ({ cwd, threads }));
  }, [connection.snapshot]);
  const selectedThread = useMemo(
    () => connection.snapshot?.threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [connection.snapshot, selectedThreadId],
  );

  const saveSettings = useCallback(async () => {
    if (draft === null || window.desktopBridge === undefined) return;
    setSettingsError(null);
    try {
      const saved = await window.desktopBridge.saveAppServerSettings(fromDraft(draft));
      setSettings(saved);
      setDraft(toDraft(saved));
      setConnection((current) => ({ ...current, snapshot: readCache(saved) }));
      setConnectionGeneration((value) => value + 1);
      setPage("threads");
    } catch (error) {
      setSettingsError(errorMessage(error));
    }
  }, [draft]);

  const beginRemotePairing = useCallback(async () => {
    const client = clientRef.current;
    if (client === null) return;
    setRemoteBusy(true);
    setRemoteError(null);
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
      setRemotePairing(pairing);
      setRemoteClients(clients);
    } catch (error) {
      setRemoteError(errorMessage(error));
    } finally {
      setRemoteBusy(false);
    }
  }, [connection.remote]);

  const checkPairing = useCallback(async () => {
    const client = clientRef.current;
    if (client === null || remotePairing === null) return;
    setRemoteBusy(true);
    try {
      const claimed = await Effect.runPromise(Remote.readPairingStatus(client, remotePairing));
      if (!claimed) {
        setRemoteError("The app-server reports that this pairing has not been claimed yet.");
      } else {
        setRemoteError(null);
        setRemotePairing(null);
        const page = await Effect.runPromise(
          Remote.listClients(client, remotePairing.environmentId),
        );
        setRemoteClients(page.data);
      }
    } catch (error) {
      setRemoteError(errorMessage(error));
    } finally {
      setRemoteBusy(false);
    }
  }, [remotePairing]);

  if (settings === null || draft === null) {
    return (
      <main className="grid h-dvh place-items-center bg-background text-sm text-muted-foreground">
        <p>{settingsError ?? "Loading T3 Codex…"}</p>
      </main>
    );
  }

  return (
    <main className="flex h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <aside
        className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
        data-sidebar-version="v2"
      >
        <header className="drag-region flex h-[var(--workspace-topbar-height)] shrink-0 items-center pl-[90px] pr-3">
          <button
            className="no-drag-region flex min-w-0 items-center gap-1 rounded-md outline-none ring-ring focus-visible:ring-2"
            onClick={() => {
              setPage("threads");
              setSelectedThreadId(null);
            }}
          >
            <T3Wordmark />
            <span className="truncate text-sm font-medium tracking-tight text-muted-foreground">
              Codex
            </span>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <button
            className={`mb-3 flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm font-medium transition-colors ${
              page === "threads" && selectedThread === null
                ? "bg-sidebar-row-active text-sidebar-foreground shadow-sm"
                : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
            }`}
            onClick={() => {
              setPage("threads");
              setSelectedThreadId(null);
            }}
          >
            <MessageSquareIcon className="size-4" />
            Threads
          </button>

          {projects.map((project) => (
            <section className="mb-4" key={project.cwd}>
              <div className="flex h-7 items-center gap-2 px-2 text-xs font-medium text-sidebar-muted-foreground">
                <FolderIcon className="size-3.5" />
                <span className="truncate">{projectLabel(project.cwd)}</span>
              </div>
              <div className="grid gap-0.5">
                {project.threads.map((thread) => {
                  const active = page === "threads" && selectedThreadId === thread.id;
                  return (
                    <button
                      className={`group relative flex min-h-9 w-full items-center rounded-md px-2 text-left transition-colors ${
                        active
                          ? "bg-sidebar-row-active text-sidebar-foreground shadow-sm"
                          : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                      }`}
                      key={thread.id}
                      onClick={() => {
                        setPage("threads");
                        setSelectedThreadId(thread.id);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate pr-2 text-[13px] font-medium">
                        {threadLabel(thread)}
                      </span>
                      <span className="shrink-0 text-[10px] text-sidebar-muted-foreground/70">
                        {threadTime(thread.updatedAt)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}

          {projects.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs leading-relaxed text-sidebar-muted-foreground">
              Threads from the connected app-server will appear here.
            </p>
          ) : null}
        </div>

        <footer className="grid gap-1 border-t border-sidebar-border p-2">
          <div className="flex items-center gap-2 rounded-md px-2 py-2 text-xs text-sidebar-muted-foreground">
            <span
              className={`size-2 shrink-0 rounded-full ${
                connection.phase === "ready" ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
            <span className="min-w-0 flex-1 truncate">
              {connection.phase === "ready" ? "Connected" : "Reconnecting"}
            </span>
            {connection.phase === "ready" ? (
              <WifiIcon className="size-3.5" />
            ) : (
              <WifiOffIcon className="size-3.5" />
            )}
          </div>
          <button
            className={`flex h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors ${
              page === "settings"
                ? "bg-sidebar-row-active text-sidebar-foreground shadow-sm"
                : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
            }`}
            onClick={() => setPage("settings")}
          >
            <SettingsIcon className="size-4" />
            Settings
          </button>
        </footer>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <header className="drag-region flex h-[var(--workspace-topbar-height)] shrink-0 items-center gap-3 border-b border-border px-5">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-medium">
              {page === "settings"
                ? "Settings"
                : selectedThread === null
                  ? "T3 Codex"
                  : threadLabel(selectedThread)}
            </h1>
            {page === "threads" && selectedThread !== null ? (
              <p className="truncate text-[11px] text-muted-foreground">{selectedThread.cwd}</p>
            ) : null}
          </div>
          {connection.phase !== "ready" ? (
            <button
              className="no-drag-region inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent"
              onClick={() => setConnectionGeneration((value) => value + 1)}
            >
              <RefreshCwIcon className="size-3.5" />
              Retry
            </button>
          ) : null}
          <button
            className="no-drag-region inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={connection.phase !== "ready"}
            onClick={() => {
              setRemoteOpen(true);
              void beginRemotePairing();
            }}
          >
            <SmartphoneIcon className="size-3.5" />
            Remote
          </button>
        </header>

        {connection.error ? (
          <div className="flex items-start gap-3 border-b border-amber-500/20 bg-amber-500/8 px-5 py-3 text-xs text-amber-700 dark:text-amber-300">
            <WifiOffIcon className="mt-0.5 size-4 shrink-0" />
            <div>
              <strong className="font-medium">
                {connection.phase === "reconnecting"
                  ? "Reconnecting to app-server"
                  : "Connection issue"}
              </strong>
              <p className="mt-0.5 text-amber-700/75 dark:text-amber-300/75">{connection.error}</p>
            </div>
          </div>
        ) : null}

        {page === "threads" ? (
          selectedThread === null ? (
            <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-8">
              <div className="w-full max-w-lg text-center">
                <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  What should we work on?
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Select a thread from the sidebar to continue with the connected app-server.
                </p>
                <div className="mt-8 rounded-2xl border border-border bg-card/35 p-4 text-left shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="grid size-9 place-items-center rounded-lg border border-border bg-background text-muted-foreground">
                      <MonitorCogIcon className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{connectionLabel(settings.connection)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {connection.snapshot?.threads.length ?? 0} cached threads · app-server is
                        authoritative
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-10">
                <div className="mx-auto max-w-3xl">
                  <div className="mb-10 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="rounded-full border border-border bg-muted px-2.5 py-1">
                      App-server thread
                    </span>
                    <span>{threadTime(selectedThread.updatedAt)}</span>
                  </div>
                  <article className="rounded-2xl border border-border bg-card/30 p-5">
                    <div className="flex gap-3">
                      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                        <MessageSquareIcon className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <h2 className="text-sm font-semibold">{threadLabel(selectedThread)}</h2>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                          {selectedThread.preview || "This thread has no cached preview yet."}
                        </p>
                      </div>
                    </div>
                  </article>
                  <p className="mt-5 text-center text-xs text-muted-foreground">
                    Full timeline projection will be loaded from app-server; this view currently
                    uses the local presentation cache.
                  </p>
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-5xl gap-10 px-8 py-10">
              <nav className="w-44 shrink-0">
                <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">Desktop</p>
                <button className="flex h-9 w-full items-center gap-2 rounded-md bg-accent px-2 text-sm font-medium">
                  <MonitorCogIcon className="size-4" />
                  Connection
                </button>
              </nav>
              <form
                className="min-w-0 flex-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveSettings();
                }}
              >
                <div className="mb-8">
                  <h2 className="text-xl font-semibold tracking-tight">Connection</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Choose the Codex-compatible app-server controlled by this desktop.
                  </p>
                </div>

                <section className="border-b border-border py-6 first:pt-0">
                  <div className="flex items-start justify-between gap-8">
                    <div>
                      <h3 className="text-sm font-medium">App-server location</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Launch on this Mac or through an existing OpenSSH host.
                      </p>
                    </div>
                    <div className="flex rounded-lg border border-border bg-muted p-1">
                      {(["local", "ssh"] as const).map((kind) => (
                        <button
                          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                            draft.kind === kind
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                          key={kind}
                          type="button"
                          onClick={() => setDraft({ ...draft, kind })}
                        >
                          {kind === "local" ? "Local" : "Remote SSH"}
                        </button>
                      ))}
                    </div>
                  </div>
                </section>

                <div className="grid grid-cols-2 gap-5 py-6">
                  {draft.kind === "ssh" ? (
                    <>
                      <label className="grid gap-2 text-xs font-medium">
                        SSH host
                        <input
                          className="h-9 rounded-md border border-input bg-background px-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ring/40"
                          list="ssh-hosts"
                          value={draft.host}
                          onChange={(event) => setDraft({ ...draft, host: event.target.value })}
                        />
                        <datalist id="ssh-hosts">
                          {sshHosts.map((host) => (
                            <option value={host.alias} key={host.alias} />
                          ))}
                        </datalist>
                      </label>
                      <label className="grid gap-2 text-xs font-medium">
                        Username
                        <input
                          className="h-9 rounded-md border border-input bg-background px-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ring/40"
                          placeholder="From SSH config"
                          value={draft.username}
                          onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                        />
                      </label>
                      <label className="grid gap-2 text-xs font-medium">
                        Port
                        <input
                          className="h-9 rounded-md border border-input bg-background px-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ring/40"
                          inputMode="numeric"
                          placeholder="22"
                          value={draft.port}
                          onChange={(event) => setDraft({ ...draft, port: event.target.value })}
                        />
                      </label>
                      <label className="grid gap-2 text-xs font-medium">
                        Identity file
                        <input
                          className="h-9 rounded-md border border-input bg-background px-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ring/40"
                          placeholder="From SSH config or agent"
                          value={draft.identityFile}
                          onChange={(event) =>
                            setDraft({ ...draft, identityFile: event.target.value })
                          }
                        />
                      </label>
                    </>
                  ) : null}
                  <label className="grid gap-2 text-xs font-medium">
                    Executable
                    <input
                      className="h-9 rounded-md border border-input bg-background px-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ring/40"
                      value={draft.executable}
                      onChange={(event) => setDraft({ ...draft, executable: event.target.value })}
                    />
                  </label>
                  <label className="grid gap-2 text-xs font-medium">
                    Workspace
                    <input
                      className="h-9 rounded-md border border-input bg-background px-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ring/40"
                      value={draft.workspace}
                      onChange={(event) => setDraft({ ...draft, workspace: event.target.value })}
                    />
                  </label>
                  <label className="col-span-2 grid gap-2 text-xs font-medium">
                    Arguments (JSON)
                    <textarea
                      className="min-h-24 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring/40"
                      value={draft.args}
                      onChange={(event) => setDraft({ ...draft, args: event.target.value })}
                    />
                  </label>
                  <label className="col-span-2 grid gap-2 text-xs font-medium">
                    Environment (JSON)
                    <textarea
                      className="min-h-28 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring/40"
                      value={draft.env}
                      onChange={(event) => setDraft({ ...draft, env: event.target.value })}
                    />
                  </label>
                </div>
                {settingsError ? (
                  <p className="mb-4 text-xs text-destructive-foreground">{settingsError}</p>
                ) : null}
                <div className="flex justify-end border-t border-border pt-5">
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                    type="submit"
                  >
                    <CheckIcon className="size-3.5" />
                    Save and reconnect
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </section>

      {remoteOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
          role="presentation"
          onMouseDown={() => setRemoteOpen(false)}
        >
          <section
            className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Remote pairing"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-semibold">Pair your phone</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Pair through the official app-server Remote service.
                </p>
              </div>
              <button
                className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setRemoteOpen(false)}
                aria-label="Close"
              >
                <XIcon className="size-4" />
              </button>
            </div>
            <div className="grid gap-4 p-5">
              {remoteBusy && remotePairing === null ? (
                <p className="text-sm text-muted-foreground">
                  Requesting pairing details from app-server…
                </p>
              ) : null}
              {remoteError ? (
                <p className="rounded-lg border border-destructive/20 bg-destructive/8 p-3 text-xs text-destructive-foreground">
                  {remoteError}
                </p>
              ) : null}
              {remotePairing ? (
                <div className="grid gap-4">
                  <output className="rounded-xl border border-border bg-muted p-5 text-center font-mono text-2xl font-semibold tracking-[0.18em]">
                    {remotePairing.manualPairingCode ?? remotePairing.pairingCode}
                  </output>
                  {remotePairing.manualPairingCode !== null ? (
                    <details className="text-xs text-muted-foreground">
                      <summary>App-server pairing payload</summary>
                      <code className="mt-2 block [overflow-wrap:anywhere] rounded-md bg-muted p-3">
                        {remotePairing.pairingCode}
                      </code>
                    </details>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    Expires {new Date(remotePairing.expiresAt * 1000).toLocaleString()}
                  </p>
                  <button
                    className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
                    disabled={remoteBusy}
                    onClick={() => void checkPairing()}
                  >
                    Check pairing
                  </button>
                </div>
              ) : null}
              {remoteClients.length > 0 ? (
                <div>
                  <h3 className="mb-2 text-xs font-medium text-muted-foreground">Paired clients</h3>
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {remoteClients.map((client) => (
                      <div className="grid gap-0.5 px-3 py-2.5" key={client.clientId}>
                        <strong className="text-xs font-medium">
                          {client.displayName ?? client.deviceModel ?? "Remote client"}
                        </strong>
                        <small className="text-[11px] text-muted-foreground">
                          {client.platform ?? client.deviceType ?? client.clientId}
                        </small>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
