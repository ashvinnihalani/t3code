# Architecture

The retained application has four runtime pieces:

1. The upstream-derived React renderer and UI components in `apps/web`.
2. The Electron shell in `apps/desktop`.
3. The typed app-server client in `packages/effect-codex-app-server`.
4. Shared UI contracts and state helpers in `packages/contracts`, `packages/client-runtime`, and `packages/shared`.

Electron serves the packaged renderer directly from `apps/web/dist`; it does not launch or proxy a T3 server. The preload bridge starts local or SSH app-server processes and transfers a MessagePort to the renderer. JSONL protocol traffic stays end-to-end between the app-server client and that process.

The renderer adapts app-server threads, projects, messages, models, approvals, and requests into the shapes consumed by upstream T3 Code components. Relevant upstream commands are intercepted at the atom-command boundary and translated to app-server RPC. Unsupported provider, Git, relay, server-hosting, update, and mobile surfaces are removed.

Connection profiles and cached thread/project summaries are stored locally by the desktop. Every connection has its own lifecycle and reconnect schedule.
