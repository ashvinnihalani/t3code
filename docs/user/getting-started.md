# Getting started

## Prerequisites

- Node.js 24.13.1
- Vite+
- A Codex app-server-compatible executable
- OpenSSH only when connecting to another machine

Install dependencies and start the desktop development process:

```bash
vp i
vp run dev
```

The development runner starts the renderer on `127.0.0.1:5733`, watches the Electron main and
preload bundles, and opens the desktop after both are ready. Set `PORT` when that port is occupied.

Build and start without the development server:

```bash
vp run build:desktop
vp run start:desktop
```

## First connection

The default connection launches:

```text
codex app-server
```

with the repository root as its workspace. Open Settings to select another executable, argument
list, environment, or workspace. T3 Codex sends the app-server initialization handshake and then
loads account, model, skill, and thread data.

T3 Codex does not run an inherited T3 backend. The renderer is served directly by Electron and all
agent operations cross the app-server JSONL connection.
