# Remote SSH Checklist

This tracks the VS Code-style remote SSH work as a file-by-file implementation map.

## Done in this slice

- `packages/contracts/src/remote.ts`
  Added shared schemas for SSH hosts and remote project targets.
- `packages/contracts/src/orchestration.ts`
  Added optional remote metadata to project create/read-model payloads.
- `packages/contracts/src/ipc.ts`
  Added `server.listSshHosts()` to the native API contract.
- `packages/contracts/src/ws.ts`
  Added `server.listSshHosts` WebSocket RPC.
- `apps/server/src/sshHosts.ts`
  Added SSH config discovery with `Include` support.
- `apps/server/src/wsServer.ts`
  Added the `server.listSshHosts` route.
- `apps/server/src/persistence/Migrations/014_ProjectionProjectsRemote.ts`
  Added persistence for project remote metadata.
- `apps/server/src/persistence/Services/ProjectionProjects.ts`
  Added projected project remote metadata.
- `apps/server/src/persistence/Layers/ProjectionProjects.ts`
  Wired `remote_json` into projection persistence.
- `apps/server/src/orchestration/decider.ts`
  Persisted remote metadata into project-created/meta-updated events.
- `apps/server/src/orchestration/projector.ts`
  Projected remote metadata into the in-memory read model.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
  Projected remote metadata into the SQL snapshot tables.
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
  Read remote metadata back out of projection storage.
- `apps/server/src/provider/Layers/ProviderService.ts`
  Persisted remote runtime reconnect metadata so remote sessions recover cleanly after reconnects.
- `packages/contracts/src/project.ts`
  Added project-aware editor target schemas and a dedicated `projects.openPathInEditor` input.
- `packages/contracts/src/editor.ts`
  Replaced raw editor-open `cwd` payloads with a target-based editor-open schema.
- `packages/contracts/src/ipc.ts`
  Added `projects.openPathInEditor()` and updated shell editor opens to accept resolved targets.
- `packages/contracts/src/ws.ts`
  Added the `projects.openPathInEditor` WebSocket RPC.
- `apps/web/src/components/ChatView.logic.ts`
  Resolve remote-aware provider health from session reconnect metadata instead of hiding the banner.
- `apps/web/src/components/chat/ProviderHealthBanner.tsx`
  Render remote session lifecycle and reconnect status alongside the existing local provider warnings.
- `apps/web/src/wsNativeApi.ts`
  Wired `server.listSshHosts()` through the browser transport.
- `apps/web/src/editorPreferences.ts`
  Added a project-aware editor target helper so project files stop routing through shell-only path opens.
- `apps/web/src/projectEditorTargets.ts`
  Centralized project-relative editor target resolution for markdown links, terminal links, diffs, and git file opens.
- `apps/web/src/lib/serverReactQuery.ts`
  Added an SSH host list query helper.
- `apps/web/src/types.ts`
  Added remote metadata to the web project model.
- `apps/web/src/store.ts`
  Made persisted project identity remote-aware and scoped attachment preview URLs to project/thread routes.
- `apps/web/src/components/Sidebar.tsx`
  Added `Local` / `Remote SSH` project creation UI and remote project badges, while keeping favicon resolution project-id based.
- `apps/web/src/components/ChatView.tsx`
  Passed project-aware link context into markdown, plan, terminal, and diff UX instead of local-path-only props.
- `apps/web/src/components/chat/ChatHeader.tsx`
  Kept remote projects eligible for editor opens and forwarded project-aware open state into header controls.
- `apps/web/src/components/chat/OpenInPicker.tsx`
  Routed project file opens through `projects.openPathInEditor` and disabled file-manager for remote SSH targets.
- `apps/web/src/components/ChatMarkdown.tsx`
  Resolved markdown workspace links to project-aware editor targets.
- `apps/web/src/components/chat/MessagesTimeline.tsx`
  Switched timeline markdown/proposed-plan rendering to the shared project-aware link context.
- `apps/web/src/components/PlanSidebar.tsx`
  Switched expanded plan markdown rendering to project-aware link resolution.
- `apps/web/src/components/chat/ProposedPlanCard.tsx`
  Switched collapsed/expanded plan markdown rendering to project-aware link resolution.
- `apps/web/src/components/ThreadTerminalDrawer.tsx`
  Routed terminal path links through project-aware resolution instead of assuming direct local filesystem opens.
- `apps/web/src/components/GitActionsControl.tsx`
  Routed changed-file opens through project-aware target resolution for both local and remote projects.
- `apps/web/src/components/DiffPanel.tsx`
  Routed diff file opens through project-aware target resolution for both local and remote projects.
- `apps/server/src/open.ts`
  Updated the open service to launch resolved targets, support `ssh://user@host/path` for command-based editors, and reject unsupported remote file-manager opens clearly.
- `apps/server/src/wsServer.ts`
  Centralized project-aware editor target resolution, scoped attachments by project/thread identity, and routed remote editor opens to SSH URIs.
- `apps/server/src/projectFaviconRoute.ts`
  Resolved favicon requests by project identity and returned the fallback icon for remote projects until remote file reads exist.

## Next slice

- `packages/contracts/src/git.ts`
  Add project-aware git routing or a target-aware envelope for remote execution.
- `packages/contracts/src/terminal.ts`
  Add project-aware terminal open/restart inputs for remote targets.
- `apps/server/src/codexAppServerManager.ts`
  Add a remote transport abstraction so Codex sessions can run over SSH or a remote agent.
- `apps/server/src/workspaceEntries.ts`
  Add a remote implementation backed by SSH or a remote agent.
- `apps/server/src/git/*`
  Add remote git execution against SSH-backed projects.
- `apps/server/src/terminal/*`
  Add remote terminal sessions backed by SSH or a headless remote agent.
- `apps/server/src/remote/*`
  Add remote bootstrap, install/update, health checks, and connection lifecycle management.
- `apps/web/src/components/Sidebar.tsx`
  Replace the “remote project added” placeholder state with real remote thread creation and connection status.
- `apps/web/src/lib/projectReactQuery.ts`
  Switch workspace entry search to `projectId`.
- `apps/web/src/lib/gitReactQuery.ts`
  Switch git queries and mutations to `projectId` or remote-aware inputs.
- `apps/desktop/src/main.ts`
  Add UX for installing/updating the remote agent and surfacing remote connection errors.
