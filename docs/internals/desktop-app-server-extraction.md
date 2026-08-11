# Desktop app-server extraction

> Implementation plan for the desktop-only fork based on T3 Code v0.0.32.

## Baselines

The fork freezes both sides of its initial compatibility boundary:

| Boundary                      | Pin                                                    |
| ----------------------------- | ------------------------------------------------------ |
| T3 renderer and desktop shell | `v0.0.32` (`be1a836745395286cbd392512179ab5816f538ba`) |
| Codex app-server protocol     | `678157acaa819d5510adfe359abb5d0392cfe461`             |

The generated schemas and method tables in `effect-codex-app-server` already use the protocol pin.
Changing that pin requires a schema diff, refreshed conformance goldens, and candidate conformance
against the replacement protocol. Remote protocol work is outside the first milestone.

## Target boundary

```text
T3 renderer
    |
Electron MessagePort transport bridge
    |
App-server-compatible harness
```

T3 owns desktop presentation and local presentation preferences. App-server owns the external
protocol and canonical thread, turn, item, and request identities. The selected harness owns the
agent runtime, providers, tools, skills, context, compaction, and execution sessions. T3 does not
integrate with a harness implementation directly and does not keep an authoritative conversation
store.

The first milestone supports managed stdio. The executable and arguments are runtime configuration,
so the same desktop path can launch Codex or any compatible harness without rebuilding the app.

## Migration rules

- Native app-server operations use the standard method directly.
- Harness operations still look native to T3; a compatible server implements them internally.
- Desktop actions without a native method invoke a discovered skill through `turn/start`.
- File pickers, window behavior, updates, local workspaces, and thread pin or snooze metadata remain
  desktop-local.
- Provider management, Remote, T3 Connect, environment authentication, SSH, WSL, Tailscale, relay,
  mobile, checkpoints, and the T3 server runtime are removed from the production desktop path.
- App-server snapshots establish truth. Notifications reduce latency, completed items replace
  streamed partial state, and reconnect reloads instead of replaying a T3 event log.

## Commit sequence

Every step is an independently tested Conventional Commit. Later steps may split further when a
change cannot remain reviewable as one commit.

### Reference conformance

1. `docs(fork): record desktop app-server extraction plan`
2. `test(conformance): add pinned reference manifest and JSON-RPC driver`
3. `test(conformance): normalize and validate app-server traces`
4. `test(conformance): record initialization and core lifecycle goldens`
5. `test(conformance): run the client suite against a configured harness`

The reference harness launches isolated servers and records raw JSON-RPC in both directions. It
validates messages against the generated protocol before comparison, normalizes identities while
preserving correlations, uses exact comparisons for deterministic methods, and partial-order checks
for streamed turns.

### App-server transport

6. `refactor(app-server): decouple the client from stdio`
7. `feat(app-server): add child-process and in-memory wire transports`
8. `feat(desktop): bridge app-server traffic over MessagePort`
9. `feat(desktop): expose account model and skill diagnostics`

The shared client retains its generated schemas, method maps, request correlation, server-request
handlers, unknown-message diagnostics, and child-process probe. Transport implementations cover
managed stdio, the Electron bridge, in-memory tests, and later Unix WebSocket connections.

### Read-only desktop projection

10. `feat(desktop): persist the local workspace catalog`
11. `feat(client): add app-server catalog and session facades`
12. `feat(client): project app-server threads into the desktop timeline`
13. `feat(client): reconcile thread state after reconnect`

Workspaces are local records keyed by canonical paths. App-server thread IDs are authoritative, and
threads group by canonical `cwd`. A temporary legacy adapter may populate existing UI projections,
but it does not synthesize checkpoints, provider sessions, or durable conversation identity.

### Mutating operations and skills

14. `feat(client): add canonical thread and turn operations`
15. `feat(client): handle approvals and user input requests`
16. `feat(desktop): add skill-backed action registry`

Thread create, fork, archive, unarchive, delete, rename, resume, steer, interrupt, and rollback use
standard methods. App-server requests are answered on their original JSON-RPC IDs; resolved requests
are benign races. Skill actions resolve names and absolute paths through `skills/list`, then send
text and structured skill inputs in normal turns.

### Desktop backend removal

17. `feat(desktop): serve packaged renderer assets directly`
18. `refactor(desktop): remove T3 backend supervision`
19. `refactor(web): remove environment and provider management surfaces`
20. `refactor(workspace): remove obsolete server and multi-surface packages`

Development continues through Vite. Production serves the web build from Electron with SPA fallback,
MIME handling, and CSP. The packaged app no longer scans for a backend port or starts `apps/server`.
Obsolete packages can remain only until their last desktop import is removed.

## First milestone exit criteria

The packaged desktop serves its renderer without `apps/server`, launches a configured
app-server-compatible harness, initializes, displays account/model/skill state, lists and opens
canonical threads, sends and streams turns, renders tools and file changes, handles interaction
requests, performs thread operations, invokes at least one skill action, and reconstructs visible
state after reconnect. The reference conformance suite covers initialization through turn lifecycle.
Changing the executable, arguments, or environment does not require rebuilding T3 or importing
harness-specific code.
