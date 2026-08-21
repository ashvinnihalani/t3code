import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentProject,
  EnvironmentThread,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  type EnvironmentThreadStatus,
  mergeEnvironmentThread,
} from "@t3tools/client-runtime/state/threads";
import type {
  OrchestrationMessage,
  OrchestrationProposedPlan,
  OrchestrationSession,
  OrchestrationThreadActivity,
  ScopedProjectRef,
  ScopedThreadRef,
  ServerConfig,
} from "@t3tools/contracts";
import { ThreadId, type EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentProjects } from "./projects";
import { environmentServerConfigsAtom } from "./server";
import { allEnvironmentShellsBootstrappedAtom } from "./shell";
import { environmentThreadDetails, environmentThreadShells } from "./threads";
import {
  readOptionalAppServerController,
  useOptionalAppServerController,
} from "../appServer/context";
import {
  environmentIdFor,
  projectIdForWorkspace,
  toEnvironmentProject,
  toEnvironmentThread,
  toEnvironmentThreadShell,
} from "../appServer/upstreamAdapter";

const EMPTY_PROJECT_REFS: ReadonlyArray<ScopedProjectRef> = Object.freeze([]);
const EMPTY_THREAD_REFS: ReadonlyArray<ScopedThreadRef> = Object.freeze([]);
const EMPTY_MESSAGES: ReadonlyArray<OrchestrationMessage> = Object.freeze([]);
const EMPTY_ACTIVITIES: ReadonlyArray<OrchestrationThreadActivity> = Object.freeze([]);
const EMPTY_PROPOSED_PLANS: ReadonlyArray<OrchestrationProposedPlan> = Object.freeze([]);

const EMPTY_PROJECT_ATOM = Atom.make<EnvironmentProject | null>(null).pipe(
  Atom.withLabel("web-project:empty"),
);
const EMPTY_PROJECT_REFS_ATOM = Atom.make(EMPTY_PROJECT_REFS).pipe(
  Atom.withLabel("web-project-refs:empty"),
);
const EMPTY_THREAD_REFS_ATOM = Atom.make(EMPTY_THREAD_REFS).pipe(
  Atom.withLabel("web-thread-refs:empty"),
);
const EMPTY_THREAD_SHELL_ATOM = Atom.make<EnvironmentThreadShell | null>(null).pipe(
  Atom.withLabel("web-thread-shell:empty"),
);
const EMPTY_THREAD_DETAIL_ATOM = Atom.make<EnvironmentThread | null>(null).pipe(
  Atom.withLabel("web-thread-detail:empty"),
);
const EMPTY_THREAD_STATUS_ATOM = Atom.make<EnvironmentThreadStatus>("empty").pipe(
  Atom.withLabel("web-thread-status:empty"),
);
const EMPTY_MESSAGES_ATOM = Atom.make(EMPTY_MESSAGES).pipe(
  Atom.withLabel("web-thread-messages:empty"),
);
const EMPTY_ACTIVITIES_ATOM = Atom.make(EMPTY_ACTIVITIES).pipe(
  Atom.withLabel("web-thread-activities:empty"),
);
const EMPTY_PROPOSED_PLANS_ATOM = Atom.make(EMPTY_PROPOSED_PLANS).pipe(
  Atom.withLabel("web-thread-proposed-plans:empty"),
);
const EMPTY_SESSION_ATOM = Atom.make<OrchestrationSession | null>(null).pipe(
  Atom.withLabel("web-thread-session:empty"),
);

export const activeEnvironmentIdAtom = Atom.make<EnvironmentId | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("web-active-environment-id"),
);

export function useActiveEnvironmentId(): EnvironmentId | null {
  const appServer = useOptionalAppServerController();
  const environmentId = useAtomValue(activeEnvironmentIdAtom);
  return appServer?.selectedEnvironmentId
    ? environmentIdFor(appServer.selectedEnvironmentId)
    : environmentId;
}

export function readActiveEnvironmentId(): EnvironmentId | null {
  const appServer = readOptionalAppServerController();
  if (appServer?.selectedEnvironmentId) return environmentIdFor(appServer.selectedEnvironmentId);
  return appAtomRegistry.get(activeEnvironmentIdAtom);
}

export function setActiveEnvironmentId(environmentId: EnvironmentId | null): void {
  appAtomRegistry.set(activeEnvironmentIdAtom, environmentId);
}

export function useProjectRefs(): ReadonlyArray<ScopedProjectRef> {
  const appServer = useOptionalAppServerController();
  const refs = useAtomValue(environmentProjects.projectRefsAtom);
  return useMemo(
    () =>
      appServer === null
        ? refs
        : appServer.projects.map((project) => ({
            environmentId: environmentIdFor(project.environmentId),
            projectId: projectIdForWorkspace(project.cwd),
          })),
    [appServer, refs],
  );
}

export function useThreadRefs(): ReadonlyArray<ScopedThreadRef> {
  const appServer = useOptionalAppServerController();
  const refs = useAtomValue(environmentThreadShells.threadRefsAtom);
  return useMemo(
    () =>
      appServer === null
        ? refs
        : appServer.projects.flatMap((project) =>
            project.threads.map((thread) => ({
              environmentId: environmentIdFor(project.environmentId),
              threadId: ThreadId.make(thread.id),
            })),
          ),
    [appServer, refs],
  );
}

export function useEnvironmentProjectRefs(
  environmentId: EnvironmentId | null,
): ReadonlyArray<ScopedProjectRef> {
  const appServer = useOptionalAppServerController();
  const refs = useAtomValue(
    environmentId === null
      ? EMPTY_PROJECT_REFS_ATOM
      : environmentProjects.environmentProjectRefsAtom(environmentId),
  );
  return useMemo(
    () =>
      appServer === null || environmentId === null
        ? refs
        : appServer.projects
            .filter((project) => project.environmentId === environmentId)
            .map((project) => ({
              environmentId,
              projectId: projectIdForWorkspace(project.cwd),
            })),
    [appServer, environmentId, refs],
  );
}

export function useEnvironmentThreadRefs(
  environmentId: EnvironmentId | null,
): ReadonlyArray<ScopedThreadRef> {
  const appServer = useOptionalAppServerController();
  const refs = useAtomValue(
    environmentId === null
      ? EMPTY_THREAD_REFS_ATOM
      : environmentThreadShells.environmentThreadRefsAtom(environmentId),
  );
  return useMemo(
    () =>
      appServer === null || environmentId === null
        ? refs
        : appServer.projects
            .filter((project) => project.environmentId === environmentId)
            .flatMap((project) =>
              project.threads.map((thread) => ({
                environmentId,
                threadId: ThreadId.make(thread.id),
              })),
            ),
    [appServer, environmentId, refs],
  );
}

export function useProjects(): ReadonlyArray<EnvironmentProject> {
  const appServer = useOptionalAppServerController();
  const projects = useAtomValue(environmentProjects.projectsAtom);
  return useMemo(
    () => (appServer === null ? projects : appServer.projects.map(toEnvironmentProject)),
    [appServer, projects],
  );
}

export function useServerConfigs(): ReadonlyMap<EnvironmentId, ServerConfig> {
  return useAtomValue(environmentServerConfigsAtom);
}

export function useThreadShells(): ReadonlyArray<EnvironmentThreadShell> {
  const appServer = useOptionalAppServerController();
  const threads = useAtomValue(environmentThreadShells.threadShellsAtom);
  return useMemo(
    () =>
      appServer === null
        ? threads
        : appServer.projects.flatMap((project) =>
            project.threads.map((thread) =>
              toEnvironmentThreadShell(appServer, project.environmentId, thread),
            ),
          ),
    [appServer, threads],
  );
}

export function useAllEnvironmentShellsBootstrapped(): boolean {
  const appServer = useOptionalAppServerController();
  const bootstrapped = useAtomValue(allEnvironmentShellsBootstrappedAtom);
  return appServer === null ? bootstrapped : appServer.settings !== null;
}

export function useThreadShellsForProjectRefs(
  refs: ReadonlyArray<ScopedProjectRef>,
): ReadonlyArray<EnvironmentThreadShell> {
  const appServer = useOptionalAppServerController();
  const threads = useAtomValue(environmentThreadShells.threadShellsForProjectRefsAtom(refs));
  return useMemo(() => {
    if (appServer === null) return threads;
    const keys = new Set(refs.map((ref) => `${ref.environmentId}:${ref.projectId}`));
    return appServer.projects.flatMap((project) => {
      const environmentId = environmentIdFor(project.environmentId);
      const projectId = projectIdForWorkspace(project.cwd);
      if (!keys.has(`${environmentId}:${projectId}`)) return [];
      return project.threads.map((thread) =>
        toEnvironmentThreadShell(appServer, project.environmentId, thread),
      );
    });
  }, [appServer, refs, threads]);
}

export function useProject(ref: ScopedProjectRef | null): EnvironmentProject | null {
  const appServer = useOptionalAppServerController();
  const project = useAtomValue(
    ref === null ? EMPTY_PROJECT_ATOM : environmentProjects.projectAtom(ref),
  );
  if (appServer === null || ref === null) return project;
  const direct = appServer.projects.find(
    (candidate) =>
      candidate.environmentId === ref.environmentId &&
      projectIdForWorkspace(candidate.cwd) === ref.projectId,
  );
  return direct ? toEnvironmentProject(direct) : null;
}

export function useThreadShell(ref: ScopedThreadRef | null): EnvironmentThreadShell | null {
  const appServer = useOptionalAppServerController();
  const thread = useAtomValue(
    ref === null ? EMPTY_THREAD_SHELL_ATOM : environmentThreadShells.threadShellAtom(ref),
  );
  if (appServer === null || ref === null) return thread;
  for (const project of appServer.projects) {
    if (project.environmentId !== ref.environmentId) continue;
    const direct = project.threads.find((candidate) => candidate.id === ref.threadId);
    if (direct) return toEnvironmentThreadShell(appServer, project.environmentId, direct);
  }
  return null;
}

export function useThreadDetail(ref: ScopedThreadRef | null): EnvironmentThread | null {
  const appServer = useOptionalAppServerController();
  const thread = useAtomValue(
    ref === null ? EMPTY_THREAD_DETAIL_ATOM : environmentThreadDetails.detailAtom(ref),
  );
  return appServer !== null && ref !== null
    ? appServer.thread?.id === ref.threadId && appServer.selectedEnvironmentId === ref.environmentId
      ? toEnvironmentThread(appServer, appServer.selectedEnvironmentId, appServer.thread)
      : null
    : thread;
}

export function useThreadStatus(ref: ScopedThreadRef | null): EnvironmentThreadStatus {
  const appServer = useOptionalAppServerController();
  const status = useAtomValue(
    ref === null ? EMPTY_THREAD_STATUS_ATOM : environmentThreadDetails.statusAtom(ref),
  );
  if (appServer === null || ref === null) return status;
  return appServer.thread?.id === ref.threadId ? "live" : "synchronizing";
}

export function resolveThreadDetailRef(
  ref: ScopedThreadRef | null,
  options: {
    shellExists: boolean;
    waitForShell: boolean;
  },
): ScopedThreadRef | null {
  return ref !== null && (!options.waitForShell || options.shellExists) ? ref : null;
}

/** Detail collections composed with shell-authoritative thread/workspace metadata. */
export function useThread(
  ref: ScopedThreadRef | null,
  options?: {
    /**
     * Client-reserved draft thread ids do not exist on the server until the
     * first send. Waiting for the shell index avoids polling the detail
     * endpoint for an intentionally missing thread during that window.
     */
    waitForShell?: boolean;
  },
): EnvironmentThread | null {
  const shell = useThreadShell(ref);
  const detail = useThreadDetail(
    resolveThreadDetailRef(ref, {
      shellExists: shell !== null,
      waitForShell: options?.waitForShell === true,
    }),
  );
  return useMemo(() => mergeEnvironmentThread(detail, shell), [detail, shell]);
}

export function useThreadMessages(
  ref: ScopedThreadRef | null,
): ReadonlyArray<OrchestrationMessage> {
  const appServer = useOptionalAppServerController();
  const messages = useAtomValue(
    ref === null ? EMPTY_MESSAGES_ATOM : environmentThreadDetails.messagesAtom(ref),
  );
  if (
    appServer === null ||
    ref === null ||
    appServer.thread?.id !== ref.threadId ||
    appServer.selectedEnvironmentId !== ref.environmentId
  ) {
    return messages;
  }
  return toEnvironmentThread(appServer, appServer.selectedEnvironmentId, appServer.thread).messages;
}

export function useThreadActivities(
  ref: ScopedThreadRef | null,
): ReadonlyArray<OrchestrationThreadActivity> {
  const appServer = useOptionalAppServerController();
  const activities = useAtomValue(
    ref === null ? EMPTY_ACTIVITIES_ATOM : environmentThreadDetails.activitiesAtom(ref),
  );
  if (
    appServer === null ||
    ref === null ||
    appServer.thread?.id !== ref.threadId ||
    appServer.selectedEnvironmentId !== ref.environmentId
  ) {
    return activities;
  }
  return toEnvironmentThread(appServer, appServer.selectedEnvironmentId, appServer.thread)
    .activities;
}

export function useThreadProposedPlans(
  ref: ScopedThreadRef | null,
): ReadonlyArray<OrchestrationProposedPlan> {
  const appServer = useOptionalAppServerController();
  const plans = useAtomValue(
    ref === null ? EMPTY_PROPOSED_PLANS_ATOM : environmentThreadDetails.proposedPlansAtom(ref),
  );
  return appServer === null ? plans : EMPTY_PROPOSED_PLANS;
}

export function useThreadSession(ref: ScopedThreadRef | null): OrchestrationSession | null {
  const appServer = useOptionalAppServerController();
  const session = useAtomValue(
    ref === null ? EMPTY_SESSION_ATOM : environmentThreadDetails.sessionAtom(ref),
  );
  if (
    appServer === null ||
    ref === null ||
    appServer.thread?.id !== ref.threadId ||
    appServer.selectedEnvironmentId !== ref.environmentId
  ) {
    return session;
  }
  return toEnvironmentThread(appServer, appServer.selectedEnvironmentId, appServer.thread).session;
}

export function readProject(ref: ScopedProjectRef): EnvironmentProject | null {
  const appServer = readOptionalAppServerController();
  if (appServer !== null) {
    const project = appServer.projects.find(
      (candidate) =>
        candidate.environmentId === ref.environmentId &&
        projectIdForWorkspace(candidate.cwd) === ref.projectId,
    );
    return project ? toEnvironmentProject(project) : null;
  }
  return appAtomRegistry.get(environmentProjects.projectAtom(ref));
}

export function readThreadShell(ref: ScopedThreadRef): EnvironmentThreadShell | null {
  const appServer = readOptionalAppServerController();
  if (appServer !== null) {
    for (const project of appServer.projects) {
      if (project.environmentId !== ref.environmentId) continue;
      const thread = project.threads.find((candidate) => candidate.id === ref.threadId);
      if (thread) return toEnvironmentThreadShell(appServer, project.environmentId, thread);
    }
    return null;
  }
  return appAtomRegistry.get(environmentThreadShells.threadShellAtom(ref));
}

/** Whether the environment's server understands thread.settle/unsettle.
    False for pre-settlement servers (capability defaults false on decode),
    so clients under version skew fall back instead of erroring. */
export function readEnvironmentSupportsSettlement(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .threadSettlement === true
  );
}

/** Whether the environment's server understands thread.snooze/unsnooze.
    Same version-skew contract as settlement. */
export function readEnvironmentSupportsSnooze(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .threadSnooze === true
  );
}

/** Whether the environment's server understands thread.pin/unpin.
    Same version-skew contract as settlement. */
export function readEnvironmentSupportsPinning(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .threadPinning === true
  );
}

/** Whether the environment's server understands thread title regeneration.
    Same version-skew contract as settlement. */
export function readEnvironmentSupportsTitleRegeneration(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .threadTitleRegeneration === true
  );
}

/** Whether the environment's server understands thread.pin.reorder (and
    orderKey on thread.pin). Same version-skew contract as settlement. */
export function readEnvironmentSupportsPinReorder(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .threadPinReorder === true
  );
}

export function readThreadDetail(ref: ScopedThreadRef): EnvironmentThread | null {
  const appServer = readOptionalAppServerController();
  if (
    appServer !== null &&
    appServer.thread?.id === ref.threadId &&
    appServer.selectedEnvironmentId === ref.environmentId
  ) {
    return toEnvironmentThread(appServer, appServer.selectedEnvironmentId, appServer.thread);
  }
  return appAtomRegistry.get(environmentThreadDetails.detailAtom(ref));
}

export function readEnvironmentThreadRefs(
  environmentId: EnvironmentId,
): ReadonlyArray<ScopedThreadRef> {
  const appServer = readOptionalAppServerController();
  if (appServer !== null) {
    return appServer.projects
      .filter((project) => project.environmentId === environmentId)
      .flatMap((project) =>
        project.threads.map((thread) => ({
          environmentId,
          threadId: ThreadId.make(thread.id),
        })),
      );
  }
  return appAtomRegistry.get(environmentThreadShells.environmentThreadRefsAtom(environmentId));
}

export function readThreadRefs(): ReadonlyArray<ScopedThreadRef> {
  const appServer = readOptionalAppServerController();
  if (appServer !== null) {
    return appServer.projects.flatMap((project) =>
      project.threads.map((thread) => ({
        environmentId: environmentIdFor(project.environmentId),
        threadId: ThreadId.make(thread.id),
      })),
    );
  }
  return appAtomRegistry.get(environmentThreadShells.threadRefsAtom);
}

export function readThreadShells(): ReadonlyArray<EnvironmentThreadShell> {
  const appServer = readOptionalAppServerController();
  if (appServer !== null) {
    return appServer.projects.flatMap((project) =>
      project.threads.map((thread) =>
        toEnvironmentThreadShell(appServer, project.environmentId, thread),
      ),
    );
  }
  return appAtomRegistry.get(environmentThreadShells.threadShellsAtom);
}

export function findThreadRef(threadId: ThreadId): ScopedThreadRef | null {
  const appServer = readOptionalAppServerController();
  if (appServer !== null) {
    for (const project of appServer.projects) {
      if (project.threads.some((thread) => thread.id === threadId)) {
        return { environmentId: environmentIdFor(project.environmentId), threadId };
      }
    }
    return null;
  }
  return (
    appAtomRegistry
      .get(environmentThreadShells.threadRefsAtom)
      .find((ref) => ref.threadId === threadId) ?? null
  );
}
