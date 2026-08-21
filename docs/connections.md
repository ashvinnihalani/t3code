# Connections

T3 Codex keeps one Local connection and any number of SSH connections active concurrently.

## Local

The desktop launches the configured executable directly. A typical configuration is executable `codex`, arguments `["app-server"]`, and a workspace containing the projects you want to control.

## SSH

Add an OpenSSH host in Settings → Connections. T3 Codex invokes the system `ssh` client and starts the configured app-server on that host over stdio. SSH configuration, keys, agents, jump hosts, and host aliases come from OpenSSH rather than a T3-specific tunnel.

Each profile has independent reconnect state, cache, workspace, and Pair action. Removing a profile closes its process but does not modify files on the remote host.

## Pair and Open In

Pair calls the selected app-server's Remote API and displays its pairing presentation. T3 Codex does not create a separate relay or pairing protocol.

Open In uses installed local editors for Local profiles. For SSH profiles it uses the editor's native remote-SSH arguments when supported.
