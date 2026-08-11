# T3 Codex

T3 Codex is a desktop-oriented fork of [T3 Code](https://github.com/pingdotgg/t3code). It is a
minimal control harness for coding agents exposed through a Codex app-server-compatible JSONL
endpoint.

The long-term boundary is deliberately small: T3 Codex owns desktop presentation and sends standard
app-server requests, while the selected harness owns agents, models, tools, skills, context, and
canonical conversation state. The UI does not integrate with a particular harness implementation.

## Why this fork exists

T3 Code already provides a polished, performant interface for controlling coding agents. T3 Codex
keeps that foundation while moving the desktop client toward a generic Codex app-server transport
instead of T3's provider-specific backend and parallel conversation model.

This fork is not affiliated with the upstream T3 Code maintainers or OpenAI. Upstream copyrights and
licenses remain with their respective owners.

## Current status

> [!WARNING]
> The app-server extraction is in progress. The generic conformance client is usable now, but the
> inherited desktop runtime has not yet been fully disconnected from the T3 backend. There is no
> packaged T3 Codex release yet.

The initial milestone pins the app-server protocol, validates raw JSON-RPC messages, normalizes
traces, checks lifecycle ordering, and can run the same client scenario against any executable
selected at runtime. Pi integration and Remote protocol work are intentionally outside this scope.

## Startup

Install Node.js 24.13.1 and [Vite+](https://viteplus.dev/guide/), then install the workspace:

```bash
vp i
```

Start the inherited desktop development stack:

```bash
vp run dev:desktop
```

For the server and web client without Electron, run:

```bash
vp run dev
```

### Test an app-server-compatible harness

The harness executable, arguments, environment, workspace, and timeout are runtime configuration;
the conformance package does not import harness-specific code.

```bash
cd packages/app-server-conformance
vp run verify-harness -- \
  --executable /path/to/app-server-compatible-harness \
  --arg=app-server \
  --arg=--stdio \
  --workspace /path/to/project \
  --trace-output /tmp/app-server-trace.json
```

See [the conformance package README](./packages/app-server-conformance/README.md) for environment-only
configuration and the compatibility report format.

## Some notes

The fork is very early. Expect bugs and incomplete desktop migration work.

We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## If you REALLY want to contribute still.... read this first

### Install `vp`

T3 Codex uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
