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
- `apps/web/src/wsNativeApi.ts`
  Wired `server.listSshHosts()` through the browser transport.
- `apps/web/src/lib/serverReactQuery.ts`
  Added an SSH host list query helper.
- `apps/web/src/types.ts`
  Added remote metadata to the web project model.
- `apps/web/src/store.ts`
  Made persisted project identity remote-aware.
- `apps/web/src/components/Sidebar.tsx`
  Added `Local` / `Remote SSH` project creation UI and remote project badges.

## Next slice

- `packages/contracts/src/project.ts`
  Replace raw-path project APIs with `projectId`-routed operations so remote projects do not rely on browser-supplied filesystem paths.
- `packages/contracts/src/git.ts`
  Add project-aware git routing or a target-aware envelope for remote execution.
- `packages/contracts/src/terminal.ts`
  Add project-aware terminal open/restart inputs for remote targets.
- `apps/server/src/wsServer.ts`
  Route project, git, terminal, attachment, and favicon requests by project target instead of always assuming local disk.
- `apps/server/src/codexAppServerManager.ts`
  Add a remote transport abstraction so Codex sessions can run over SSH or a remote agent.
- `apps/server/src/provider/Layers/ProviderService.ts`
  Persist enough remote runtime metadata to recover remote sessions cleanly after reconnects.
- `apps/server/src/projectFaviconRoute.ts`
  Teach favicon lookup to resolve via project identity instead of raw `cwd`.
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
- `apps/web/src/components/ChatView.tsx`
  Make provider launch settings remote-aware and stop treating all paths as local-machine paths.
- `apps/web/src/lib/projectReactQuery.ts`
  Switch workspace entry search to `projectId`.
- `apps/web/src/lib/gitReactQuery.ts`
  Switch git queries and mutations to `projectId` or remote-aware inputs.
- `apps/desktop/src/main.ts`
  Add UX for installing/updating the remote agent and surfacing remote connection errors.
