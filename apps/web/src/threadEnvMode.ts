import type { ProjectRemoteTarget } from "@t3tools/contracts";
import type { DraftThreadEnvMode } from "./composerDraftStore";

interface ThreadEnvInput {
  projectRemote: ProjectRemoteTarget | null | undefined;
}

export function supportsDraftWorktreeEnv(input: ThreadEnvInput): boolean {
  return input.projectRemote == null;
}

export function resolveRequestedThreadEnvMode(
  input: ThreadEnvInput & {
    requestedEnvMode?: DraftThreadEnvMode | undefined;
    defaultEnvMode?: DraftThreadEnvMode | undefined;
  },
): DraftThreadEnvMode {
  const requestedEnvMode = input.requestedEnvMode ?? input.defaultEnvMode ?? "local";
  if (requestedEnvMode === "worktree" && !supportsDraftWorktreeEnv(input)) {
    return "local";
  }
  return requestedEnvMode;
}

export function resolvePersistedThreadEnvMode(
  input: ThreadEnvInput & {
    requestedEnvMode?: DraftThreadEnvMode | undefined;
    fallbackEnvMode?: DraftThreadEnvMode | undefined;
    worktreePath: string | null | undefined;
  },
): DraftThreadEnvMode {
  if (input.worktreePath) {
    return "worktree";
  }

  return resolveRequestedThreadEnvMode({
    projectRemote: input.projectRemote,
    requestedEnvMode: input.requestedEnvMode,
    defaultEnvMode: input.fallbackEnvMode,
  });
}

export function resolveEffectiveThreadEnvMode(
  input: ThreadEnvInput & {
    worktreePath: string | null | undefined;
    draftThreadEnvMode?: DraftThreadEnvMode | undefined;
  },
): DraftThreadEnvMode {
  return resolvePersistedThreadEnvMode({
    projectRemote: input.projectRemote,
    requestedEnvMode: input.draftThreadEnvMode,
    worktreePath: input.worktreePath,
  });
}
