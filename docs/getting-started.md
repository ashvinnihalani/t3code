# Getting started

Install and authenticate a compatible agent executable on the machine that will run it. The default local profile starts `codex app-server`.

Launch T3 Codex and open Settings → Connections. Enable Local, verify the executable and workspace, and select Retry if the connection is not already active. Add a project with the plus button in the sidebar, choose Local folder, and select a directory.

Thread and project summaries are cached by the desktop. The app-server remains authoritative for live thread content. When a process or SSH session disconnects, T3 Codex keeps cached navigation visible and reconnects with bounded backoff.

The model, reasoning effort, service tier, access mode, approvals, user-input requests, archive actions, and thread operations shown by the UI are derived from and sent to the selected app-server.
