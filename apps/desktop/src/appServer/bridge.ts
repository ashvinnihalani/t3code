import type { IpcMain, IpcMainEvent, MessagePortMain } from "electron";
import { MessageChannelMain } from "electron";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import type { AppServerConnectionProfile } from "effect-codex-app-server/connection";

import {
  APP_SERVER_CONNECT_CHANNEL,
  APP_SERVER_ERROR_CHANNEL,
  APP_SERVER_PORT_CHANNEL,
} from "../ipc/channels.ts";
import {
  parseAppServerConnectionProfile,
  resolveConfiguredAppServerProcess,
} from "./configuration.ts";

interface AppServerConnection {
  readonly close: () => void;
}

export interface AppServerBridgeRuntime {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly writeDiagnostic: (message: string) => void;
}

function messageBytes(value: unknown): Uint8Array | undefined {
  if (typeof value === "string") return new TextEncoder().encode(value);
  return value instanceof Uint8Array ? value : undefined;
}

function forwardOutput(port: MessagePortMain, chunk: Uint8Array): void {
  try {
    port.postMessage(chunk);
  } catch {
    // The renderer closed between the child output event and delivery.
  }
}

function sendConnectionError(
  event: IpcMainEvent,
  connectionId: string | null,
  message: string,
): void {
  if (event.sender.isDestroyed()) return;
  event.sender.send(APP_SERVER_ERROR_CHANNEL, { connectionId, message });
}

const openConnection = Effect.fn("desktop.appServerBridge.openConnection")(function* (
  event: IpcMainEvent,
  profile: AppServerConnectionProfile,
  runtime: AppServerBridgeRuntime,
  onClosed: () => void,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const scope = yield* Scope.make("sequential");
  const input = yield* Queue.unbounded<Uint8Array, Cause.Done<void>>();
  const configuration = resolveConfiguredAppServerProcess(
    profile.connection,
    runtime.env,
    runtime.cwd,
    runtime.platform,
  );
  const child = yield* spawner
    .spawn(
      ChildProcess.make(configuration.executable, configuration.args, {
        cwd: configuration.cwd,
        env: configuration.env,
        stdin: { stream: Stream.fromQueue(input), endOnDone: true },
        stdout: "pipe",
        stderr: "pipe",
        detached: false,
        forceKillAfter: "3 seconds",
      }),
    )
    .pipe(
      Effect.provideService(Scope.Scope, scope),
      Effect.onError(() => Scope.close(scope, Exit.void).pipe(Effect.ignore)),
    );
  const { port1, port2 } = new MessageChannelMain();
  const context = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(context);
  let closed = false;
  let lastDiagnostic: string | null = null;

  const close = () => {
    if (closed) return;
    closed = true;
    port1.close();
    onClosed();
    runFork(Queue.end(input).pipe(Effect.andThen(Scope.close(scope, Exit.void)), Effect.ignore));
  };

  yield* child.stdout.pipe(
    Stream.runForEach((chunk) => Effect.sync(() => forwardOutput(port1, chunk))),
    Effect.forkIn(scope),
  );
  yield* child.stderr.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach((message) =>
      Effect.sync(() => {
        const diagnostic = message.trim();
        if (diagnostic.length > 0) lastDiagnostic = diagnostic;
        runtime.writeDiagnostic(message);
      }),
    ),
    Effect.ignore,
    Effect.forkIn(scope),
  );
  yield* child.exitCode.pipe(
    Effect.tap((code) =>
      Effect.sync(() => {
        if (!closed) {
          sendConnectionError(
            event,
            profile.id,
            `App-server connection closed with exit code ${String(code)}.${lastDiagnostic === null ? "" : ` ${lastDiagnostic}`}`,
          );
        }
      }),
    ),
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        if (!closed) sendConnectionError(event, profile.id, String(cause));
      }),
    ),
    Effect.ensuring(Effect.sync(close)),
    Effect.forkIn(scope),
  );

  port1.on("message", ({ data }) => {
    const bytes = messageBytes(data);
    if (bytes !== undefined && !closed) runFork(Queue.offer(input, bytes).pipe(Effect.asVoid));
  });
  port1.on("close", close);
  port1.start();

  event.sender.postMessage(APP_SERVER_PORT_CHANNEL, { connectionId: profile.id }, [port2]);
  return { close } satisfies AppServerConnection;
});

export const registerAppServerBridge = Effect.fn("desktop.appServerBridge.register")(function* (
  ipcMain: IpcMain,
  runtime: AppServerBridgeRuntime,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const context = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(context);
  const connections = new Map<string, AppServerConnection>();
  const attempts = new Map<string, symbol>();

  const handleConnect = (event: IpcMainEvent, value: unknown) => {
    let profile: AppServerConnectionProfile;
    try {
      profile = parseAppServerConnectionProfile(value);
    } catch (error) {
      const connectionId =
        typeof value === "object" && value !== null && "id" in value && typeof value.id === "string"
          ? value.id
          : null;
      sendConnectionError(
        event,
        connectionId,
        error instanceof Error ? error.message : String(error),
      );
      return;
    }

    const key = `${event.sender.id}:${profile.id}`;
    const attempt = Symbol(profile.id);
    attempts.set(key, attempt);
    connections.get(key)?.close();

    runFork(
      openConnection(event, profile, runtime, () => {
        if (attempts.get(key) === attempt) attempts.delete(key);
        connections.delete(key);
      }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.tap((connection) =>
          Effect.sync(() => {
            if (attempts.get(key) !== attempt || event.sender.isDestroyed()) {
              connection.close();
              return;
            }
            connections.set(key, connection);
            event.sender.once("destroyed", connection.close);
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            if (attempts.get(key) !== attempt) return;
            attempts.delete(key);
            sendConnectionError(event, profile.id, String(cause));
          }),
        ),
      ),
    );
  };

  yield* Effect.acquireRelease(
    Effect.sync(() => ipcMain.on(APP_SERVER_CONNECT_CHANNEL, handleConnect)),
    () =>
      Effect.sync(() => {
        ipcMain.removeListener(APP_SERVER_CONNECT_CHANNEL, handleConnect);
        attempts.clear();
        for (const connection of connections.values()) connection.close();
        connections.clear();
      }),
  );
});
