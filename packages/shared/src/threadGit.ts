export interface ThreadGitStateLike {
  readonly projectPath: string;
  readonly branch: ReadonlyArray<string | null>;
  readonly worktreePath: ReadonlyArray<string | null>;
}

export function getSingleRepoBranch(state: ThreadGitStateLike): string | null {
  return state.branch[0] ?? null;
}

export function getSingleRepoWorktreePath(state: ThreadGitStateLike): string | null {
  return state.worktreePath[0] ?? null;
}

export function setBranchAtIndex(
  branch: ReadonlyArray<string | null>,
  index: number,
  value: string | null,
): Array<string | null> {
  const next = [...branch];
  while (next.length <= index) {
    next.push(null);
  }
  next[index] = value;
  return next;
}

export function setWorktreePathAtIndex(
  worktreePath: ReadonlyArray<string | null>,
  index: number,
  value: string | null,
): Array<string | null> {
  const next = [...worktreePath];
  while (next.length <= index) {
    next.push(null);
  }
  next[index] = value;
  return next;
}
