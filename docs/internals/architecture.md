# Architecture

T3 Codex has one execution boundary:

```text
React renderer
  ├─ connection settings and presentation cache
  └─ Codex app-server client
             │
             │ Electron MessagePort (JSONL messages)
             ▼
Electron main process
  ├─ local child process, or
  └─ system OpenSSH child process
             │ stdin/stdout
             ▼
Codex-compatible app-server
```

## Ownership

T3 Codex owns the window, connection settings, SSH host discovery, reconnect scheduling, and local
presentation cache. The app-server owns initialization, account state, model and skill catalogs,
Remote, thread/turn/item identities, canonical history, and agent coordination. The agent harness
behind app-server owns tools, execution, context, and provider behavior.

There is no T3 HTTP/WebSocket server, Effect-RPC contract, provider adapter, event-sourced SQLite
store, checkpoint reactor, terminal runtime, relay, Tailscale service, WSL backend, or resource
monitor in the desktop build.

## Process lifecycle

Each connection creates a local process or an OpenSSH process and pipes its JSONL bytes through an
Electron MessagePort. Closing or replacing the renderer connection terminates only that captured
process. Reconnect creates a fresh process and app-server session; the renderer then reconstructs
its projection from app-server responses and notifications.

Remote persistence beyond the desktop process belongs to a persistent/shared app-server lifecycle,
not a desktop-owned T3 service.
