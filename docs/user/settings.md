# Settings

Settings uses the T3 Code desktop layout, with a dedicated searchable sidebar and one full-width
page per section. T3 Codex only shows settings owned by this desktop client.

## General

- **Project grouping** groups cached app-server threads by their working directory.
- **Time format** controls sidebar timestamps.
- **Local thread cache** and **Automatic reconnection** describe always-on desktop behavior.
- **About** identifies the installed T3 Codex version and fork purpose.

## Appearance

Color scheme and interface, prompt, and code font sizes are local presentation preferences. They
are stored on this device and never sent to app-server.

## Connections

Connections selects a local app-server process or an OpenSSH host and configures its executable,
arguments, workspace, and environment. Saving replaces the current connection and reconnects. The
Remote section starts phone pairing through the connected app-server's official Remote service.

Upstream sections for Providers and provider updates are omitted because app-server owns provider,
account, and model configuration. Source Control, Archive, configurable Keybindings, and Beta are
omitted until the stripped client exposes corresponding behavior; showing inert controls would
misrepresent what the app can do.
