import { Encoding } from "effect";
import { CheckpointRef, ProjectId, type ProjectGitRepo, type ThreadId } from "@t3tools/contracts";

export const CHECKPOINT_REFS_PREFIX = "refs/t3/checkpoints";

export function checkpointRefForThreadTurn(threadId: ThreadId, turnCount: number): CheckpointRef {
  return CheckpointRef.makeUnsafe(
    `${CHECKPOINT_REFS_PREFIX}/${Encoding.encodeBase64Url(threadId)}/turn/${turnCount}`,
  );
}

export function resolveThreadWorkspaceCwd(input: {
  readonly thread: {
    readonly projectId: ProjectId;
    readonly worktreePath: string | null;
    readonly multiRepoWorktree?: { readonly parentPath: string } | null | undefined;
  };
  readonly projects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly workspaceRoot: string;
  }>;
}): string | undefined {
  const worktreeCwd = input.thread.worktreePath ?? undefined;
  if (worktreeCwd) {
    return worktreeCwd;
  }

  const multiRepoWorktreeCwd = input.thread.multiRepoWorktree?.parentPath;
  if (multiRepoWorktreeCwd) {
    return multiRepoWorktreeCwd;
  }

  return input.projects.find((project) => project.id === input.thread.projectId)?.workspaceRoot;
}

export interface ThreadGitRepoTarget {
  readonly repoId: string;
  readonly relativePath: string;
  readonly displayName: string;
  readonly cwd: string;
}

function resolveRepoCwd(input: {
  readonly repo: ProjectGitRepo;
  readonly thread: {
    readonly worktreePath: string | null;
    readonly multiRepoWorktree?:
      | {
          readonly parentPath: string;
          readonly repos: ReadonlyArray<{
            readonly repoId: string;
            readonly worktreePath: string;
          }>;
        }
      | null
      | undefined;
  };
  readonly sessionCwd?: string | undefined;
}): string {
  const worktreeRepo =
    input.thread.multiRepoWorktree?.repos.find((entry) => entry.repoId === input.repo.id)
      ?.worktreePath ?? null;
  return worktreeRepo ?? input.thread.worktreePath ?? input.sessionCwd ?? input.repo.rootPath;
}

export function resolveThreadGitRepoTargets(input: {
  readonly thread: {
    readonly projectId: ProjectId;
    readonly worktreePath: string | null;
    readonly multiRepoWorktree?:
      | {
          readonly parentPath: string;
          readonly repos: ReadonlyArray<{
            readonly repoId: string;
            readonly worktreePath: string;
          }>;
        }
      | null
      | undefined;
  };
  readonly projects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly workspaceRoot: string;
    readonly gitRepos?: ReadonlyArray<ProjectGitRepo> | undefined;
  }>;
  readonly sessionCwd?: string | undefined;
}): ReadonlyArray<ThreadGitRepoTarget> {
  const project = input.projects.find((entry) => entry.id === input.thread.projectId);
  if (!project) {
    return [];
  }

  const gitRepos = project.gitRepos ?? [];
  if (gitRepos.length === 0) {
    const cwd =
      input.thread.worktreePath ??
      input.thread.multiRepoWorktree?.parentPath ??
      input.sessionCwd ??
      project.workspaceRoot;
    return [
      {
        repoId: `${input.thread.projectId}:.`,
        relativePath: ".",
        displayName: ".",
        cwd,
      },
    ];
  }

  return gitRepos.map((repo) => ({
    repoId: repo.id,
    relativePath: repo.relativePath,
    displayName: repo.displayName,
    cwd: resolveRepoCwd({
      repo,
      thread: input.thread,
      ...(input.sessionCwd !== undefined ? { sessionCwd: input.sessionCwd } : {}),
    }),
  }));
}

export function prefixRepoRelativePath(relativePath: string, filePath: string): string {
  const normalizedFilePath = filePath.replace(/^[/\\]+/, "").replaceAll("\\", "/");
  if (relativePath === "." || relativePath.length === 0) {
    return normalizedFilePath;
  }
  return `${relativePath.replace(/\/+$/g, "")}/${normalizedFilePath}`;
}
