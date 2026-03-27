import path from "node:path";

import type { ProjectGitMode, ProjectGitRepo, ProjectRemoteTarget } from "@t3tools/contracts";

import { runProcess } from "../processRunner";
import { buildSshExecArgs, quotePosixShell } from "../sshCommand";

const CACHE_TTL_MS = 10_000;

export interface DiscoveredProjectRepos {
  readonly gitMode: ProjectGitMode;
  readonly gitRepos: ProjectGitRepo[] | null;
}

type CacheEntry = {
  readonly readAt: number;
  readonly value: DiscoveredProjectRepos;
};

const discoveryCache = new Map<string, CacheEntry>();

function cacheKey(workspaceRoot: string, remote?: ProjectRemoteTarget | null): string {
  return `${remote?.kind === "ssh" ? `ssh:${remote.hostAlias}` : "local"}\u0000${workspaceRoot}`;
}

async function isLocalRepoRoot(workspaceRoot: string): Promise<boolean> {
  try {
    const result = await runProcess("git", ["-C", workspaceRoot, "rev-parse", "--show-toplevel"], {
      cwd: workspaceRoot,
      timeoutMs: 5_000,
      outputMode: "truncate",
    });
    return result.stdout.trim() === workspaceRoot;
  } catch {
    return false;
  }
}

async function discoverLocalProjectRepos(workspaceRoot: string): Promise<DiscoveredProjectRepos> {
  if (await isLocalRepoRoot(workspaceRoot)) {
    return { gitMode: "single", gitRepos: null };
  }

  let children: string[] = [];
  try {
    children = await (await import("node:fs/promises")).readdir(workspaceRoot);
  } catch {
    return { gitMode: "none", gitRepos: null };
  }

  const repos: ProjectGitRepo[] = [];
  for (const child of children) {
    const absolutePath = path.join(workspaceRoot, child);
    try {
      const stat = await (await import("node:fs/promises")).stat(absolutePath);
      if (!stat.isDirectory()) continue;
      const result = await runProcess("git", ["-C", absolutePath, "rev-parse", "--show-toplevel"], {
        cwd: workspaceRoot,
        timeoutMs: 5_000,
        outputMode: "truncate",
      }).catch(() => null);
      if (!result) continue;
      if (result.stdout.trim() !== absolutePath) continue;
      repos.push({
        repoPath: child,
        displayName: child,
      });
    } catch {
      continue;
    }
  }

  return repos.length > 0
    ? { gitMode: "multi", gitRepos: repos }
    : { gitMode: "none", gitRepos: null };
}

function buildRemoteDiscoveryScript(workspaceRoot: string): string {
  const escapedWorkspaceRoot = quotePosixShell(workspaceRoot.trim());
  return [
    `input_path=${escapedWorkspaceRoot}`,
    'case "$input_path" in',
    '  "~") target_path=$HOME ;;',
    '  "~/"*) target_path=$HOME/${input_path#~/} ;;',
    "  *) target_path=$input_path ;;",
    "esac",
    'cd "$target_path" || exit 12',
    "resolved_path=$(pwd -P 2>/dev/null || pwd)",
    'root_repo=$(git -C "$resolved_path" rev-parse --show-toplevel 2>/dev/null || printf "")',
    'if [ "$root_repo" = "$resolved_path" ]; then',
    "  printf 'single\\0'",
    "  exit 0",
    "fi",
    "found=0",
    'for child_path in "$resolved_path"/*; do',
    '  [ -d "$child_path" ] || continue',
    "  child_name=${child_path##*/}",
    '  child_repo=$(git -C "$child_path" rev-parse --show-toplevel 2>/dev/null || printf "")',
    '  if [ "$child_repo" = "$child_path" ]; then',
    '    if [ "$found" = "0" ]; then printf "multi\\0"; found=1; fi',
    '    printf "%s\\0%s\\0" "$child_name" "$child_name"',
    "  fi",
    "done",
    'if [ "$found" = "0" ]; then printf "none\\0"; fi',
  ].join("\n");
}

async function discoverRemoteProjectRepos(
  workspaceRoot: string,
  remote: ProjectRemoteTarget,
): Promise<DiscoveredProjectRepos> {
  try {
    const result = await runProcess(
      "ssh",
      buildSshExecArgs({
        hostAlias: remote.hostAlias,
        command: "sh",
        args: ["-lc", buildRemoteDiscoveryScript(workspaceRoot)],
        localCwd: process.cwd(),
      }),
      {
        cwd: process.cwd(),
        timeoutMs: 10_000,
        outputMode: "truncate",
      },
    );

    const parts = result.stdout.split("\0").filter((part) => part.length > 0);
    const mode = parts[0];
    if (mode === "single") {
      return { gitMode: "single", gitRepos: null };
    }
    if (mode !== "multi") {
      return { gitMode: "none", gitRepos: null };
    }

    const repos: ProjectGitRepo[] = [];
    for (let index = 1; index + 1 < parts.length; index += 2) {
      repos.push({
        repoPath: parts[index]!,
        displayName: parts[index + 1]!,
      });
    }
    return repos.length > 0
      ? { gitMode: "multi", gitRepos: repos }
      : { gitMode: "none", gitRepos: null };
  } catch {
    return { gitMode: "none", gitRepos: null };
  }
}

export async function discoverProjectRepos(input: {
  readonly workspaceRoot: string;
  readonly remote?: ProjectRemoteTarget | null;
}): Promise<DiscoveredProjectRepos> {
  const key = cacheKey(input.workspaceRoot, input.remote ?? null);
  const cached = discoveryCache.get(key);
  if (cached && Date.now() - cached.readAt < CACHE_TTL_MS) {
    return cached.value;
  }

  const value =
    input.remote?.kind === "ssh"
      ? await discoverRemoteProjectRepos(input.workspaceRoot, input.remote)
      : await discoverLocalProjectRepos(input.workspaceRoot);
  discoveryCache.set(key, { readAt: Date.now(), value });
  return value;
}

export function clearProjectRepoDiscoveryCache(input: {
  readonly workspaceRoot: string;
  readonly remote?: ProjectRemoteTarget | null;
}): void {
  discoveryCache.delete(cacheKey(input.workspaceRoot, input.remote ?? null));
}
