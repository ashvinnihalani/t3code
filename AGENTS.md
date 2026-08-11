# T3 Codex

T3 Codex is a desktop control harness for Codex app-server-compatible agents. It is a focused fork
of T3 Code, not a multi-provider T3 server.

## Non-negotiable boundary

- The app-server is authoritative for projects, threads, turns, items, account state, models,
  skills, Remote, and client coordination.
- The desktop may persist connection settings and presentation caches only.
- Do not add T3-specific RPC methods or a parallel conversation database.
- Do not import or special-case an agent harness such as Pi in renderer or desktop code.
- Remote links, codes, QR payloads, credentials, status, and clients must come from app-server's
  `remoteControl/*` methods. Never recreate T3 Connect.

## Repository map

- `apps/desktop` — Electron, local/SSH process launch, settings, and MessagePort bridge.
- `apps/web` — renderer, reconnection, and local presentation cache.
- `packages/effect-codex-app-server` — pinned generated protocol and transports.
- `packages/app-server-conformance` — black-box compatibility tests.
- `experiments/messages-glass-lab` — preserved experiment; do not remove during cleanup.

## Development

- `vp i` installs dependencies.
- `vp run dev` starts the renderer and Electron watchers.
- `vp run build:desktop` builds the renderer, main process, and preload.
- `vp run harness:verify -- ...` tests a compatible harness.

Use focused tests and typechecks for changed packages. Do not run GUI or browser tests without
explicit permission. Do not kill processes by name or pattern; terminate only PIDs captured when
starting a process.

Use conventional commits and keep protocol pin changes, client behavior, repository cleanup, and
documentation in separate commits.
