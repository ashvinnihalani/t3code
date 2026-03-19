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
- Remote env-mode normalization so SSH-backed projects do not end up with stale local worktree state in draft threads.
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
