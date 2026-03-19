import path from "node:path";
import fs from "node:fs/promises";

import type {
  GitListRepositoriesResult,
  GitProjectRepositorySummary,
  GitRunAggregateActionResult,
  ProjectId,
} from "@t3tools/contracts";
import { Effect, Layer } from "effect";

import { runProcess } from "../../processRunner";
import { buildSshExecArgs } from "../../sshCommand";
import { GitProjectError } from "../Errors.ts";
import { GitCore } from "../Services/GitCore.ts";
import { GitManager } from "../Services/GitManager.ts";
import { GitProjectService, type GitProjectServiceShape } from "../Services/GitProjectService.ts";
import { GitService } from "../Services/GitService.ts";

const DISCOVERY_CACHE_TTL_MS = 15_000;
const DISCOVERY_LOCAL_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "dist",
  "build",
  "coverage",
  "tmp",
  "temp",
  "vendor",
]);

interface DiscoveryCacheEntry {
  readonly readAt: number;
  readonly result: GitListRepositoriesResult;
}

function gitProjectError(operation: string, detail: string, cause?: unknown): GitProjectError {
  return new GitProjectError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function toGitRepositoryId(root: string, hostAlias?: string | null): string {
  return hostAlias ? `ssh:${hostAlias}:${root}` : `local:${root}`;
}

function toRelativePath(workspaceRoot: string, repoRoot: string): string {
  const relative = path.relative(workspaceRoot, repoRoot).replaceAll("\\", "/");
  return relative.length === 0 ? "." : relative;
}

function toRemoteRelativePath(workspaceRoot: string, repoRoot: string): string {
  const relative = path.posix.relative(workspaceRoot, repoRoot);
  return relative.length === 0 ? "." : relative;
}

function toDisplayName(relativePath: string, repoRoot: string): string {
  return relativePath === "." ? path.basename(repoRoot) || repoRoot : relativePath;
}

async function discoverLocalGitCandidates(workspaceRoot: string): Promise<string[]> {
  const candidates = new Set<string>();

  async function walk(currentDir: string): Promise<void> {
    const dirents = await fs.readdir(currentDir, { withFileTypes: true });
    await Promise.all(
      dirents.map(async (dirent) => {
        if (!dirent.name || dirent.name === "." || dirent.name === "..") {
          return;
        }

        const absolutePath = path.join(currentDir, dirent.name);
        if (dirent.name === ".git" && (dirent.isDirectory() || dirent.isFile())) {
          candidates.add(currentDir);
          return;
        }

        if (!dirent.isDirectory()) {
          return;
        }
        if (dirent.isSymbolicLink()) {
          return;
        }
        if (DISCOVERY_LOCAL_SKIP_DIRS.has(dirent.name)) {
          return;
        }

        await walk(absolutePath);
      }),
    );
  }

  await walk(workspaceRoot);
  return [...candidates];
}

function buildRemoteDiscoveryScript(workspaceRoot: string): string {
  const escapedWorkspaceRoot = JSON.stringify(workspaceRoot);
  const prunedPaths = [
    "*/.git/*",
    "*/node_modules/*",
    "*/.next/*",
    "*/.nuxt/*",
    "*/.turbo/*",
    "*/.cache/*",
    "*/dist/*",
    "*/build/*",
    "*/coverage/*",
    "*/tmp/*",
    "*/temp/*",
    "*/vendor/*",
  ];
  const pruneClause = prunedPaths.map((entry) => `-path ${JSON.stringify(entry)}`).join(" -o ");

  return `
set -eu
cd -- ${escapedWorkspaceRoot}
workspace_root=$(pwd -P)
printf 'WORKSPACE\t%s\0' "$workspace_root"
find . \\( ${pruneClause} \\) -prune -o \\( -type d -name .git -o -type f -name .git \\) -exec sh -c '
  for entry do
    repo_dir=$(dirname "$entry")
    root=$(git -C "$repo_dir" rev-parse --show-toplevel 2>/dev/null || true)
    [ -n "$root" ] || continue
    branch=$(git -C "$root" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
    if [ -z "$branch" ]; then
      branch=$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
      [ "$branch" = "HEAD" ] && branch=""
    fi
    if git -C "$root" status --porcelain --untracked-files=normal 2>/dev/null | grep . >/dev/null 2>&1; then dirty=1; else dirty=0; fi
    upstream=$(git -C "$root" rev-parse --abbrev-ref --symbolic-full-name "@{upstream}" 2>/dev/null || true)
    has_upstream=0
    ahead=0
    behind=0
    if [ -n "$upstream" ] && [ "$upstream" != "@{upstream}" ]; then
      has_upstream=1
      counts=$(git -C "$root" rev-list --left-right --count HEAD..."$upstream" 2>/dev/null || printf "0\t0")
      set -- $counts
      ahead=\${1:-0}
      behind=\${2:-0}
    fi
    if git -C "$root" remote get-url origin >/dev/null 2>&1; then has_origin=1; else has_origin=0; fi
    git_dir=$(git -C "$root" rev-parse --git-dir 2>/dev/null || true)
    git_common_dir=$(git -C "$root" rev-parse --git-common-dir 2>/dev/null || true)
    if [ -n "$git_dir" ] && [ -n "$git_common_dir" ] && [ "$git_dir" != "$git_common_dir" ]; then is_worktree=1; else is_worktree=0; fi
    default_branch=""
    if [ "$has_origin" -eq 1 ]; then
      default_ref=$(git -C "$root" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || true)
      case "$default_ref" in
        refs/remotes/origin/*) default_branch=\${default_ref#refs/remotes/origin/} ;;
      esac
    fi
    is_default=0
    if [ -n "$branch" ]; then
      if [ -n "$default_branch" ] && [ "$branch" = "$default_branch" ]; then
        is_default=1
      elif [ -z "$default_branch" ] && { [ "$branch" = "main" ] || [ "$branch" = "master" ]; }; then
        is_default=1
      fi
    fi
    printf "REPO\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\0" "$root" "$branch" "$dirty" "$ahead" "$behind" "$has_upstream" "$is_worktree" "$is_default" "$has_origin"
  done
' sh {} +
`;
}

function parseRemoteDiscoveryOutput(input: { stdout: string; hostAlias: string }): {
  workspaceRoot: string;
  repositories: GitProjectRepositorySummary[];
} {
  const records = input.stdout.split("\u0000").filter((entry) => entry.length > 0);
  let workspaceRoot = "";
  const repositoriesByRoot = new Map<string, GitProjectRepositorySummary>();

  for (const record of records) {
    const [kind, ...fields] = record.split("\t");
    if (kind === "WORKSPACE") {
      workspaceRoot = fields[0] ?? "";
      continue;
    }
    if (kind !== "REPO") {
      continue;
    }

    const [
      root = "",
      branchRaw = "",
      dirtyRaw = "0",
      aheadRaw = "0",
      behindRaw = "0",
      hasUpstreamRaw = "0",
      isWorktreeRaw = "0",
      isDefaultRaw = "0",
      hasOriginRaw = "0",
    ] = fields;
    if (!root || repositoriesByRoot.has(root)) {
      continue;
    }

    const relativePath = workspaceRoot ? toRemoteRelativePath(workspaceRoot, root) : ".";
    repositoriesByRoot.set(root, {
      repoId: toGitRepositoryId(root, input.hostAlias),
      root,
      relativePath,
      displayName: toDisplayName(relativePath, root),
      isProjectRoot: workspaceRoot.length > 0 && root === workspaceRoot,
      isWorktree: isWorktreeRaw === "1",
      branch: branchRaw.length > 0 ? branchRaw : null,
      hasWorkingTreeChanges: dirtyRaw === "1",
      aheadCount: Number.parseInt(aheadRaw, 10) || 0,
      behindCount: Number.parseInt(behindRaw, 10) || 0,
      hasUpstream: hasUpstreamRaw === "1",
      isDefaultBranch: isDefaultRaw === "1",
      hasOriginRemote: hasOriginRaw === "1",
    });
  }

  return {
    workspaceRoot,
    repositories: [...repositoriesByRoot.values()].toSorted((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    ),
  };
}

const makeGitProjectService = Effect.gen(function* () {
  const gitManager = yield* GitManager;
  const git = yield* GitCore;
  const gitService = yield* GitService;
  const discoveryCache = new Map<string, DiscoveryCacheEntry>();

  const readLocalRepoSummary = Effect.fnUntraced(function* (input: {
    readonly projectId: ProjectId;
    readonly workspaceRoot: string;
    readonly repoCandidate: string;
  }) {
    const repoRootResult = yield* gitService.execute({
      operation: "GitProjectService.readLocalRepoSummary.resolveRepoRoot",
      cwd: input.repoCandidate,
      args: ["rev-parse", "--show-toplevel"],
      allowNonZeroExit: true,
    });
    if (repoRootResult.code !== 0) {
      return null;
    }

    const rawRepoRoot = repoRootResult.stdout.trim();
    if (!rawRepoRoot) {
      return null;
    }

    const repoRoot = yield* Effect.tryPromise({
      try: () => fs.realpath(rawRepoRoot),
      catch: (cause) =>
        gitProjectError(
          "GitProjectService.readLocalRepoSummary.realpathRepoRoot",
          `Failed to resolve local repository root '${rawRepoRoot}'.`,
          cause,
        ),
    });

    const status = yield* git.status({ cwd: repoRoot });
    const branches = yield* git.listBranches({
      cwd: repoRoot,
      projectId: input.projectId,
    });
    const worktreeFlags = yield* gitService.execute({
      operation: "GitProjectService.readLocalRepoSummary.readWorktreeFlags",
      cwd: repoRoot,
      args: ["rev-parse", "--git-dir", "--git-common-dir"],
    });
    const [gitDir = "", gitCommonDir = ""] = worktreeFlags.stdout
      .split(/\r?\n/g)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    const relativePath = toRelativePath(input.workspaceRoot, repoRoot);
    const currentBranch = branches.branches.find((branch) => branch.current);

    return {
      repoId: toGitRepositoryId(repoRoot),
      root: repoRoot,
      relativePath,
      displayName: toDisplayName(relativePath, repoRoot),
      isProjectRoot: repoRoot === input.workspaceRoot,
      isWorktree: gitDir.length > 0 && gitCommonDir.length > 0 && gitDir !== gitCommonDir,
      branch: status.branch,
      hasWorkingTreeChanges: status.hasWorkingTreeChanges,
      aheadCount: status.aheadCount,
      behindCount: status.behindCount,
      hasUpstream: status.hasUpstream,
      isDefaultBranch:
        currentBranch?.isDefault ?? (status.branch === "main" || status.branch === "master"),
      hasOriginRemote: branches.hasOriginRemote,
    } satisfies GitProjectRepositorySummary;
  });

  const discoverLocalRepositories = Effect.fnUntraced(function* (input: {
    readonly projectId: ProjectId;
    readonly workspaceRoot: string;
  }) {
    const workspaceRoot = yield* Effect.tryPromise({
      try: () => fs.realpath(input.workspaceRoot),
      catch: (cause) =>
        gitProjectError(
          "GitProjectService.discoverLocalRepositories.realpathWorkspaceRoot",
          `Failed to resolve project workspace '${input.workspaceRoot}'.`,
          cause,
        ),
    });
    const repoCandidates = yield* Effect.tryPromise({
      try: () => discoverLocalGitCandidates(workspaceRoot),
      catch: (cause) =>
        gitProjectError(
          "GitProjectService.discoverLocalRepositories.scan",
          `Failed to scan local repositories under '${workspaceRoot}'.`,
          cause,
        ),
    });

    const repositoriesByRoot = new Map<string, GitProjectRepositorySummary>();
    for (const repoCandidate of repoCandidates) {
      const summary = yield* readLocalRepoSummary({
        projectId: input.projectId,
        workspaceRoot,
        repoCandidate,
      });
      if (!summary || repositoriesByRoot.has(summary.root)) {
        continue;
      }
      repositoriesByRoot.set(summary.root, summary);
    }

    return {
      repositories: [...repositoriesByRoot.values()].toSorted((left, right) =>
        left.relativePath.localeCompare(right.relativePath),
      ),
    } satisfies GitListRepositoriesResult;
  });

  const discoverRemoteRepositories = Effect.fnUntraced(function* (input: {
    readonly workspaceRoot: string;
    readonly hostAlias: string;
  }) {
    const script = buildRemoteDiscoveryScript(input.workspaceRoot);
    const result = yield* Effect.tryPromise({
      try: () =>
        runProcess(
          "ssh",
          buildSshExecArgs({
            hostAlias: input.hostAlias,
            command: "sh",
            args: ["-lc", script],
            cwd: input.workspaceRoot,
            localCwd: process.cwd(),
          }),
          {
            cwd: process.cwd(),
            timeoutMs: 60_000,
            maxBufferBytes: 16 * 1024 * 1024,
            outputMode: "truncate",
          },
        ),
      catch: (cause) =>
        gitProjectError(
          "GitProjectService.discoverRemoteRepositories.exec",
          `Failed to discover remote repositories on ${input.hostAlias}:${input.workspaceRoot}.`,
          cause,
        ),
    });
    if (result.code !== 0) {
      return yield* Effect.fail(
        gitProjectError(
          "GitProjectService.discoverRemoteRepositories.exec",
          result.stderr.trim().length > 0
            ? result.stderr.trim()
            : `Remote repository discovery failed on ${input.hostAlias}:${input.workspaceRoot}.`,
        ),
      );
    }
    return {
      repositories: parseRemoteDiscoveryOutput({
        stdout: result.stdout,
        hostAlias: input.hostAlias,
      }).repositories,
    } satisfies GitListRepositoriesResult;
  });

  const discoverRepositories = Effect.fnUntraced(function* (input: {
    readonly projectId: ProjectId;
    readonly workspaceRoot: string;
    readonly remote?: { readonly kind: "ssh"; readonly hostAlias: string } | null;
    readonly forceFresh?: boolean;
  }) {
    const cacheKey = `${input.projectId}\u0000${input.workspaceRoot}\u0000${input.remote?.hostAlias ?? ""}`;
    const cached = discoveryCache.get(cacheKey);
    if (!input.forceFresh && cached && Date.now() - cached.readAt < DISCOVERY_CACHE_TTL_MS) {
      return cached.result;
    }

    const result =
      input.remote?.kind === "ssh"
        ? yield* discoverRemoteRepositories({
            workspaceRoot: input.workspaceRoot,
            hostAlias: input.remote.hostAlias,
          })
        : yield* discoverLocalRepositories({
            projectId: input.projectId,
            workspaceRoot: input.workspaceRoot,
          });
    discoveryCache.set(cacheKey, {
      readAt: Date.now(),
      result,
    });
    return result;
  });

  const listRepositories: GitProjectServiceShape["listRepositories"] = (input) =>
    discoverRepositories(input);

  const runAggregateAction: GitProjectServiceShape["runAggregateAction"] = (input) =>
    Effect.gen(function* () {
      const discovery = yield* discoverRepositories({ ...input, forceFresh: true });
      const allowedRepoIds = input.repoIds ? new Set(input.repoIds) : null;
      const selectedRepositories = discovery.repositories.filter(
        (repository) => !allowedRepoIds || allowedRepoIds.has(repository.repoId),
      );

      const results: GitRunAggregateActionResult["results"] = [];
      for (const repository of selectedRepositories) {
        if (input.action === "commit") {
          if (!repository.hasWorkingTreeChanges) {
            results.push({
              repoId: repository.repoId,
              root: repository.root,
              relativePath: repository.relativePath,
              displayName: repository.displayName,
              status: "skipped",
              message: "Working tree is clean.",
            });
            continue;
          }

          const execution = yield* gitManager
            .runStackedAction({
              cwd: repository.root,
              projectId: input.projectId,
              action: "commit",
              ...(input.remote ? { remote: input.remote } : {}),
              ...(input.settings ? { settings: input.settings } : {}),
            })
            .pipe(
              Effect.either,
              Effect.map((outcome) => ({ outcome, repository })),
            );
          if (execution.outcome._tag === "Left") {
            results.push({
              repoId: repository.repoId,
              root: repository.root,
              relativePath: repository.relativePath,
              displayName: repository.displayName,
              status: "failed",
              message: execution.outcome.left.message,
            });
            continue;
          }

          results.push({
            repoId: repository.repoId,
            root: repository.root,
            relativePath: repository.relativePath,
            displayName: repository.displayName,
            status: execution.outcome.right.commit.status === "created" ? "eligible" : "skipped",
            message:
              execution.outcome.right.commit.status === "created"
                ? "Committed changes."
                : "No changes were committed.",
          });
          continue;
        }

        if (!repository.branch) {
          results.push({
            repoId: repository.repoId,
            root: repository.root,
            relativePath: repository.relativePath,
            displayName: repository.displayName,
            status: "blocked",
            message: "Detached HEAD: checkout a branch before pushing.",
          });
          continue;
        }
        if (repository.hasWorkingTreeChanges) {
          results.push({
            repoId: repository.repoId,
            root: repository.root,
            relativePath: repository.relativePath,
            displayName: repository.displayName,
            status: "blocked",
            message: "Commit or stash local changes before pushing.",
          });
          continue;
        }
        if (repository.behindCount > 0) {
          results.push({
            repoId: repository.repoId,
            root: repository.root,
            relativePath: repository.relativePath,
            displayName: repository.displayName,
            status: "blocked",
            message: "Branch is behind upstream.",
          });
          continue;
        }
        if (!repository.hasUpstream && !repository.hasOriginRemote) {
          results.push({
            repoId: repository.repoId,
            root: repository.root,
            relativePath: repository.relativePath,
            displayName: repository.displayName,
            status: "blocked",
            message: 'Add an "origin" remote before pushing.',
          });
          continue;
        }
        if (repository.aheadCount === 0) {
          results.push({
            repoId: repository.repoId,
            root: repository.root,
            relativePath: repository.relativePath,
            displayName: repository.displayName,
            status: "skipped",
            message: "No local commits to push.",
          });
          continue;
        }

        const pushOutcome = yield* git
          .pushCurrentBranch(repository.root, repository.branch, input.remote)
          .pipe(Effect.either);
        if (pushOutcome._tag === "Left") {
          results.push({
            repoId: repository.repoId,
            root: repository.root,
            relativePath: repository.relativePath,
            displayName: repository.displayName,
            status: "failed",
            message: pushOutcome.left.message,
          });
          continue;
        }

        results.push({
          repoId: repository.repoId,
          root: repository.root,
          relativePath: repository.relativePath,
          displayName: repository.displayName,
          status: repository.isDefaultBranch ? "warning" : "eligible",
          message: repository.isDefaultBranch
            ? `Pushed default branch ${repository.branch}.`
            : pushOutcome.right.status === "pushed"
              ? "Pushed branch."
              : "Branch was already up to date.",
        });
      }

      const cacheKey = `${input.projectId}\u0000${input.workspaceRoot}\u0000${input.remote?.kind === "ssh" ? input.remote.hostAlias : ""}`;
      discoveryCache.delete(cacheKey);

      return {
        action: input.action,
        results,
      } satisfies GitRunAggregateActionResult;
    });

  return {
    listRepositories,
    runAggregateAction,
  } satisfies GitProjectServiceShape;
});

export const GitProjectServiceLive = Layer.effect(GitProjectService, makeGitProjectService);
