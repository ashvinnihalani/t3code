# Connections

## Local

Local mode starts the configured executable directly, without a shell, and exchanges newline-
delimited JSON through stdin/stdout. The default is `codex app-server`. Arguments and environment
values are stored in the desktop settings file; the app-server remains responsible for its own
authentication and agent runtime.

## SSH

SSH mode reuses the operating system's OpenSSH client, SSH config, agent, known hosts, and identity
files. T3 Codex discovers named hosts from `~/.ssh/config` (including configured `Include` files)
and unhashed entries from `known_hosts`. It launches one remote command whose stdin/stdout remain
the app-server JSONL transport.

Configure the remote executable and workspace for the remote machine. T3 Codex does not copy a
binary, forward a T3 server port, install credentials, or maintain a separate SSH tunnel service.
Authentication is non-interactive (`BatchMode=yes`), so keys and host verification must already
work from a normal terminal.

## Reconnect and local cache

When the process or SSH session disconnects, the renderer retains the last project/thread
projection and retries after 3, 4, 8, and then 16 seconds. A successful connection initializes a
new app-server session and replaces cached data with authoritative `thread/list` results.

The cache is presentation data only. It is not a conversation database and is never used to create
thread, turn, or item identities.

## Pair a phone with Remote

The Remote button calls the connected app-server's official experimental `remoteControl/*`
methods. Enabling Remote, status, pairing payloads, expiry, claim state, and paired clients all come
from app-server.

T3 Codex displays the returned manual code or pairing payload verbatim. It deliberately does not
derive a URL, generate a QR code, mint a token, call a T3 relay, or persist Remote credentials. If
the app-server does not support the pinned Remote methods, the dialog shows that protocol error and
Remote should be configured through the compatible app-server or Codex CLI instead.
