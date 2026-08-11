# App-server conformance

This package exercises T3 Codex's client-side initialization and core thread/turn lifecycle against a
JSONL app-server selected at runtime. The harness is launched directly, without a shell or any
provider-specific imports.

From this package, run:

```sh
vp run verify-harness -- \
  --executable /path/to/harness \
  --arg=app-server \
  --arg=--stdio \
  --workspace /path/to/project \
  --trace-output /tmp/app-server-trace.json
```

Arguments that begin with a dash should use the `--arg=value` form. Configuration may instead come
from `T3_APP_SERVER_EXECUTABLE`, `T3_APP_SERVER_ARGS_JSON`, `T3_APP_SERVER_CWD`,
`T3_APP_SERVER_WORKSPACE`, `T3_APP_SERVER_ENV_JSON`, `T3_APP_SERVER_TIMEOUT_MS`, and
`T3_APP_SERVER_TRACE_OUTPUT`.

The command exits successfully only after initialization, `thread/start`, and `turn/start` complete,
every recorded message validates against the generated pinned protocol schemas, and streamed events
preserve the required thread, turn, item, delta, and completion ordering. Its JSON report lists the
observed methods. An optional trace file contains the normalized transcript suitable for comparing
compatible harnesses.
