# T3 Code (Fork)

This repository is a fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code).

The fork keeps the upstream T3 Code base, but the work in this branch is focused on SSH-backed remote project support, remote Codex session management, multi-provider integration, and the related UX needed to make remote development flows behave like local ones.

## Features

- **Remote SSH project lifecycle** — create, validate, and manage projects on remote hosts discovered from `~/.ssh/config` (including `Include` directives), with pre-creation checks for path existence, hostname resolution, Git availability, and Codex CLI detection.
- **Host-scoped provider overrides** — per-host Codex binary path and `CODEX_HOME` configuration so different SSH targets can use independent Codex installations.
- **Remote session management** — launch, reconnect, and monitor Codex sessions against remote projects, with persisted reconnect metadata, session health banners, and recovery-oriented lifecycle states (`fresh-start`, `adopt-existing`, `resume-thread`, `resume-unavailable`, `resume-failed`).
- **Remote Git, diff, terminal, and workspace flows** — all Git operations, checkpoint diffs, terminal interactions, and workspace-entry searches route through SSH-aware server logic scoped to the active project.
- **Project-aware path resolution** — markdown links, terminal paths, diffs, plans, and Git file actions resolve relative to the active project root instead of assuming a local cwd; remote projects route through `ssh://` URI targets for editor opens.
- **Remote worktree support** — create remote worktrees from draft thread env mode and PR thread preparation, with branch and worktree state tracked per-repo.
- **Multi-repo git discovery** — detect and track multiple Git repositories under a single project workspace, with per-repo branch and worktree arrays.
- **Multi-provider model selection** — unified `ModelSelection` discriminated union across Codex, Claude, and Kiro providers, with per-provider model options, capabilities, and reasoning effort levels.
- **Kiro provider integration** — ACP-based session lifecycle, streaming, permission handling, and context snapshot telemetry for the Kiro CLI provider.
- **Claude Code adapter** — Claude agent provider with thinking/effort controls, fast mode, and prompt stream interrupt handling.
- **Git action progress streaming** — real-time progress events for stacked git actions (commit, push, PR) pushed to the client over a dedicated WebSocket channel.
- **Context window telemetry** — structured `ThreadTokenUsageSnapshot` with per-turn and cumulative token breakdowns surfaced in the UI.
- **Startup and state cleanup** — pre-welcome thread hydration, stale local Codex error clearing after settings changes, and silent shutdown recovery.

## Data / Contract Changes

All shared schemas live in `packages/contracts`. The following summarizes the structural changes relative to upstream.

### New schemas

- **`remote.ts`** — `ProjectRemoteTarget` (SSH host alias), `SshHostSummary`, `SshHostListResult`, `RemoteProjectValidationInput`, and `RemoteProjectValidationResult` for SSH host discovery and pre-creation validation.
- **`project.ts`** — `ProjectEditorTarget`, `ProjectOpenInEditorInput`, and `ProjectOpenPathInEditorInput` for project-aware editor routing. `ProjectSearchEntriesInput` and `ProjectWriteFileInput` now key off `projectId` instead of a raw `cwd`.

### Model selection

- **`model.ts`** — replaced the flat `model` string + `ProviderModelOptions` bag with a discriminated `ModelSelection` union (`CodexModelSelection | ClaudeModelSelection | KiroModelSelection`). Each variant carries a `provider` literal, a `model` slug, and provider-specific `options`. Added `ClaudeModelOptions` (thinking, effort, fastMode), `KiroModelOptions`, and per-model `ModelCapabilities` (reasoning effort levels, fast mode, thinking toggle).

### Orchestration

- **`orchestration.ts`**:
  - `ProviderKind` expanded from `"codex"` to `"codex" | "claudeAgent" | "kiro"`.
  - `ProviderStartOptions` expanded with `ClaudeProviderStartOptions` and `KiroProviderStartOptions` alongside the existing `CodexProviderStartOptions`; Codex and Kiro options now carry an optional `remote: ProjectRemoteTarget`.
  - `OrchestrationProject` gained `remote`, `defaultModelSelection` (replacing `defaultModel`), `gitMode` (`"none" | "single" | "multi"`), and `gitRepos` (array of `ProjectGitRepo`).
  - `OrchestrationThread` replaced scalar `model`/`branch`/`worktreePath` with `modelSelection: ModelSelection`, `projectPath`, and arrays `branch: Array<NullOr<string>>` / `worktreePath: Array<NullOr<string>>` to support multi-repo state.
  - `OrchestrationSession` gained `providerThreadId`, `resumeAvailable`, `reconnectState`, `reconnectSummary`, and `reconnectUpdatedAt`. Added `"disconnected"` to `OrchestrationSessionStatus` and a new `OrchestrationSessionReconnectState` enum.
  - `OrchestrationProposedPlan` gained `implementedAt` and `implementationThreadId`. Turn start commands carry an optional `sourceProposedPlan` reference.
  - New `ThreadTurnCompleteCommand` / `ThreadTurnCompletedPayload` and `"thread.turn-completed"` event type.
  - `ThreadTurnDiffCompleteCommand` gained an optional `diff` field for inline diff text.
  - `ProviderSessionRuntimeStatus` gained `"ready"`.
  - All turn-start commands/payloads replaced `provider` + `model` + `modelOptions` with `modelSelection` and added `gitSettings`.

### Git

- **`git.ts`** — added `GitRequestSettings` (GitHub binary path, commit prompt, text generation model selection). Added `GitActionProgressPhase`, `GitActionProgressKind`, `GitActionProgressStream`, and `GitActionProgressEvent` for streaming stacked action progress. All git input schemas gained optional `projectId`, `repoPath`, and `settings` fields. `GitRunStackedActionInput` gained `actionId` and `modelSelection`.

### Provider runtime

- **`providerRuntime.ts`** — `RuntimeEventRawSource` changed from a closed literal union to an open `TrimmedNonEmptyString` to accommodate non-Codex providers. `ThreadStartedPayload` gained `message`. `ThreadTokenUsageUpdatedPayload.usage` replaced `Schema.Unknown` with a structured `ThreadTokenUsageSnapshot` (per-turn and cumulative token counts, reasoning tokens, tool uses, duration, compaction flag). `TaskProgressPayload` gained `summary`.

### IPC / WebSocket

- **`ipc.ts`** — added `server.listSshHosts()`, `server.validateRemoteProject()`, `projects.openInEditor()`, `projects.openPathInEditor()`, `git.onActionProgress()`, and `DesktopAppCloseBehavior`. `shell.openInEditor` now accepts a resolved target string instead of a raw `cwd`.
- **`ws.ts`** — added WS methods `projects.openInEditor`, `projects.openPathInEditor`, `server.listSshHosts`, `server.validateRemoteProject`. Added push channel `git.actionProgress` with `GitActionProgressEvent` payloads.
