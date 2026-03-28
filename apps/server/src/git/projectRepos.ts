import path from "node:path";
import fs from "node:fs/promises";

import type { ProjectGitMode, ProjectGitRepo, ProjectRemoteTarget } from "@t3tools/contracts";

import { runProcess } from "../processRunner";
import { buildSshExecArgs, quotePosixShell } from "../sshCommand";

const CACHE_TTL_MS = 10_000;
const MAX_DISCOVERY_DEPTH = 5;
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  "out",
  ".cache",
]);

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

  const repos: ProjectGitRepo[] = [];
  const pending = [{ absolutePath: workspaceRoot, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) continue;

    let children: string[] = [];
    try {
      children = await fs.readdir(current.absolutePath);
    } catch {
      continue;
    }

    for (const child of children) {
      if (IGNORED_DIRECTORY_NAMES.has(child)) continue;
      const absolutePath = path.join(current.absolutePath, child);
      try {
        const stat = await fs.stat(absolutePath);
        if (!stat.isDirectory()) continue;
        const result = await runProcess(
          "git",
          ["-C", absolutePath, "rev-parse", "--show-toplevel"],
          {
            cwd: workspaceRoot,
            timeoutMs: 5_000,
            outputMode: "truncate",
          },
        ).catch(() => null);
        if (result?.stdout.trim() === absolutePath) {
          const repoPath = path.relative(workspaceRoot, absolutePath).split(path.sep).join("/");
          repos.push({
            repoPath,
            displayName: path.basename(repoPath),
          });
          continue;
        }
        if (current.depth + 1 < MAX_DISCOVERY_DEPTH) {
          pending.push({ absolutePath, depth: current.depth + 1 });
        }
      } catch {
        continue;
      }
    }
  }

  const sortedRepos = repos.toSorted((left, right) => left.repoPath.localeCompare(right.repoPath));
  return sortedRepos.length > 0
    ? { gitMode: "multi", gitRepos: sortedRepos }
    : { gitMode: "none", gitRepos: null };
}

export function buildRemoteDiscoveryScript(workspaceRoot: string): string {
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
    "repo_lines=$(",
    '  find "$resolved_path" -mindepth 2 -maxdepth 6 -name .git -print | while IFS= read -r git_path; do',
    '    if printf "%s\\n" "$git_path" | grep -Eq "/(node_modules|\\.next|\\.turbo|dist|build|out|\\.cache)/"; then',
    "      continue",
    "    fi",
    '    repo_path=$(dirname "$git_path")',
    '    relative_path=${repo_path#"$resolved_path"/}',
    '    if [ "$relative_path" != "$repo_path" ] && [ -n "$relative_path" ]; then',
    '      printf "%s\\n" "$relative_path"',
    "    fi",
    "  done | LC_ALL=C sort -u",
    ")",
    'if [ -z "$repo_lines" ]; then',
    '  printf "none\\0"',
    "  exit 0",
    "fi",
    'printf "multi\\0"',
    'last_kept=""',
    'printf "%s\\n" "$repo_lines" | while IFS= read -r relative_path; do',
    '  [ -n "$relative_path" ] || continue',
    '  if [ -n "$last_kept" ]; then',
    '    case "$relative_path" in',
    '      "$last_kept"/*) continue ;;',
    "    esac",
    "  fi",
    "  display_name=${relative_path##*/}",
    '  printf "%s\\0%s\\0" "$relative_path" "$display_name"',
    "  last_kept=$relative_path",
    "done",
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
    const sortedRepos = repos.toSorted((left, right) =>
      left.repoPath.localeCompare(right.repoPath),
    );
    return sortedRepos.length > 0
      ? { gitMode: "multi", gitRepos: sortedRepos }
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
