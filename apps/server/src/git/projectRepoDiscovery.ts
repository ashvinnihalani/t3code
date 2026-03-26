import { realpathSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

import type { ProjectGitRepo, ProjectRemoteTarget } from "@t3tools/contracts";

import { runProcess } from "../processRunner";
import { buildSshExecArgs, quotePosixShell } from "../sshCommand";

function makeRepoId(projectId: string, relativePath: string): string {
  const normalized = relativePath.trim().replaceAll("\\", "/");
  const suffix = normalized.length > 0 ? normalized : ".";
  return `${projectId}:${suffix}`;
}

function toDisplayName(relativePath: string): string {
  const normalized = relativePath.trim().replace(/\/+$/g, "");
  if (!normalized || normalized === ".") {
    return ".";
  }
  const parts = normalized.split("/");
  return parts.at(-1) ?? normalized;
}

function toProjectRepo(projectId: string, workspaceRoot: string, rootPath: string): ProjectGitRepo {
  const relativePath = path.relative(workspaceRoot, rootPath).replaceAll("\\", "/") || ".";
  return {
    id: makeRepoId(projectId, relativePath),
    rootPath,
    relativePath,
    displayName: toDisplayName(relativePath),
  };
}

async function discoverLocalGitRepos(
  projectId: string,
  workspaceRoot: string,
): Promise<ReadonlyArray<ProjectGitRepo>> {
  const discovered = new Set<string>();
  const queue = [workspaceRoot];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    let hasGitEntry = false;
    for (const entry of entries) {
      if (entry.name === ".git") {
        hasGitEntry = true;
        break;
      }
    }

    if (hasGitEntry) {
      try {
        discovered.add(realpathSync.native(current));
      } catch {
        discovered.add(current);
      }
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".turbo") {
        continue;
      }
      queue.push(path.join(current, entry.name));
    }
  }

  return Array.from(discovered)
    .toSorted((left, right) => {
      const leftRel = path.relative(workspaceRoot, left).replaceAll("\\", "/") || ".";
      const rightRel = path.relative(workspaceRoot, right).replaceAll("\\", "/") || ".";
      return leftRel.localeCompare(rightRel);
    })
    .map((rootPath) => toProjectRepo(projectId, workspaceRoot, rootPath));
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
    "resolved_root=$(pwd -P 2>/dev/null || pwd)",
    "find \"$resolved_root\" \\( -name .git -o -path '*/.git' \\) -print0 2>/dev/null | while IFS= read -r -d '' entry; do",
    "  repo_dir=${entry%/.git}",
    '  if [ -f "$entry" ]; then repo_dir=$(dirname "$entry"); fi',
    '  if [ -d "$repo_dir" ]; then',
    '    cd "$repo_dir" || continue',
    "    git_root=$(git rev-parse --show-toplevel 2>/dev/null || printf '')",
    '    case "$git_root" in',
    '      "$resolved_root"|"$resolved_root"/*) printf \'%s\\0\' "$git_root" ;;',
    "    esac",
    "  fi",
    "done",
  ].join("\n");
}

async function discoverRemoteGitRepos(
  projectId: string,
  workspaceRoot: string,
  remote: Extract<ProjectRemoteTarget, { kind: "ssh" }>,
): Promise<ReadonlyArray<ProjectGitRepo>> {
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
      timeoutMs: 20_000,
      allowNonZeroExit: true,
      outputMode: "truncate",
    },
  );

  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `Failed to discover git repos on ${remote.hostAlias}.`);
  }

  const discovered = Array.from(
    new Set(
      result.stdout
        .split("\0")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );

  return discovered
    .toSorted((left, right) => {
      const leftRel = path.posix.relative(workspaceRoot, left) || ".";
      const rightRel = path.posix.relative(workspaceRoot, right) || ".";
      return leftRel.localeCompare(rightRel);
    })
    .map((rootPath) => {
      const relativePath = path.posix.relative(workspaceRoot, rootPath) || ".";
      return {
        id: makeRepoId(projectId, relativePath),
        rootPath,
        relativePath,
        displayName: toDisplayName(relativePath),
      } satisfies ProjectGitRepo;
    });
}

export async function discoverProjectGitRepos(input: {
  projectId: string;
  workspaceRoot: string;
  remote?: ProjectRemoteTarget | null;
}): Promise<ReadonlyArray<ProjectGitRepo>> {
  if (input.remote?.kind === "ssh") {
    return discoverRemoteGitRepos(input.projectId, input.workspaceRoot, input.remote);
  }
  return discoverLocalGitRepos(input.projectId, input.workspaceRoot);
}
