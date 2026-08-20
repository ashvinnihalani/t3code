# Getting started

## Prerequisites

- [mise](https://mise.jdx.dev/)
- A Codex app-server-compatible executable
- OpenSSH only when connecting to another machine

Install the repository-pinned Node.js and pnpm versions, install dependencies, and start the
desktop development process:

```bash
mise install
mise exec -- pnpm install
mise exec -- pnpm exec vp run dev
```

The development runner starts the renderer on `127.0.0.1:5733`, watches the Electron main and
preload bundles, and opens the desktop after both are ready. Set `PORT` when that port is occupied.

Build and start without the development server:

```bash
mise exec -- pnpm exec vp run build:desktop
mise exec -- pnpm exec vp run start:desktop
```

## Build and launch the macOS image

Build the unsigned Apple-silicon DMG with the repository-pinned tools:

```bash
mise exec -- pnpm exec vp run dist:mac
```

The image is written to `release/T3 Codex-0.0.32-arm64.dmg`. Open it and drag **T3 Codex** into
Applications:

```bash
open "release/T3 Codex-0.0.32-arm64.dmg"
```

Launch an installed copy from Finder or with:

```bash
open -a "T3 Codex"
```

Because the local image is unsigned, macOS may require choosing **Open** from the app's context
menu on first launch.

The development and release builds use the same desktop settings and app-server connection model.

## First environments

The default Local environment launches:

```text
codex app-server
```

with the repository root as its workspace. Open Settings to change its executable, argument list,
environment, or workspace, and to add SSH environments. Local and every saved SSH environment
connect concurrently. T3 Codex sends a separate app-server initialization handshake to each and
keeps their account, model, Remote, cached project, and thread state scoped independently.

Use the **+** beside Projects to add a working directory. Local environments open the native
directory picker. For an SSH environment, enter a directory on that remote machine. Selecting a
project opens a new-thread composer rooted at that directory; the project remains in the sidebar
even before its first thread is sent.

T3 Codex does not run an inherited T3 backend. The renderer is served directly by Electron and all
agent operations cross the app-server JSONL connection.
