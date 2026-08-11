# T3 Codex repository scope

This inventory defines “needed” relative to the desktop-only Codex app-server architecture. A
directory is removed only when it is explicitly outside that boundary or after its last retained
consumer has moved to the app-server path.

| Directory                                                          | Classification                      | Cleanup decision                                                                            |
| ------------------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `.agents`, `.claude`, `.codex`, `.cursor`                          | Developer tooling                   | Retain; prune only references to removed surfaces.                                          |
| `.devcontainer`, `.github`, `.vite-hooks`, `.vscode`               | Repository tooling                  | Retain the base tooling; remove mobile, relay, marketing, and legacy release jobs.          |
| `.plans`                                                           | Historical design records           | Retain during migration; reassess after the desktop extraction.                             |
| `.repos`                                                           | Read-only implementation references | Retain. Repository instructions use these references for Effect patterns.                   |
| `apps/desktop`                                                     | Target product                      | Retain and migrate from backend supervision to an app-server MessagePort bridge.            |
| `apps/web`                                                         | Target renderer                     | Retain as the renderer embedded by desktop; remove remote and provider-management surfaces. |
| `apps/server`                                                      | Transitional legacy runtime         | Retain until desktop no longer starts it, then delete it as one dependency-backed change.   |
| `apps/mobile`                                                      | Outside target                      | Remove with its native modules, scripts, patches, workflows, and documentation.             |
| `apps/marketing`                                                   | Outside target                      | Remove with its build and release wiring.                                                   |
| `assets`                                                           | Target branding and packaging       | Retain; update branding separately.                                                         |
| `docs`                                                             | Mixed                               | Retain fork and contributor docs; remove instructions for deleted products and services.    |
| `experiments/messages-glass-lab`                                   | Explicitly preserved prototype      | Retain as requested; it remains outside the shipped workspace.                              |
| `infra/relay`                                                      | Outside target                      | Remove with T3 Connect configuration and deployment workflows.                              |
| `native/libghostty-vt`                                             | Target terminal dependency          | Retain while the web terminal consumes its WebAssembly build.                               |
| `native/resource-monitor`                                          | Transitional backend dependency     | Remove with legacy server supervision and packaging.                                        |
| `oxlint-plugin-t3code`                                             | Repository tooling                  | Retain while its rules are enabled by the root Vite+ configuration.                         |
| `packages/app-server-conformance`                                  | Target protocol boundary            | Retain and expand with client scenarios as the desktop migration proceeds.                  |
| `packages/effect-codex-app-server`                                 | Target protocol client              | Retain and refactor around transport-neutral wires.                                         |
| `packages/client-runtime`, `packages/contracts`, `packages/shared` | Mixed shared code                   | Retain temporarily; prune exports after mobile, relay, and server consumers disappear.      |
| `packages/effect-acp`                                              | Legacy provider integration         | Remove with the server provider adapters.                                                   |
| `packages/ssh`, `packages/tailscale`                               | Legacy remote environments          | Remove after their desktop and server entry points are deleted.                             |
| `patches`                                                          | Mixed dependency tooling            | Delete patches only when no retained package resolves the patched dependency.               |
| `scripts`                                                          | Mixed repository tooling            | Retain desktop/dev scripts; remove mobile, relay, marketing, and obsolete backend tasks.    |

## Removal order

1. Remove the isolated mobile application and mobile-only tooling.
2. Remove the isolated marketing application and relay infrastructure; preserve the glass lab.
3. Remove Remote, SSH, Tailscale, cloud-auth, and provider-management entry points from desktop and
   web.
4. Replace desktop backend supervision with the app-server transport and packaged renderer assets.
5. Delete the legacy server, ACP package, resource monitor, and newly orphaned shared contracts.
6. Prune manifests, lockfile entries, workflows, documentation, and release scripts after every
   dependency edge disappears.

Each step must preserve a focused verification path and land as a Conventional Commit.
