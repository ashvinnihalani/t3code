# Harness testing

Run the focused unit and integration suite:

```bash
vp test run \
  packages/effect-codex-app-server/src \
  packages/app-server-conformance/src \
  packages/app-server-conformance/test \
  apps/desktop/src/appServer
```

Verify a concrete app-server-compatible executable:

```bash
vp run harness:verify -- \
  --executable /path/to/harness \
  --arg=app-server \
  --workspace /path/to/project \
  --trace-output /tmp/app-server-trace.json
```

The black-box runner launches the executable without a shell, performs initialization, starts a
thread and turn, validates recorded messages against the pinned schemas, and checks lifecycle
ordering. Configuration can also be supplied with `T3_APP_SERVER_EXECUTABLE`,
`T3_APP_SERVER_ARGS_JSON`, `T3_APP_SERVER_CWD`, `T3_APP_SERVER_WORKSPACE`,
`T3_APP_SERVER_ENV_JSON`, `T3_APP_SERVER_TIMEOUT_MS`, and `T3_APP_SERVER_TRACE_OUTPUT`.

Build the desktop boundary separately:

```bash
vp run build:desktop
```

The Electron smoke test opens a GUI and may download the Electron runtime, so run it only in an
environment where GUI and network access are explicitly available:

```bash
vp run test:desktop-smoke
```
