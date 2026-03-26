# T3 Code (Fork)

This repository is a fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code).

The fork keeps the upstream T3 Code base, but the work in this branch is focused on SSH-backed remote project support, remote Codex session management, and the related UX needed to make remote development flows behave like local ones.

## What This Fork Adds

- Remote SSH project creation from the sidebar, including SSH host discovery from local SSH config files.
- Remote project validation before creation, including path checks, hostname resolution, Git availability, repository detection, and Codex CLI detection.
- Host-scoped Codex binary path and `CODEX_HOME` overrides so different SSH hosts can launch different Codex installations.
- Remote Codex session lifecycle support, including reconnect metadata, session health messaging, and recovery-oriented status banners.
- Remote Git, diff, terminal, workspace-entry, and open-in-editor flows routed through SSH-aware server logic.
- Project-aware path resolution so markdown links, terminal paths, diffs, plans, and Git file actions open relative to the active project instead of assuming a local raw cwd.
- Remote worktree support for SSH-backed projects, including remote worktree creation from draft thread env mode and PR thread preparation.
- Startup and state cleanup fixes, including pre-welcome thread hydration and stale local Codex error clearing after settings changes.
- Kiro CLI listed in the provider picker as a coming-soon provider.

## Remote SSH Scope In This Branch

The implementation in this fork currently targets Codex-first remote workflows:

- add remote projects by SSH host alias and remote workspace path
- launch Codex sessions against remote projects
- run remote Git and diff operations through the server
- open project-relative paths from chat content, plans, diffs, and terminal output
- surface reconnect and health information for remote sessions

This is still early-stage software. Expect rough edges and incomplete provider coverage.

## Provider Implementation Comparison

T3 Code uses a shared provider abstraction, but each provider runtime is implemented differently underneath it.

### Shared Architecture

All three providers plug into the same server-side provider stack:

- provider adapter contract in `apps/server/src/provider/Services/ProviderAdapter.ts`
- cross-provider routing and recovery in `apps/server/src/provider/Layers/ProviderService.ts`
- persisted thread-to-provider bindings in `apps/server/src/provider/Layers/ProviderSessionDirectory.ts`
- shared orchestration integration in `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- shared runtime event ingestion in `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`

That means the providers are not completely separate. Their runtime/protocol layers are provider-specific, but orchestration, persistence, settings, and UI model-selection flows are shared.

### Matrix

| Provider    | Control structure                                                                                       | Session / resume                                                                                          | Approvals | Structured user input | Rollback / checkpoint revert                                          | Remote support                                                        | Complexity | Main strengths                                                                                | Main weaknesses                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------- | --------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Codex       | `codex app-server` over JSON-RPC on stdio, wrapped by `codexAppServerManager.ts` plus `CodexAdapter.ts` | Strongest native thread model. Uses `thread/start`, `thread/resume`, and persists `resumeCursor.threadId` | Yes       | Yes                   | Yes, via `thread/rollback`                                            | Yes, including SSH plus host-scoped binary and `CODEX_HOME` overrides | Highest    | Richest protocol, best feature coverage, strongest recovery model                             | Most protocol glue, version/env handling, resume fallback cases, and child-conversation filtering |
| Claude Code | Direct `@anthropic-ai/claude-agent-sdk` query session inside `ClaudeAdapter.ts`                         | Good, but adapter-managed rather than external thread RPC. Uses SDK resume/session ids in `resumeCursor`  | Yes       | Yes                   | Yes, by trimming local adapter turn history and updating resume state | No dedicated remote transport layer in this repo                      | Medium     | Cleanest implementation, fewer moving parts, direct in-session model and permission switching | Recovery behavior depends more on adapter-owned state and SDK semantics                           |
| Kiro        | ACP over JSON-RPC on stdio, wrapped by `kiroAcpManager.ts` plus `KiroAdapter.ts`                        | Weaker than Codex. Uses `session/new` and `session/load` with `resumeCursor.sessionId`                    | Yes       | No                    | No. Checkpoint revert is explicitly unsupported for Kiro threads      | Yes, via provider options passed into the ACP manager                 | Lowest     | Smallest implementation, simplest ACP mapping, clean mode switching                           | Least feature-complete, weaker recovery, no structured user input, no rollback                    |

### Provider-Specific Files

- Codex: `apps/server/src/codexAppServerManager.ts`, `apps/server/src/provider/Layers/CodexAdapter.ts`, `apps/server/src/provider/codexCliVersion.ts`
- Claude Code: `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- Kiro: `apps/server/src/kiroAcpManager.ts`, `apps/server/src/provider/Layers/KiroAdapter.ts`

### Shared Files Touched By All Providers

- Contracts: `packages/contracts/src/provider.ts`, `packages/contracts/src/providerRuntime.ts`, `packages/contracts/src/orchestration.ts`, `packages/contracts/src/model.ts`
- Server orchestration: `apps/server/src/provider/Layers/ProviderService.ts`, `apps/server/src/provider/Layers/ProviderSessionDirectory.ts`, `apps/server/src/provider/Layers/ProviderAdapterRegistry.ts`
- Orchestration runtime flow: `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`, `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`, `apps/server/src/orchestration/Layers/StartupThreadReconciler.ts`, `apps/server/src/orchestration/Layers/CheckpointReactor.ts`
- Web settings and provider selection: `apps/web/src/appSettings.ts`, `apps/web/src/routes/_chat.settings.tsx`, `apps/web/src/components/chat/composerProviderRegistry.tsx`

### Kiro Alignment Summary

Kiro aligns with the same adapter-based architecture as Codex and Claude Code. It satisfies the same high-level provider contract and participates in the same orchestration and persistence layers.

Its gap is capability, not architecture. Compared with Codex and Claude Code, Kiro is currently weaker in three important ways:

- no structured user-input response support
- no conversation rollback support
- weaker recovery semantics, with more fallback-to-fresh-session behavior when persisted resume state is unavailable

The upside is that Kiro is also the simplest provider implementation in the repo. Its ACP integration is smaller, easier to reason about, and cleaner than the Codex app-server integration.

## Getting Started

> [!WARNING]
> You need [Codex CLI](https://github.com/openai/codex) installed and authorized on the machine running T3 Code. For remote projects, the target SSH host also needs a working `codex` install if you want to launch remote Codex sessions there.

```bash
npx t3
```

If you are looking for the official project and release artifacts, use the upstream repository:

- Upstream repo: [pingdotgg/t3code](https://github.com/pingdotgg/t3code)
- Upstream releases: [pingdotgg/t3code releases](https://github.com/pingdotgg/t3code/releases)

## Manual QA

Use [MANUAL_QA.md](./MANUAL_QA.md) for the detailed checklist covering the remote SSH functionality implemented in this fork.

## Notes

- This fork is based on a very early upstream project.
- The branch is intentionally opinionated toward remote SSH support and Codex-first flows.
- Not all providers shown in the UI are implemented yet.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
