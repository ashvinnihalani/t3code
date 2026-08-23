# T3 Codex

T3 Codex is a desktop control harness for Codex app-server compatible agents. It is a focused fork of [T3 Code](https://github.com/pingdotgg/t3code) that keeps T3 Code's desktop UI and interaction patterns while replacing its provider/server control plane with direct app-server connections.

The desktop can run a local app-server and any number of app-servers over SSH at the same time. Projects and thread summaries are cached locally, connections retry after disconnects, and each connection can expose the app-server's own Remote pairing flow.

## Requirements

- macOS, Windows, or Linux
- [mise](https://mise.jdx.dev/) for repository tooling
- A compatible executable on each host. The default is `codex app-server`.
- For SSH connections, an OpenSSH host reachable by the desktop and a compatible executable installed on that host. Persistent connections link the user-configured executable into Codex's daemon runtime without enabling the standalone updater.

Authenticate Codex on each machine before connecting:

```bash
codex login
```

## Start from source

Install the pinned Node.js and pnpm versions, then install dependencies:

```bash
mise install
mise exec node@24.13.1 pnpm@11.10.0 -- pnpm install
```

Start the web renderer for desktop development:

```bash
mise exec node@24.13.1 pnpm@11.10.0 -- pnpm dev:web
```

In another terminal, start Electron with the renderer URL shown by Vite:

```bash
VITE_DEV_SERVER_URL=http://127.0.0.1:5173 \
  mise exec node@24.13.1 pnpm@11.10.0 -- pnpm start:desktop
```

The exact Vite port can change when the default port is occupied.

## Use T3 Codex

Open Settings → Connections to configure:

- Local: executable, arguments, workspace, and environment for an app-server on this machine.
- SSH: multiple independent OpenSSH hosts, each with its own executable, arguments, workspace, and environment.

All enabled connections stay available together. Select a connection when adding a project. Use Pair on a connection to request its app-server Remote pairing presentation. Use Open In from a project or thread to open that workspace locally or through an editor's SSH integration.

## Build a macOS image

```bash
mise exec node@24.13.1 pnpm@11.10.0 -- pnpm dist:desktop:dmg:arm64
```

Artifacts are written to `release/` and are named `T3-Codex-<version>-<arch>.dmg`.

## Documentation

- [Getting started](./docs/getting-started.md)
- [Connections and remote hosts](./docs/connections.md)
- [Architecture](./docs/architecture.md)
- [Development and releases](./docs/development.md)

T3 Codex remains derived from T3 Code and retains its upstream license. Changes specific to this fork should preserve upstream UI components where they remain relevant and adapt commands at the app-server boundary.
