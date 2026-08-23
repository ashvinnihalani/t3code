# Connections

T3 Codex keeps one Local connection and any number of SSH connections active concurrently.

## Local

The desktop launches the configured executable directly. A typical configuration is executable `codex`, arguments `["app-server"]`, and a workspace containing the projects you want to control.

## SSH

Add an OpenSSH host in Settings → Connections. T3 Codex invokes the system `ssh` client. The executable in the connection is authoritative; T3 Codex never replaces it with a managed binary.

Persistent remote control is enabled for new SSH connections. It uses that same configured executable to run `app-server daemon bootstrap --remote-control`, then connects through its `app-server proxy`. The selected Codex build must support those commands and its own daemon installation requirements. Closing the desktop disconnects the proxy without stopping active remote threads, and reopening the desktop reconnects to the same daemon.

Turn off Persistent remote control to run the configured app-server command directly over SSH stdio. A custom harness must provide its own persistent transport if work needs to survive the desktop's SSH session. SSH configuration, keys, agents, jump hosts, and host aliases come from OpenSSH rather than a T3-specific tunnel.

Each profile has independent reconnect state, cache, workspace, and Pair action. Removing a profile closes its SSH proxy; it does not stop the remote daemon.

## Pair and Open In

Pair calls the selected app-server's Remote API and displays its pairing presentation. T3 Codex does not create a separate relay or pairing protocol.

Open In uses installed local editors for Local profiles. For SSH profiles it uses the editor's native remote-SSH arguments when supported.
