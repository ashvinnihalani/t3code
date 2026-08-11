import * as CodexClient from "effect-codex-app-server/client";
import { fromMessagePort } from "effect-codex-app-server/transport";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { useEffect, useState } from "react";

import "./app-server-root.css";

interface ProbeSuccess {
  readonly ok: true;
  readonly value: unknown;
}

interface ProbeFailure {
  readonly ok: false;
  readonly error: string;
}

type ProbeResult = ProbeSuccess | ProbeFailure;

interface AppServerDiagnostics {
  readonly initialize: unknown;
  readonly account: ProbeResult;
  readonly models: ProbeResult;
  readonly skills: ProbeResult;
  readonly threads: ProbeResult;
}

type AppServerState =
  | { readonly status: "connecting" }
  | { readonly status: "ready"; readonly diagnostics: AppServerDiagnostics }
  | { readonly status: "error"; readonly message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function probe<A, E>(effect: Effect.Effect<A, E>): Effect.Effect<ProbeResult> {
  return Effect.match(effect, {
    onFailure: (error) => ({ ok: false, error: errorMessage(error) }),
    onSuccess: (value) => ({ ok: true, value }),
  });
}

function connectAndInspect(port: MessagePort, setState: (state: AppServerState) => void) {
  return Effect.gen(function* () {
    const scope = yield* Scope.make();
    const client = yield* CodexClient.make(fromMessagePort(port)).pipe(
      Effect.provideService(Scope.Scope, scope),
    );

    const initialize = yield* client.request("initialize", {
      clientInfo: {
        name: "t3-codex",
        title: "T3 Codex",
        version: import.meta.env.APP_VERSION,
      },
      capabilities: {
        experimentalApi: true,
        optOutNotificationMethods: null,
      },
    });
    yield* client.notify("initialized", undefined);

    const diagnostics = yield* Effect.all(
      {
        account: probe(client.request("account/read", {})),
        models: probe(client.request("model/list", {})),
        skills: probe(client.request("skills/list", {})),
        threads: probe(client.request("thread/list", {})),
      },
      { concurrency: "unbounded" },
    );

    yield* Effect.sync(() =>
      setState({ status: "ready", diagnostics: { initialize, ...diagnostics } }),
    );
    return scope;
  });
}

export function AppServerRoot() {
  const [state, setState] = useState<AppServerState>({ status: "connecting" });

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (bridge === undefined) {
      setState({ status: "error", message: "The Electron app-server bridge is unavailable." });
      return;
    }

    let active = true;
    let port: MessagePort | undefined;
    let scope: Scope.Closeable | undefined;
    const unsubscribe = bridge.connectAppServer(
      (connectedPort) => {
        port = connectedPort;
        Effect.runPromise(
          connectAndInspect(connectedPort, (next) => active && setState(next)),
        ).then(
          (connectedScope) => {
            if (active) {
              scope = connectedScope;
            } else {
              Effect.runFork(Scope.close(connectedScope, Exit.void));
            }
          },
          (error: unknown) => {
            if (active) setState({ status: "error", message: errorMessage(error) });
          },
        );
      },
      (message) => {
        if (active) setState({ status: "error", message });
      },
    );

    return () => {
      active = false;
      unsubscribe();
      port?.close();
      if (scope !== undefined) Effect.runFork(Scope.close(scope, Exit.void));
    };
  }, []);

  return (
    <main className="app-server-shell">
      <header className="app-server-header">
        <div>
          <p className="app-server-eyebrow">Desktop control harness</p>
          <h1>T3 Codex</h1>
        </div>
        <span className={`app-server-status app-server-status--${state.status}`}>
          {state.status}
        </span>
      </header>

      {state.status === "connecting" ? (
        <section className="app-server-panel">
          <h2>Connecting to app-server</h2>
          <p>The desktop is launching the runtime-configured managed stdio harness.</p>
        </section>
      ) : state.status === "error" ? (
        <section className="app-server-panel app-server-panel--error">
          <h2>App-server connection failed</h2>
          <p>{state.message}</p>
          <p className="app-server-hint">
            Configure T3CODE_APP_SERVER_EXECUTABLE, T3CODE_APP_SERVER_ARGS, and
            T3CODE_APP_SERVER_WORKSPACE before startup.
          </p>
        </section>
      ) : (
        <section className="app-server-panel">
          <h2>Compatibility diagnostics</h2>
          <p>
            Initialization succeeded. The response below comes directly from the configured
            app-server-compatible harness; no T3 Effect-RPC server is involved.
          </p>
          <pre>{JSON.stringify(state.diagnostics, null, 2)}</pre>
        </section>
      )}
    </main>
  );
}
