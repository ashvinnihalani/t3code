# Connections

T3 Codex keeps one Local connection and any number of SSH connections active concurrently.

## Local

The desktop launches the configured executable directly. A typical configuration is executable `codex`, arguments `["app-server"]`, and a workspace containing the projects you want to control.

## SSH

Add an OpenSSH host in Settings → Connections. T3 Codex invokes the system `ssh` client. For the default `codex app-server` configuration, it bootstraps Codex's managed app-server daemon on the remote host and connects through `codex app-server proxy`. This requires Codex's standalone managed installation on that host. Closing the desktop disconnects that proxy without stopping active remote threads, and reopening the desktop reconnects to the same daemon.

Custom app-server-compatible harness commands continue to run directly over SSH stdio. A custom harness must provide its own persistent transport if work needs to survive the desktop's SSH session. SSH configuration, keys, agents, jump hosts, and host aliases come from OpenSSH rather than a T3-specific tunnel.

Each profile has independent reconnect state, cache, workspace, and Pair action. Removing a profile closes its SSH proxy; it does not stop the managed remote daemon.

## Pair and Open In

Pair calls the selected app-server's Remote API and displays its pairing presentation. T3 Codex does not create a separate relay or pairing protocol.

Open In uses installed local editors for Local profiles. For SSH profiles it uses the editor's native remote-SSH arguments when supported.
