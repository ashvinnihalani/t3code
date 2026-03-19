# Manual QA Checklist

This checklist covers the remote SSH functionality and follow-up UX fixes implemented in this fork.

## Test Setup

- Prepare one local test project with Git initialized and Codex available locally.
- Prepare one healthy remote SSH target where the remote path exists, Git is installed, and `codex` is available on the remote host.
- Prepare one degraded remote SSH target, or a second remote path, that can simulate validation failures: path missing, path is not a directory, Git missing, or Codex missing.
- Ensure your local `~/.ssh/config` contains at least one concrete host alias that T3 Code should discover.
- If you want to test host-specific overrides, prepare two SSH host aliases with different remote Codex paths or `CODEX_HOME` locations.

## 1. SSH Host Discovery

- Open the add-project flow in the sidebar.
  Expected: there is a Local/Remote SSH mode switch.

- Switch to Remote SSH mode.
  Expected: the SSH host selector is populated from local SSH config aliases.

- Confirm wildcard-only host entries are not shown as selectable project targets.
  Expected: only concrete host aliases are available.

- If your SSH config uses `Include`, verify hosts from included files appear.
  Expected: included SSH config files are respected.

## 2. Remote Project Validation

- Add a remote project using a valid host alias and a valid remote workspace path.
  Expected: project creation succeeds, the project title matches the resolved directory name, and a validation toast summarizes remote hostname, Git, and Codex availability.

- Add a remote project with a missing remote directory.
  Expected: creation is blocked with a clean user-facing error, without stack traces or raw transport noise.

- Add a remote project with a remote path that points to a file instead of a directory.
  Expected: creation is blocked with a path-is-not-a-directory error.

- Add a remote project where Git is unavailable.
  Expected: project creation can still proceed if validation succeeds overall, but the success toast includes a warning about missing Git.

- Add a remote project where Codex is unavailable.
  Expected: project creation can still proceed if validation succeeds overall, but the success toast includes a warning about missing Codex.

- Try adding the same remote project twice with the same host alias and workspace root.
  Expected: the existing project is reused instead of creating a duplicate.

## 3. Remote Project Presentation

- Inspect the sidebar after adding a remote project.
  Expected: the project is visually marked as remote and the label does not include an `ssh:` prefix.

- Open Settings after at least one remote project exists.
  Expected: the Codex settings host selector shows `Local` plus each remote host alias without an `ssh:` prefix.

- Verify remote projects do not break favicon loading.
  Expected: remote projects fall back gracefully instead of showing broken image behavior.

## 4. Host-Scoped Codex Overrides

- In Settings, choose `Local` in the Codex host selector and set a local Codex binary path.
  Expected: the value is stored for Local only.

- Switch the selector to a remote host and set a different Codex binary path and `CODEX_HOME`.
  Expected: the remote host retains its own override values and does not overwrite Local.

- Switch between hosts multiple times.
  Expected: each scope restores the correct saved values.

- Reset Codex overrides for a remote host.
  Expected: that host returns to blank/default override values without changing Local settings.

- Start a remote session against a host with overrides.
  Expected: the remote session uses the host-scoped configuration instead of the Local one.

## 5. Remote Thread Creation And Session Startup

- Create a new thread in a remote project.
  Expected: the thread starts in the selected env mode, including `New worktree` when requested.

- Start a Codex turn in that remote thread.
  Expected: the session starts successfully and the chat does not show local-only assumptions or broken controls.

- While the remote session is starting, observe the provider health banner.
  Expected: the banner shows remote-specific startup language rather than a local provider-only message.

- Force a startup failure, such as an invalid remote Codex path.
  Expected: the provider health banner surfaces a remote-session error with a useful message.

## 6. Remote Reconnect Metadata And Health

- Start a remote thread, then reload the app while the session is recoverable.
  Expected: the thread reloads with reconnect metadata instead of losing all session context.

- Verify the banner or session state after reload.
  Expected: reconnect status reflects one of the tracked lifecycle states, such as fresh start, resumed thread, adopted existing session, or reconnect failure.

- If resume is unavailable, reload a remote thread that cannot resume.
  Expected: the UI reports that automatic reconnect is unavailable instead of silently failing.

- Inspect the thread state after a reconnect succeeds.
  Expected: remote session status returns to ready/running and reconnect info is visible but not misleading.

## 7. Remote Git Flows

- Open a remote project that is inside a Git repository.
  Expected: branch data loads for the remote project.

- Open the branch selector in a remote thread.
  Expected: branches are listed from the remote repository.

- Check Git status for a remote thread with staged or unstaged changes.
  Expected: file lists, insertions/deletions, and branch status reflect the remote repository state.

- Run a Git action from the remote UI, such as commit, commit+push, or PR preparation, if your environment supports it.
  Expected: the action executes against the remote repository and the UI reports the result cleanly.

- Open changed files from Git actions on a remote project.
  Expected: file opens route through the project-aware editor target flow rather than a local raw path.

## 8. Remote Diff And Checkpoint Flows

- Trigger a turn that produces checkpoint diffs in a remote project.
  Expected: checkpoint diff summaries render in the thread as they do for local projects.

- Open the diff panel for a remote thread.
  Expected: the panel loads, renders the diff, and supports opening files from the diff.

- Re-open a previously stored diff after refresh.
  Expected: persisted checkpoint diff text is available and the diff still renders correctly.

## 9. Remote Terminal And Workspace Entry Flows

- Open the terminal drawer for a remote thread.
  Expected: terminal state initializes without local-path-only assumptions.

- Produce terminal output that contains absolute or project-relative file paths.
  Expected: clicking a path routes through project-aware resolution.

- Use any file search or workspace entry features backed by the active project.
  Expected: the server resolves entries against the correct remote project context.

## 10. Project-Aware Open-In-Editor Resolution

- Click a markdown file link in assistant output for a local project.
  Expected: the correct local file opens relative to the project root.

- Click a markdown file link in assistant output for a remote project.
  Expected: the target resolves against the remote project root and uses the remote-aware open flow.

- Click file links from each of these surfaces: messages timeline, proposed plan card, expanded plan sidebar, diff panel, Git actions, and terminal output.
  Expected: every surface opens the same resolved file target for the active project.

- Attempt to use file-manager open actions on a remote project.
  Expected: unsupported remote file-manager actions are blocked cleanly instead of failing ambiguously.

## 11. Remote Worktree Mode

- Set default new-thread mode to `New worktree` in Settings.
  Expected: local projects still default to worktree mode, and remote projects can also inherit that default.

- Create a new thread in a remote project after that setting is enabled.
  Expected: the remote draft thread stays in `New worktree` mode until the first send prepares a remote worktree.

- Send the first message in that remote draft thread.
  Expected: the server creates a remote worktree, the thread stores the remote worktree path, and the turn starts from that remote worktree cwd.

- Prepare a PR thread in `New worktree` mode for a remote project.
  Expected: the PR head is materialized remotely and the thread points at the remote worktree path instead of the main remote checkout.

## 12. Startup Hydration

- Open the app to a state where a bootstrap thread should be restored from `server.welcome`.
  Expected: the thread list and store hydrate before navigation, with no empty-thread flash or missing bootstrap thread.

- Refresh directly into a project with existing threads.
  Expected: the app lands on the expected bootstrap thread without racing the welcome event.

## 13. Local Error Cleanup Regression

- Force a local Codex launcher error in a local project.
  Expected: the local provider health banner appears.

- Change the relevant local Codex settings to a working value and reload or restart the session.
  Expected: stale error state is cleared instead of remaining pinned after the configuration change.

- Dismiss a local Codex error banner, then trigger a settings change that should invalidate stale health state.
  Expected: dismissed or outdated local errors do not reappear incorrectly.

## 14. Kiro CLI Provider Entry

- Open the provider/model picker.
  Expected: Kiro CLI appears in the coming-soon list.

- Verify the option is not selectable for runtime use.
  Expected: it is labeled as coming soon and remains disabled.

## 15. Basic Local Regression Sweep

- Add a normal local project and create a local thread.
  Expected: existing local project creation still works.

- Start a local Codex turn.
  Expected: local sessions still behave normally after the remote changes.

- Open a local diff, local terminal path, and local markdown file link.
  Expected: local open-in-editor behavior still works and was not regressed by the project-aware path resolver.

- Switch between multiple projects and threads, including remote and local combinations.
  Expected: project identity, active thread selection, and sidebar state remain stable.
