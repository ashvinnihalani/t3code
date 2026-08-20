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

Connections presents the upstream-style environment list. Local is always present; each saved SSH
host is an additional simultaneous environment with its own status, executable, arguments,
workspace, environment variables, reconnect lifecycle, and local thread cache. Each connection's
**Pair** button starts pairing through the selected environment's official app-server Remote
service.

Upstream sections for Providers and provider updates are omitted because app-server owns provider,
account, and model configuration. Source Control, Archive, configurable Keybindings, and Beta are
omitted until the stripped client exposes corresponding behavior; showing inert controls would
misrepresent what the app can do.

## Composer controls

The model picker uses the catalog returned by each environment's `model/list` response. The
adjacent options menu exposes only the reasoning efforts and service tiers advertised by the
selected model, plus access presets translated into app-server approval and sandbox fields.
