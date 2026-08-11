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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "./app-server-root.css";

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

export function AppServerRoot() {
  const [settings, setSettings] = useState<AppServerDesktopSettings | null>(null);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [page, setPage] = useState<Page>("threads");
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

    const connect = () => {
      if (!active) return;
      setConnection((current) => ({
        ...current,
        phase: attempt === 0 ? "connecting" : "reconnecting",
        attempt: attempt + 1,
        error: attempt === 0 ? null : current.error,
        retryAt: null,
      }));
      unsubscribe = bridge.connectAppServer(
        settings,
        (connectedPort) => {
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
        },
        scheduleReconnect,
      );
    };

    connect();
    return () => {
      active = false;
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
      <main className="harness-loading">
        <p>{settingsError ?? "Loading T3 Codex…"}</p>
      </main>
    );
  }

  return (
    <main className="harness-shell">
      <aside className="harness-sidebar">
        <div className="harness-brand">
          <span className="harness-mark">T3</span>
          <div>
            <strong>T3 Codex</strong>
            <small>App-server control harness</small>
          </div>
        </div>
        <nav>
          <button className={page === "threads" ? "active" : ""} onClick={() => setPage("threads")}>
            Threads
          </button>
          <button
            className={page === "settings" ? "active" : ""}
            onClick={() => setPage("settings")}
          >
            Settings
          </button>
        </nav>
        <div className="harness-connection-summary">
          <span className={`connection-dot connection-dot--${connection.phase}`} />
          <div>
            <strong>{connection.phase}</strong>
            <small>{connectionLabel(settings.connection)}</small>
          </div>
        </div>
      </aside>

      <section className="harness-content">
        <header className="harness-toolbar">
          <div>
            <p className="harness-eyebrow">
              {page === "threads" ? "Local presentation cache" : "Desktop settings"}
            </p>
            <h1>{page === "threads" ? "Projects and threads" : "Connection"}</h1>
          </div>
          <div className="toolbar-actions">
            {connection.phase !== "ready" ? (
              <button
                className="button-secondary"
                onClick={() => setConnectionGeneration((value) => value + 1)}
              >
                Retry now
              </button>
            ) : null}
            <button
              className="button-primary"
              disabled={connection.phase !== "ready"}
              onClick={() => {
                setRemoteOpen(true);
                void beginRemotePairing();
              }}
            >
              Remote
            </button>
          </div>
        </header>

        {connection.error ? (
          <div className="connection-banner">
            <strong>
              {connection.phase === "reconnecting" ? "Reconnecting" : "Connection issue"}
            </strong>
            <span>{connection.error}</span>
          </div>
        ) : null}

        {page === "threads" ? (
          <div className="project-grid">
            {projects.map((project) => (
              <article className="project-card" key={project.cwd}>
                <div className="project-heading">
                  <h2>{project.cwd.split(/[\\/]/u).filter(Boolean).at(-1) ?? project.cwd}</h2>
                  <code>{project.cwd}</code>
                </div>
                <div className="thread-list">
                  {project.threads.map((thread) => (
                    <div className="thread-row" key={thread.id}>
                      <div>
                        <strong>{(thread.name ?? thread.preview) || "Untitled thread"}</strong>
                        <small>{thread.preview || thread.id}</small>
                      </div>
                      <time>
                        {thread.updatedAt > 0
                          ? new Date(thread.updatedAt * 1000).toLocaleString()
                          : "Cached"}
                      </time>
                    </div>
                  ))}
                </div>
              </article>
            ))}
            {projects.length === 0 ? (
              <div className="empty-state">
                <h2>No cached threads</h2>
                <p>
                  Threads returned by the configured app-server will be grouped by workspace and
                  cached on this desktop.
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <form
            className="settings-card"
            onSubmit={(event) => {
              event.preventDefault();
              void saveSettings();
            }}
          >
            <div className="settings-section">
              <div>
                <h2>App-server location</h2>
                <p>Launch locally or through your existing OpenSSH configuration and agent.</p>
              </div>
              <div className="segmented-control">
                <button
                  type="button"
                  className={draft.kind === "local" ? "active" : ""}
                  onClick={() => setDraft({ ...draft, kind: "local" })}
                >
                  Local
                </button>
                <button
                  type="button"
                  className={draft.kind === "ssh" ? "active" : ""}
                  onClick={() => setDraft({ ...draft, kind: "ssh" })}
                >
                  Remote SSH
                </button>
              </div>
            </div>
            {draft.kind === "ssh" ? (
              <div className="field-grid">
                <label>
                  <span>SSH host</span>
                  <input
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
                <label>
                  <span>Username</span>
                  <input
                    value={draft.username}
                    onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                    placeholder="From SSH config"
                  />
                </label>
                <label>
                  <span>Port</span>
                  <input
                    inputMode="numeric"
                    value={draft.port}
                    onChange={(event) => setDraft({ ...draft, port: event.target.value })}
                    placeholder="22"
                  />
                </label>
                <label>
                  <span>Identity file</span>
                  <input
                    value={draft.identityFile}
                    onChange={(event) => setDraft({ ...draft, identityFile: event.target.value })}
                    placeholder="From SSH config or agent"
                  />
                </label>
              </div>
            ) : null}
            <div className="field-grid">
              <label>
                <span>Executable</span>
                <input
                  value={draft.executable}
                  onChange={(event) => setDraft({ ...draft, executable: event.target.value })}
                />
              </label>
              <label>
                <span>Workspace</span>
                <input
                  value={draft.workspace}
                  onChange={(event) => setDraft({ ...draft, workspace: event.target.value })}
                />
              </label>
              <label className="field-wide">
                <span>Arguments (JSON)</span>
                <textarea
                  rows={4}
                  value={draft.args}
                  onChange={(event) => setDraft({ ...draft, args: event.target.value })}
                />
              </label>
              <label className="field-wide">
                <span>Environment (JSON)</span>
                <textarea
                  rows={5}
                  value={draft.env}
                  onChange={(event) => setDraft({ ...draft, env: event.target.value })}
                />
              </label>
            </div>
            {settingsError ? <p className="form-error">{settingsError}</p> : null}
            <div className="settings-actions">
              <button className="button-primary" type="submit">
                Save and reconnect
              </button>
            </div>
          </form>
        )}
      </section>

      {remoteOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setRemoteOpen(false)}
        >
          <section
            className="remote-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Remote pairing"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="remote-header">
              <div>
                <p className="harness-eyebrow">Official app-server Remote</p>
                <h2>Pair your phone</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setRemoteOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            {remoteBusy && remotePairing === null ? (
              <p>Requesting pairing details from app-server…</p>
            ) : null}
            {remoteError ? <p className="form-error">{remoteError}</p> : null}
            {remotePairing ? (
              <div className="pairing-payload">
                <p>Use the pairing value supplied by the connected app-server:</p>
                <output>{remotePairing.manualPairingCode ?? remotePairing.pairingCode}</output>
                {remotePairing.manualPairingCode !== null ? (
                  <details>
                    <summary>App-server pairing payload</summary>
                    <code>{remotePairing.pairingCode}</code>
                  </details>
                ) : null}
                <small>Expires {new Date(remotePairing.expiresAt * 1000).toLocaleString()}</small>
                <button
                  className="button-secondary"
                  disabled={remoteBusy}
                  onClick={() => void checkPairing()}
                >
                  Check pairing
                </button>
              </div>
            ) : null}
            {remoteClients.length > 0 ? (
              <div className="remote-clients">
                <h3>Paired clients</h3>
                {remoteClients.map((client) => (
                  <div key={client.clientId}>
                    <strong>{client.displayName ?? client.deviceModel ?? "Remote client"}</strong>
                    <small>{client.platform ?? client.deviceType ?? client.clientId}</small>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}
