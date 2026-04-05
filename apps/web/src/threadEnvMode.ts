import type { ProjectExecutionTarget } from "@t3tools/contracts";
import type { DraftThreadEnvMode } from "./composerDraftStore";

interface ThreadEnvInput {
  projectHost: ProjectExecutionTarget | null | undefined;
}

export function supportsDraftWorktreeEnv(_input: ThreadEnvInput): boolean {
  return true;
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
    projectHost: input.projectHost,
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
    projectHost: input.projectHost,
    requestedEnvMode: input.draftThreadEnvMode,
    worktreePath: input.worktreePath,
  });
}
