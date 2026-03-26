import crypto from "node:crypto";
import path from "node:path";

import type { ProjectGitRepo, ProjectRepoWorktree, ProjectRemoteTarget } from "@t3tools/contracts";

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "repo";
}

function repoChildName(relativePath: string): string {
  if (relativePath === ".") {
    return "root";
  }
  return relativePath.split("/").map(sanitizeSegment).join("__");
}

export function buildSyntheticWorktreeParent(input: {
  worktreesDir: string;
  threadId?: string;
  branch: string;
  remote?: ProjectRemoteTarget | null;
  remoteHomeDir?: string | null;
}): string {
  const branchSegment = sanitizeSegment(input.branch);
  const threadSegment = sanitizeSegment(input.threadId ?? crypto.randomUUID().slice(0, 8));
  if (input.remote?.kind === "ssh") {
    return path.posix.join(
      input.remoteHomeDir ?? "/tmp",
      ".t3",
      "worktrees",
      "multi-repo",
      threadSegment,
      branchSegment,
    );
  }
  return path.join(input.worktreesDir, "multi-repo", threadSegment, branchSegment);
}

export function buildRepoWorktreeLayout(input: {
  parentPath: string;
  repos: ReadonlyArray<ProjectGitRepo>;
  remote?: ProjectRemoteTarget | null;
}): ReadonlyArray<ProjectRepoWorktree> {
  return input.repos.map((repo) => ({
    repoId: repo.id,
    repoRelativePath: repo.relativePath,
    sourceRootPath: repo.rootPath,
    worktreePath:
      input.remote?.kind === "ssh"
        ? path.posix.join(input.parentPath, repoChildName(repo.relativePath))
        : path.join(input.parentPath, repoChildName(repo.relativePath)),
  }));
}
