# Architecture

T3 Codex uses the same environment-catalog idea as upstream T3 Code, narrowed to stdio app-server
sessions:

```text
React renderer environment catalog
  ├─ Local ───── MessagePort ── local child process ── app-server
  ├─ Build box ─ MessagePort ── OpenSSH child process ─ app-server
  └─ Lab host ── MessagePort ── OpenSSH child process ─ app-server
```

## Ownership

T3 Codex owns the window, environment settings, SSH host discovery, reconnect scheduling, and local
presentation caches. The app-server owns initialization, account state, model and skill catalogs,
Remote, thread/turn/item identities, canonical history, and agent coordination. The agent harness
behind app-server owns tools, execution, context, and provider behavior.

There is no T3 HTTP/WebSocket server, Effect-RPC contract, provider adapter, event-sourced SQLite
store, checkpoint reactor, terminal runtime, relay, Tailscale service, WSL backend, or resource
monitor in the desktop build.

## Process lifecycle

The Local environment is always present. Every saved SSH environment is desired concurrently; it
does not replace Local or another SSH host. Each catalog entry creates its own process, MessagePort,
client, connection presentation, reconnect timer, model list, and cached thread projection.

Environment IDs scope IPC delivery, project keys, thread selection, approval requests, and Remote
pairing. Identical thread IDs returned by different app-servers therefore cannot collide. Closing
or reconnecting one entry terminates only its captured process. The renderer reconstructs that
entry's projection from its app-server without disrupting the others.

Remote persistence beyond the desktop process belongs to a persistent/shared app-server lifecycle,
not a desktop-owned T3 service.
