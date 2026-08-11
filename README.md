# T3 Codex

T3 Codex is a desktop control harness for coding agents that implement the Codex app-server
protocol. It is a stripped-down fork of [T3 Code](https://github.com/pingdotgg/t3code), retaining
the Electron presentation shell while replacing T3's server, provider adapters, Effect-RPC
contracts, cloud relay, and parallel conversation store with one app-server connection.

```text
T3 Codex renderer
        │ MessagePort + JSONL
        ▼
Codex-compatible app-server
        │
        ▼
agent harness
```

The app-server is authoritative for projects, threads, turns, items, account state, models, skills,
and Remote. T3 Codex stores only connection settings and a local presentation cache so the most
recent project/thread list remains visible while reconnecting.

## Current scope

- Launch a local app-server over stdio. The default command is `codex app-server`.
- Launch the same stdio protocol through OpenSSH on a configured remote machine.
- Initialize a generic compatible harness and show its account, model, skill, and thread data.
- Cache the last thread projection locally and refresh it from app-server after reconnecting.
- Retry dropped connections with bounded backoff.
- Present Remote status and pairing payloads returned by the official app-server
  `remoteControl/*` methods. T3 Codex does not create pairing links, QR payloads, credentials, or
  relay state.
- Exercise compatible harnesses with the black-box conformance package.

The inherited Pi/provider integration is intentionally out of scope. A harness may use any agent
runtime internally; the desktop only speaks app-server.

## Start from source

Requirements: Node.js 24.13.1 and [Vite+](https://viteplus.dev/guide/).

```bash
vp i
vp run dev
```

For a production-mode local run:

```bash
vp run build:desktop
vp run start:desktop
```

The first launch uses `codex app-server` in the repository directory. Change the executable,
arguments, workspace, environment, or SSH host from Settings. Startup defaults can also be set with
`T3CODE_APP_SERVER_EXECUTABLE`, `T3CODE_APP_SERVER_ARGS`, `T3CODE_APP_SERVER_WORKSPACE`, and
`T3CODE_APP_SERVER_ENV`.

## Test another app-server harness

```bash
vp run harness:verify -- \
  --executable /path/to/compatible-harness \
  --arg=app-server \
  --workspace /path/to/project \
  --trace-output /tmp/app-server-trace.json
```

See [Harness testing](./docs/operations/testing.md) for configuration and verification details.

## Repository

- `apps/desktop` — Electron lifecycle, settings, local/SSH process launch, and MessagePort bridge.
- `apps/web` — focused renderer and local presentation cache.
- `packages/effect-codex-app-server` — generated pinned schemas and JSONL client transport.
- `packages/app-server-conformance` — generic black-box compatibility harness.
- `experiments/messages-glass-lab` — preserved experimental workspace; not part of the desktop
  build.

Start with [the docs index](./docs/README.md) or [the architecture](./docs/internals/architecture.md).

T3 Codex is not affiliated with the upstream T3 Code maintainers or OpenAI. Upstream copyrights and
licenses remain with their respective owners.
