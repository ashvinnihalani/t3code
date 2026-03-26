import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";

import { Effect, Layer } from "effect";
import type { GitActionProgressEvent, GitActionProgressPhase } from "@t3tools/contracts";
import {
  resolveAutoFeatureBranchName,
  sanitizeBranchFragment,
  sanitizeFeatureBranchName,
} from "@t3tools/shared/git";

import { GitManagerError } from "../Errors.ts";
import {
  GitManager,
  type GitActionProgressReporter,
  type GitManagerShape,
  type GitRunStackedActionOptions,
} from "../Services/GitManager.ts";
import { GitCore, type GitCoreShape } from "../Services/GitCore.ts";
import { GitHubCli } from "../Services/GitHubCli.ts";
import { TextGeneration } from "../Services/TextGeneration.ts";

type GitRemoteTarget = Parameters<GitCoreShape["statusDetails"]>[1];
type GitOperationSettings =
  | {
      githubBinaryPath?: string | undefined;
      commitPrompt?: string | undefined;
      textGenerationModel?: string | undefined;
    }
  | undefined;

const COMMIT_TIMEOUT_MS = 10 * 60_000;
const MAX_PROGRESS_TEXT_LENGTH = 500;
type StripProgressContext<T> = T extends any ? Omit<T, "actionId" | "cwd" | "action"> : never;
type GitActionProgressPayload = StripProgressContext<GitActionProgressEvent>;

interface OpenPrInfo {
  number: number;
  title: string;
  url: string;
  baseRefName: string;
  headRefName: string;
}

interface PullRequestInfo extends OpenPrInfo {
  state: "open" | "closed" | "merged";
  updatedAt: string | null;
}

interface ResolvedPullRequest {
  number: number;
  title: string;
  url: string;
  baseBranch: string;
  headBranch: string;
  state: "open" | "closed" | "merged";
}

interface PullRequestHeadRemoteInfo {
  isCrossRepository?: boolean;
  headRepositoryNameWithOwner?: string | null;
  headRepositoryOwnerLogin?: string | null;
}

interface BranchHeadContext {
  localBranch: string;
  headBranch: string;
  headSelectors: ReadonlyArray<string>;
  preferredHeadSelector: string;
  remoteName: string | null;
  headRepositoryNameWithOwner: string | null;
  headRepositoryOwnerLogin: string | null;
  isCrossRepository: boolean;
}

function parseRepositoryNameFromPullRequestUrl(url: string): string | null {
  const trimmed = url.trim();
  const match = /^https:\/\/github\.com\/[^/]+\/([^/]+)\/pull\/\d+(?:\/.*)?$/i.exec(trimmed);
  const repositoryName = match?.[1]?.trim() ?? "";
  return repositoryName.length > 0 ? repositoryName : null;
}

function resolveHeadRepositoryNameWithOwner(
  pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
): string | null {
  const explicitRepository = pullRequest.headRepositoryNameWithOwner?.trim() ?? "";
  if (explicitRepository.length > 0) {
    return explicitRepository;
  }

  if (!pullRequest.isCrossRepository) {
    return null;
  }

  const ownerLogin = pullRequest.headRepositoryOwnerLogin?.trim() ?? "";
  const repositoryName = parseRepositoryNameFromPullRequestUrl(pullRequest.url);
  if (ownerLogin.length === 0 || !repositoryName) {
    return null;
  }

  return `${ownerLogin}/${repositoryName}`;
}

function resolvePullRequestWorktreeLocalBranchName(
  pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
): string {
  if (!pullRequest.isCrossRepository) {
    return pullRequest.headBranch;
  }

  const sanitizedHeadBranch = sanitizeBranchFragment(pullRequest.headBranch).trim();
  const suffix = sanitizedHeadBranch.length > 0 ? sanitizedHeadBranch : "head";
  return `t3code/pr-${pullRequest.number}/${suffix}`;
}

function parseGitHubRepositoryNameWithOwnerFromRemoteUrl(url: string | null): string | null {
  const trimmed = url?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }

  const match =
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/|git:\/\/github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i.exec(
      trimmed,
    );
  const repositoryNameWithOwner = match?.[1]?.trim() ?? "";
  return repositoryNameWithOwner.length > 0 ? repositoryNameWithOwner : null;
}

function parseRepositoryOwnerLogin(nameWithOwner: string | null): string | null {
  const trimmed = nameWithOwner?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }
  const [ownerLogin] = trimmed.split("/");
  const normalizedOwnerLogin = ownerLogin?.trim() ?? "";
  return normalizedOwnerLogin.length > 0 ? normalizedOwnerLogin : null;
}

function parsePullRequestList(raw: unknown): PullRequestInfo[] {
  if (!Array.isArray(raw)) return [];

  const parsed: PullRequestInfo[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const number = record.number;
    const title = record.title;
    const url = record.url;
    const baseRefName = record.baseRefName;
    const headRefName = record.headRefName;
    const state = record.state;
    const mergedAt = record.mergedAt;
    const updatedAt = record.updatedAt;
    if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) {
      continue;
    }
    if (
      typeof title !== "string" ||
      typeof url !== "string" ||
      typeof baseRefName !== "string" ||
      typeof headRefName !== "string"
    ) {
      continue;
    }

    let normalizedState: "open" | "closed" | "merged";
    if ((typeof mergedAt === "string" && mergedAt.trim().length > 0) || state === "MERGED") {
      normalizedState = "merged";
    } else if (state === "OPEN" || state === undefined || state === null) {
      normalizedState = "open";
    } else if (state === "CLOSED") {
      normalizedState = "closed";
    } else {
      continue;
    }

    parsed.push({
      number,
      title,
      url,
      baseRefName,
      headRefName,
      state: normalizedState,
      updatedAt: typeof updatedAt === "string" && updatedAt.trim().length > 0 ? updatedAt : null,
    });
  }
  return parsed;
}

function gitManagerError(operation: string, detail: string, cause?: unknown): GitManagerError {
  return new GitManagerError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function limitContext(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

function sanitizeCommitMessage(generated: {
  subject: string;
  body: string;
  branch?: string | undefined;
}): {
  subject: string;
  body: string;
  branch?: string | undefined;
} {
  const rawSubject = generated.subject.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const subject = rawSubject.replace(/[.]+$/g, "").trim();
  const safeSubject = subject.length > 0 ? subject.slice(0, 72).trimEnd() : "Update project files";
  return {
    subject: safeSubject,
    body: generated.body.trim(),
    ...(generated.branch !== undefined ? { branch: generated.branch } : {}),
  };
}

function sanitizeProgressText(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length <= MAX_PROGRESS_TEXT_LENGTH) {
    return trimmed;
  }
  return trimmed.slice(0, MAX_PROGRESS_TEXT_LENGTH).trimEnd();
}

interface CommitAndBranchSuggestion {
  subject: string;
  body: string;
  branch?: string | undefined;
  commitMessage: string;
}

function formatCommitMessage(subject: string, body: string): string {
  const trimmedBody = body.trim();
  if (trimmedBody.length === 0) {
    return subject;
  }
  return `${subject}\n\n${trimmedBody}`;
}

function parseCustomCommitMessage(raw: string): { subject: string; body: string } | null {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return null;
  }

  const [firstLine, ...rest] = normalized.split("\n");
  const subject = firstLine?.trim() ?? "";
  if (subject.length === 0) {
    return null;
  }

  return {
    subject,
    body: rest.join("\n").trim(),
  };
}

function extractBranchFromRef(ref: string): string {
  const normalized = ref.trim();

  if (normalized.startsWith("refs/remotes/")) {
    const withoutPrefix = normalized.slice("refs/remotes/".length);
    const firstSlash = withoutPrefix.indexOf("/");
    if (firstSlash === -1) {
      return withoutPrefix.trim();
    }
    return withoutPrefix.slice(firstSlash + 1).trim();
  }

  const firstSlash = normalized.indexOf("/");
  if (firstSlash === -1) {
    return normalized;
  }
  return normalized.slice(firstSlash + 1).trim();
}

function appendUnique(values: string[], next: string | null | undefined): void {
  const trimmed = next?.trim() ?? "";
  if (trimmed.length === 0 || values.includes(trimmed)) {
    return;
  }
  values.push(trimmed);
}

function toStatusPr(pr: PullRequestInfo): {
  number: number;
  title: string;
  url: string;
  baseBranch: string;
  headBranch: string;
  state: "open" | "closed" | "merged";
} {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    baseBranch: pr.baseRefName,
    headBranch: pr.headRefName,
    state: pr.state,
  };
}

function toGitHubCliInputOptions(settings: GitOperationSettings): {
  executablePath: string | null;
} {
  const executablePath = settings?.githubBinaryPath?.trim();
  return { executablePath: executablePath || null };
}

function toCommitGenerationOptions(settings: GitOperationSettings): {
  systemPrompt: string | null;
  model?: string;
} {
  return {
    ...toTextGenerationOptions(settings),
  };
}

function toTextGenerationOptions(settings: GitOperationSettings): {
  systemPrompt: string | null;
  model?: string;
} {
  const systemPrompt = settings?.commitPrompt?.trim();
  const model = settings?.textGenerationModel?.trim();
  return {
    systemPrompt: systemPrompt || null,
    ...(model ? { model } : {}),
  };
}

function normalizePullRequestReference(reference: string): string {
  const trimmed = reference.trim();
  const hashNumber = /^#(\d+)$/.exec(trimmed);
  return hashNumber?.[1] ?? trimmed;
}

function canonicalizeExistingPath(value: string): string {
  try {
    return realpathSync.native(value);
  } catch {
    return value;
  }
}

function toResolvedPullRequest(pr: {
  number: number;
  title: string;
  url: string;
  baseRefName: string;
  headRefName: string;
  state?: "open" | "closed" | "merged";
}): ResolvedPullRequest {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    baseBranch: pr.baseRefName,
    headBranch: pr.headRefName,
    state: pr.state ?? "open",
  };
}

function shouldPreferSshRemote(url: string | null): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  return trimmed.startsWith("git@") || trimmed.startsWith("ssh://");
}

function toPullRequestHeadRemoteInfo(pr: {
  isCrossRepository?: boolean;
  headRepositoryNameWithOwner?: string | null;
  headRepositoryOwnerLogin?: string | null;
}): PullRequestHeadRemoteInfo {
  return {
    ...(pr.isCrossRepository !== undefined ? { isCrossRepository: pr.isCrossRepository } : {}),
    ...(pr.headRepositoryNameWithOwner !== undefined
      ? { headRepositoryNameWithOwner: pr.headRepositoryNameWithOwner }
      : {}),
    ...(pr.headRepositoryOwnerLogin !== undefined
      ? { headRepositoryOwnerLogin: pr.headRepositoryOwnerLogin }
      : {}),
  };
}

function resolveLocalBranchName(input: {
  pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo;
  localBranch?: string;
}): string {
  return input.localBranch ?? input.pullRequest.headBranch;
}

export const makeGitManager = Effect.gen(function* () {
  const gitCore = yield* GitCore;
  const gitHubCli = yield* GitHubCli;
  const textGeneration = yield* TextGeneration;

  const createProgressEmitter = (
    input: { cwd: string; action: "commit" | "commit_push" | "commit_push_pr" },
    options?: GitRunStackedActionOptions,
  ) => {
    const actionId = options?.actionId ?? randomUUID();
    const reporter = options?.progressReporter;

    const emit = (event: GitActionProgressPayload) =>
      reporter
        ? reporter.publish({
            actionId,
            cwd: input.cwd,
            action: input.action,
            ...event,
          } as GitActionProgressEvent)
        : Effect.void;

    return {
      actionId,
      emit,
    };
  };

  const configurePullRequestHeadUpstream = (input: {
    cwd: string;
    pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo;
    localBranch?: string;
    remote?: GitRemoteTarget;
    settings?: GitOperationSettings;
  }) =>
    Effect.gen(function* () {
      const localBranch = resolveLocalBranchName(input);
      const repositoryNameWithOwner = resolveHeadRepositoryNameWithOwner(input.pullRequest) ?? "";
      if (repositoryNameWithOwner.length === 0) {
        return;
      }

      const cloneUrls = yield* gitHubCli.getRepositoryCloneUrls({
        cwd: input.cwd,
        repository: repositoryNameWithOwner,
        ...toGitHubCliInputOptions(input.settings),
        ...(input.remote ? { remote: input.remote } : {}),
      });
      const originRemoteUrl = yield* gitCore.readConfigValue(
        input.cwd,
        "remote.origin.url",
        input.remote,
      );
      const remoteUrl = shouldPreferSshRemote(originRemoteUrl) ? cloneUrls.sshUrl : cloneUrls.url;
      const preferredRemoteName =
        input.pullRequest.headRepositoryOwnerLogin?.trim() ||
        repositoryNameWithOwner.split("/")[0]?.trim() ||
        "fork";
      const remoteName = yield* gitCore.ensureRemote({
        cwd: input.cwd,
        preferredName: preferredRemoteName,
        url: remoteUrl,
        ...(input.remote ? { remote: input.remote } : {}),
      });

      yield* gitCore.setBranchUpstream({
        cwd: input.cwd,
        branch: localBranch,
        remoteName,
        remoteBranch: input.pullRequest.headBranch,
        ...(input.remote ? { remote: input.remote } : {}),
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning(
          `GitManager.configurePullRequestHeadUpstream: failed to configure upstream for ${resolveLocalBranchName(input)} -> ${input.pullRequest.headBranch} in ${input.cwd}: ${error.message}`,
        ).pipe(Effect.asVoid),
      ),
    );

  const materializePullRequestHeadBranch = (input: {
    cwd: string;
    pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo;
    localBranch?: string;
    remote?: GitRemoteTarget;
    settings?: GitOperationSettings;
  }) =>
    Effect.gen(function* () {
      const localBranch = resolveLocalBranchName(input);
      const repositoryNameWithOwner = resolveHeadRepositoryNameWithOwner(input.pullRequest) ?? "";

      if (repositoryNameWithOwner.length === 0) {
        yield* gitCore.fetchPullRequestBranch({
          cwd: input.cwd,
          prNumber: input.pullRequest.number,
          branch: localBranch,
          ...(input.remote ? { remote: input.remote } : {}),
        });
        return;
      }

      const cloneUrls = yield* gitHubCli.getRepositoryCloneUrls({
        cwd: input.cwd,
        repository: repositoryNameWithOwner,
        ...toGitHubCliInputOptions(input.settings),
        ...(input.remote ? { remote: input.remote } : {}),
      });
      const originRemoteUrl = yield* gitCore.readConfigValue(
        input.cwd,
        "remote.origin.url",
        input.remote,
      );
      const remoteUrl = shouldPreferSshRemote(originRemoteUrl) ? cloneUrls.sshUrl : cloneUrls.url;
      const preferredRemoteName =
        input.pullRequest.headRepositoryOwnerLogin?.trim() ||
        repositoryNameWithOwner.split("/")[0]?.trim() ||
        "fork";
      const remoteName = yield* gitCore.ensureRemote({
        cwd: input.cwd,
        preferredName: preferredRemoteName,
        url: remoteUrl,
        ...(input.remote ? { remote: input.remote } : {}),
      });

      yield* gitCore.fetchRemoteBranch({
        cwd: input.cwd,
        remoteName,
        remoteBranch: input.pullRequest.headBranch,
        localBranch,
        ...(input.remote ? { remote: input.remote } : {}),
      });
      yield* gitCore.setBranchUpstream({
        cwd: input.cwd,
        branch: localBranch,
        remoteName,
        remoteBranch: input.pullRequest.headBranch,
        ...(input.remote ? { remote: input.remote } : {}),
      });
    }).pipe(
      Effect.catch(() =>
        gitCore.fetchPullRequestBranch({
          cwd: input.cwd,
          prNumber: input.pullRequest.number,
          branch: resolveLocalBranchName(input),
          ...(input.remote ? { remote: input.remote } : {}),
        }),
      ),
    );

  const readConfigValueNullable = (cwd: string, key: string, remote?: GitRemoteTarget) =>
    gitCore.readConfigValue(cwd, key, remote).pipe(Effect.catch(() => Effect.succeed(null)));

  const resolveRemoteRepositoryContext = (
    cwd: string,
    remoteName: string | null,
    remote?: GitRemoteTarget,
  ) =>
    Effect.gen(function* () {
      if (!remoteName) {
        return {
          repositoryNameWithOwner: null,
          ownerLogin: null,
        };
      }

      const remoteUrl = yield* readConfigValueNullable(cwd, `remote.${remoteName}.url`, remote);
      const repositoryNameWithOwner = parseGitHubRepositoryNameWithOwnerFromRemoteUrl(remoteUrl);
      return {
        repositoryNameWithOwner,
        ownerLogin: parseRepositoryOwnerLogin(repositoryNameWithOwner),
      };
    });

  const resolveBranchHeadContext = (
    cwd: string,
    details: { branch: string; upstreamRef: string | null },
    remote?: GitRemoteTarget,
  ) =>
    Effect.gen(function* () {
      const remoteName = yield* readConfigValueNullable(
        cwd,
        `branch.${details.branch}.remote`,
        remote,
      );
      const headBranchFromUpstream = details.upstreamRef
        ? extractBranchFromRef(details.upstreamRef)
        : "";
      const headBranch =
        headBranchFromUpstream.length > 0 ? headBranchFromUpstream : details.branch;

      const [remoteRepository, originRepository] = yield* Effect.all(
        [
          resolveRemoteRepositoryContext(cwd, remoteName),
          resolveRemoteRepositoryContext(cwd, "origin", remote),
        ],
        { concurrency: "unbounded" },
      );

      const isCrossRepository =
        remoteRepository.repositoryNameWithOwner !== null &&
        originRepository.repositoryNameWithOwner !== null
          ? remoteRepository.repositoryNameWithOwner.toLowerCase() !==
            originRepository.repositoryNameWithOwner.toLowerCase()
          : remoteName !== null &&
            remoteName !== "origin" &&
            remoteRepository.repositoryNameWithOwner !== null;

      const ownerHeadSelector =
        remoteRepository.ownerLogin && headBranch.length > 0
          ? `${remoteRepository.ownerLogin}:${headBranch}`
          : null;
      const remoteAliasHeadSelector =
        remoteName && headBranch.length > 0 ? `${remoteName}:${headBranch}` : null;
      const shouldProbeRemoteOwnedSelectors =
        isCrossRepository || (remoteName !== null && remoteName !== "origin");

      const headSelectors: string[] = [];
      if (isCrossRepository && shouldProbeRemoteOwnedSelectors) {
        appendUnique(headSelectors, ownerHeadSelector);
        appendUnique(
          headSelectors,
          remoteAliasHeadSelector !== ownerHeadSelector ? remoteAliasHeadSelector : null,
        );
      }
      appendUnique(headSelectors, details.branch);
      appendUnique(headSelectors, headBranch !== details.branch ? headBranch : null);
      if (!isCrossRepository && shouldProbeRemoteOwnedSelectors) {
        appendUnique(headSelectors, ownerHeadSelector);
        appendUnique(
          headSelectors,
          remoteAliasHeadSelector !== ownerHeadSelector ? remoteAliasHeadSelector : null,
        );
      }

      return {
        localBranch: details.branch,
        headBranch,
        headSelectors,
        preferredHeadSelector:
          ownerHeadSelector && isCrossRepository ? ownerHeadSelector : headBranch,
        remoteName,
        headRepositoryNameWithOwner: remoteRepository.repositoryNameWithOwner,
        headRepositoryOwnerLogin: remoteRepository.ownerLogin,
        isCrossRepository,
      } satisfies BranchHeadContext;
    });

  const findOpenPr = (
    cwd: string,
    headSelectors: ReadonlyArray<string>,
    remote?: GitRemoteTarget,
    settings?: GitOperationSettings,
  ) =>
    Effect.gen(function* () {
      for (const headSelector of headSelectors) {
        const pullRequests = yield* gitHubCli.listOpenPullRequests({
          cwd,
          headSelector,
          limit: 1,
          ...toGitHubCliInputOptions(settings),
          ...(remote ? { remote } : {}),
        });

        const [firstPullRequest] = pullRequests;
        if (firstPullRequest) {
          return {
            number: firstPullRequest.number,
            title: firstPullRequest.title,
            url: firstPullRequest.url,
            baseRefName: firstPullRequest.baseRefName,
            headRefName: firstPullRequest.headRefName,
            state: "open",
            updatedAt: null,
          } satisfies PullRequestInfo;
        }
      }

      return null;
    });

  const findLatestPr = (
    cwd: string,
    details: { branch: string; upstreamRef: string | null },
    remote?: GitRemoteTarget,
    settings?: GitOperationSettings,
  ) =>
    Effect.gen(function* () {
      const headContext = yield* resolveBranchHeadContext(cwd, details, remote);
      const parsedByNumber = new Map<number, PullRequestInfo>();

      for (const headSelector of headContext.headSelectors) {
        const stdout = yield* gitHubCli
          .execute({
            cwd,
            args: [
              "pr",
              "list",
              "--head",
              headSelector,
              "--state",
              "all",
              "--limit",
              "20",
              "--json",
              "number,title,url,baseRefName,headRefName,state,mergedAt,updatedAt",
            ],
            ...toGitHubCliInputOptions(settings),
            ...(remote ? { remote } : {}),
          })
          .pipe(Effect.map((result) => result.stdout));

        const raw = stdout.trim();
        if (raw.length === 0) {
          continue;
        }

        const parsedJson = yield* Effect.try({
          try: () => JSON.parse(raw) as unknown,
          catch: (cause) =>
            gitManagerError("findLatestPr", "GitHub CLI returned invalid PR list JSON.", cause),
        });

        for (const pr of parsePullRequestList(parsedJson)) {
          parsedByNumber.set(pr.number, pr);
        }
      }

      const parsed = Array.from(parsedByNumber.values()).toSorted((a, b) => {
        const left = a.updatedAt ? Date.parse(a.updatedAt) : 0;
        const right = b.updatedAt ? Date.parse(b.updatedAt) : 0;
        return right - left;
      });

      const latestOpenPr = parsed.find((pr) => pr.state === "open");
      if (latestOpenPr) {
        return latestOpenPr;
      }
      return parsed[0] ?? null;
    });

  const resolveBaseBranch = (
    cwd: string,
    branch: string,
    upstreamRef: string | null,
    headContext: Pick<BranchHeadContext, "isCrossRepository">,
    remote?: GitRemoteTarget,
    settings?: GitOperationSettings,
  ) =>
    Effect.gen(function* () {
      const configured = yield* gitCore.readConfigValue(
        cwd,
        `branch.${branch}.gh-merge-base`,
        remote,
      );
      if (configured) return configured;

      if (upstreamRef && !headContext.isCrossRepository) {
        const upstreamBranch = extractBranchFromRef(upstreamRef);
        if (upstreamBranch.length > 0 && upstreamBranch !== branch) {
          return upstreamBranch;
        }
      }

      const defaultFromGh = yield* gitHubCli
        .getDefaultBranch({
          cwd,
          ...toGitHubCliInputOptions(settings),
          ...(remote ? { remote } : {}),
        })
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (defaultFromGh) {
        return defaultFromGh;
      }

      return "main";
    });

  const resolveCommitAndBranchSuggestion = (input: {
    cwd: string;
    branch: string | null;
    remote?: GitRemoteTarget;
    commitMessage?: string;
    /** When true, also produce a semantic feature branch name. */
    includeBranch?: boolean;
    filePaths?: readonly string[];
    settings?: GitOperationSettings;
  }) =>
    Effect.gen(function* () {
      const context = yield* gitCore.prepareCommitContext(input.cwd, input.filePaths, input.remote);
      if (!context) {
        return null;
      }

      const customCommit = parseCustomCommitMessage(input.commitMessage ?? "");
      if (customCommit) {
        return {
          subject: customCommit.subject,
          body: customCommit.body,
          ...(input.includeBranch
            ? { branch: sanitizeFeatureBranchName(customCommit.subject) }
            : {}),
          commitMessage: formatCommitMessage(customCommit.subject, customCommit.body),
        };
      }

      const generated = yield* textGeneration
        .generateCommitMessage({
          cwd: input.cwd,
          ...(input.remote ? { remote: input.remote } : {}),
          branch: input.branch,
          stagedSummary: limitContext(context.stagedSummary, 8_000),
          stagedPatch: limitContext(context.stagedPatch, 50_000),
          ...toCommitGenerationOptions(input.settings),
          ...(input.includeBranch ? { includeBranch: true } : {}),
        })
        .pipe(Effect.map((result) => sanitizeCommitMessage(result)));

      return {
        subject: generated.subject,
        body: generated.body,
        ...(generated.branch !== undefined ? { branch: generated.branch } : {}),
        commitMessage: formatCommitMessage(generated.subject, generated.body),
      };
    });

  const runCommitStep = (
    cwd: string,
    action: "commit" | "commit_push" | "commit_push_pr",
    branch: string | null,
    remote?: GitRemoteTarget,
    commitMessage?: string,
    preResolvedSuggestion?: CommitAndBranchSuggestion,
    filePaths?: readonly string[],
    settings?: GitOperationSettings,
    progressReporter?: GitActionProgressReporter,
    actionId?: string,
  ) =>
    Effect.gen(function* () {
      const emit = (event: GitActionProgressPayload) =>
        progressReporter && actionId
          ? progressReporter.publish({
              actionId,
              cwd,
              action,
              ...event,
            } as GitActionProgressEvent)
          : Effect.void;

      let suggestion: CommitAndBranchSuggestion | null | undefined = preResolvedSuggestion;
      if (!suggestion) {
        const needsGeneration = !commitMessage?.trim();
        if (needsGeneration) {
          yield* emit({
            kind: "phase_started",
            phase: "commit",
            label: "Generating commit message...",
          });
        }
        suggestion = yield* resolveCommitAndBranchSuggestion({
          cwd,
          branch,
          ...(remote ? { remote } : {}),
          ...(commitMessage ? { commitMessage } : {}),
          ...(filePaths ? { filePaths } : {}),
          ...(settings ? { settings } : {}),
        });
      }
      if (!suggestion) {
        return { status: "skipped_no_changes" as const };
      }

      yield* emit({
        kind: "phase_started",
        phase: "commit",
        label: "Committing...",
      });

      let currentHookName: string | null = null;
      const commitProgress =
        progressReporter && actionId
          ? {
              onOutputLine: ({ stream, text }: { stream: "stdout" | "stderr"; text: string }) => {
                const sanitized = sanitizeProgressText(text);
                if (!sanitized) {
                  return Effect.void;
                }
                return emit({
                  kind: "hook_output",
                  hookName: currentHookName,
                  stream,
                  text: sanitized,
                });
              },
              onHookStarted: (hookName: string) => {
                currentHookName = hookName;
                return emit({
                  kind: "hook_started",
                  hookName,
                });
              },
              onHookFinished: ({
                hookName,
                exitCode,
                durationMs,
              }: {
                hookName: string;
                exitCode: number | null;
                durationMs: number | null;
              }) => {
                if (currentHookName === hookName) {
                  currentHookName = null;
                }
                return emit({
                  kind: "hook_finished",
                  hookName,
                  exitCode,
                  durationMs,
                });
              },
            }
          : null;
      const { commitSha } = yield* gitCore.commit(cwd, suggestion.subject, suggestion.body, {
        ...(remote ? { remote } : {}),
        timeoutMs: COMMIT_TIMEOUT_MS,
        ...(commitProgress ? { progress: commitProgress } : {}),
      });
      if (currentHookName !== null) {
        yield* emit({
          kind: "hook_finished",
          hookName: currentHookName,
          exitCode: 0,
          durationMs: null,
        });
        currentHookName = null;
      }
      return {
        status: "created" as const,
        commitSha,
        subject: suggestion.subject,
      };
    });

  const runPrStep = (
    cwd: string,
    fallbackBranch: string | null,
    remote?: GitRemoteTarget,
    settings?: GitOperationSettings,
  ) =>
    Effect.gen(function* () {
      const details = yield* gitCore.statusDetails(cwd, remote);
      const branch = details.branch ?? fallbackBranch;
      if (!branch) {
        return yield* gitManagerError(
          "runPrStep",
          "Cannot create a pull request from detached HEAD.",
        );
      }
      if (!details.hasUpstream) {
        return yield* gitManagerError(
          "runPrStep",
          "Current branch has not been pushed. Push before creating a PR.",
        );
      }

      const headContext = yield* resolveBranchHeadContext(
        cwd,
        {
          branch,
          upstreamRef: details.upstreamRef,
        },
        remote,
      );

      const existing = yield* findOpenPr(cwd, headContext.headSelectors, remote, settings);
      if (existing) {
        return {
          status: "opened_existing" as const,
          url: existing.url,
          number: existing.number,
          baseBranch: existing.baseRefName,
          headBranch: existing.headRefName,
          title: existing.title,
        };
      }

      const baseBranch = yield* resolveBaseBranch(
        cwd,
        branch,
        details.upstreamRef,
        headContext,
        remote,
        settings,
      );
      const rangeContext = yield* gitCore.readRangeContext(cwd, baseBranch, remote);

      const generated = yield* textGeneration.generatePrContent({
        cwd,
        ...(remote ? { remote } : {}),
        baseBranch,
        headBranch: headContext.headBranch,
        commitSummary: limitContext(rangeContext.commitSummary, 20_000),
        diffSummary: limitContext(rangeContext.diffSummary, 20_000),
        diffPatch: limitContext(rangeContext.diffPatch, 60_000),
        ...toTextGenerationOptions(settings),
      });

      yield* gitHubCli
        .createPullRequest({
          cwd,
          baseBranch,
          headSelector: headContext.preferredHeadSelector,
          title: generated.title,
          body: generated.body,
          ...toGitHubCliInputOptions(settings),
          ...(remote ? { remote } : {}),
        })
        .pipe(
          Effect.mapError((cause) => gitManagerError("runPrStep", "Failed to create PR.", cause)),
        );

      const created = yield* findOpenPr(cwd, headContext.headSelectors, remote, settings);
      if (!created) {
        return {
          status: "created" as const,
          baseBranch,
          headBranch: headContext.headBranch,
          title: generated.title,
        };
      }

      return {
        status: "created" as const,
        url: created.url,
        number: created.number,
        baseBranch: created.baseRefName,
        headBranch: created.headRefName,
        title: created.title,
      };
    });

  const status: GitManagerShape["status"] = Effect.fnUntraced(function* (input) {
    const details = yield* gitCore.statusDetails(input.cwd, input.remote);

    const pr =
      details.branch !== null
        ? yield* findLatestPr(
            input.cwd,
            {
              branch: details.branch,
              upstreamRef: details.upstreamRef,
            },
            input.remote,
            input.settings,
          ).pipe(
            Effect.map((latest) => (latest ? toStatusPr(latest) : null)),
            Effect.catch(() => Effect.succeed(null)),
          )
        : null;

    return {
      branch: details.branch,
      hasWorkingTreeChanges: details.hasWorkingTreeChanges,
      workingTree: details.workingTree,
      hasUpstream: details.hasUpstream,
      aheadCount: details.aheadCount,
      behindCount: details.behindCount,
      pr,
    };
  });

  const resolvePullRequest: GitManagerShape["resolvePullRequest"] = Effect.fnUntraced(
    function* (input) {
      const pullRequest = yield* gitHubCli
        .getPullRequest({
          cwd: input.cwd,
          reference: normalizePullRequestReference(input.reference),
          ...toGitHubCliInputOptions(input.settings),
          ...(input.remote ? { remote: input.remote } : {}),
        })
        .pipe(Effect.map((resolved) => toResolvedPullRequest(resolved)));

      return { pullRequest };
    },
  );

  const preparePullRequestThread: GitManagerShape["preparePullRequestThread"] = Effect.fnUntraced(
    function* (input) {
      const normalizedReference = normalizePullRequestReference(input.reference);
      const pullRequestSummary = yield* gitHubCli.getPullRequest({
        cwd: input.cwd,
        reference: normalizedReference,
        ...toGitHubCliInputOptions(input.settings),
        ...(input.remote ? { remote: input.remote } : {}),
      });
      const pullRequest = toResolvedPullRequest(pullRequestSummary);
      const pullRequestWithRemoteInfo = {
        ...pullRequest,
        ...toPullRequestHeadRemoteInfo(pullRequestSummary),
      } as const;

      if (input.mode === "local") {
        yield* gitHubCli.checkoutPullRequest({
          cwd: input.cwd,
          reference: normalizedReference,
          force: true,
          ...toGitHubCliInputOptions(input.settings),
          ...(input.remote ? { remote: input.remote } : {}),
        });
        const details = yield* gitCore.statusDetails(input.cwd, input.remote);
        yield* configurePullRequestHeadUpstream({
          cwd: input.cwd,
          pullRequest: pullRequestWithRemoteInfo,
          localBranch: details.branch ?? pullRequest.headBranch,
          ...(input.settings ? { settings: input.settings } : {}),
          ...(input.remote ? { remote: input.remote } : {}),
        });
        return {
          pullRequest,
          branch: details.branch ?? pullRequest.headBranch,
          worktreePath: null,
        };
      }

      const rootWorktreePath = canonicalizeExistingPath(input.cwd);
      const ensureExistingWorktreeUpstream = (worktreePath: string) =>
        Effect.gen(function* () {
          const details = yield* gitCore.statusDetails(worktreePath, input.remote);
          yield* configurePullRequestHeadUpstream({
            cwd: worktreePath,
            pullRequest: pullRequestWithRemoteInfo,
            localBranch: details.branch ?? pullRequest.headBranch,
            ...(input.settings ? { settings: input.settings } : {}),
            ...(input.remote ? { remote: input.remote } : {}),
          });
        });

      const localPullRequestBranch =
        resolvePullRequestWorktreeLocalBranchName(pullRequestWithRemoteInfo);

      const findLocalHeadBranch = (cwd: string) =>
        gitCore
          .listBranches({
            cwd,
            ...(input.remote ? { remote: input.remote } : {}),
          })
          .pipe(
            Effect.map((result) => {
              const localBranch = result.branches.find(
                (branch) => !branch.isRemote && branch.name === localPullRequestBranch,
              );
              if (localBranch) {
                return localBranch;
              }
              if (localPullRequestBranch === pullRequest.headBranch) {
                return null;
              }
              return (
                result.branches.find(
                  (branch) =>
                    !branch.isRemote &&
                    branch.name === pullRequest.headBranch &&
                    branch.worktreePath !== null &&
                    canonicalizeExistingPath(branch.worktreePath) !== rootWorktreePath,
                ) ?? null
              );
            }),
          );

      const existingBranchBeforeFetch = yield* findLocalHeadBranch(input.cwd);
      const existingBranchBeforeFetchPath = existingBranchBeforeFetch?.worktreePath
        ? canonicalizeExistingPath(existingBranchBeforeFetch.worktreePath)
        : null;
      if (
        existingBranchBeforeFetch?.worktreePath &&
        existingBranchBeforeFetchPath !== rootWorktreePath
      ) {
        yield* ensureExistingWorktreeUpstream(existingBranchBeforeFetch.worktreePath);
        return {
          pullRequest,
          branch: localPullRequestBranch,
          worktreePath: existingBranchBeforeFetch.worktreePath,
        };
      }
      if (existingBranchBeforeFetchPath === rootWorktreePath) {
        return yield* gitManagerError(
          "preparePullRequestThread",
          "This PR branch is already checked out in the main repo. Use Local, or switch the main repo off that branch before creating a worktree thread.",
        );
      }

      yield* materializePullRequestHeadBranch({
        cwd: input.cwd,
        pullRequest: pullRequestWithRemoteInfo,
        localBranch: localPullRequestBranch,
        ...(input.settings ? { settings: input.settings } : {}),
        ...(input.remote ? { remote: input.remote } : {}),
      });

      const existingBranchAfterFetch = yield* findLocalHeadBranch(input.cwd);
      const existingBranchAfterFetchPath = existingBranchAfterFetch?.worktreePath
        ? canonicalizeExistingPath(existingBranchAfterFetch.worktreePath)
        : null;
      if (
        existingBranchAfterFetch?.worktreePath &&
        existingBranchAfterFetchPath !== rootWorktreePath
      ) {
        yield* ensureExistingWorktreeUpstream(existingBranchAfterFetch.worktreePath);
        return {
          pullRequest,
          branch: localPullRequestBranch,
          worktreePath: existingBranchAfterFetch.worktreePath,
        };
      }
      if (existingBranchAfterFetchPath === rootWorktreePath) {
        return yield* gitManagerError(
          "preparePullRequestThread",
          "This PR branch is already checked out in the main repo. Use Local, or switch the main repo off that branch before creating a worktree thread.",
        );
      }

      const worktree = yield* gitCore.createWorktree({
        cwd: input.cwd,
        branch: localPullRequestBranch,
        path: null,
        ...(input.remote ? { remote: input.remote } : {}),
      });
      yield* ensureExistingWorktreeUpstream(worktree.worktree.path);

      return {
        pullRequest,
        branch: worktree.worktree.branch,
        worktreePath: worktree.worktree.path,
      };
    },
  );

  const runFeatureBranchStep = (
    cwd: string,
    branch: string | null,
    remote?: GitRemoteTarget,
    commitMessage?: string,
    filePaths?: readonly string[],
    settings?: GitOperationSettings,
  ) =>
    Effect.gen(function* () {
      const suggestion = yield* resolveCommitAndBranchSuggestion({
        cwd,
        branch,
        ...(remote ? { remote } : {}),
        ...(commitMessage ? { commitMessage } : {}),
        ...(filePaths ? { filePaths } : {}),
        ...(settings ? { settings } : {}),
        includeBranch: true,
      });
      if (!suggestion) {
        return yield* gitManagerError(
          "runFeatureBranchStep",
          "Cannot create a feature branch because there are no changes to commit.",
        );
      }

      const preferredBranch = suggestion.branch ?? sanitizeFeatureBranchName(suggestion.subject);
      const existingBranchNames = yield* gitCore.listLocalBranchNames(cwd, remote);
      const resolvedBranch = resolveAutoFeatureBranchName(existingBranchNames, preferredBranch);

      yield* gitCore.createBranch({
        cwd,
        branch: resolvedBranch,
        ...(remote ? { remote } : {}),
      });
      yield* Effect.scoped(
        gitCore.checkoutBranch({
          cwd,
          branch: resolvedBranch,
          ...(remote ? { remote } : {}),
        }),
      );

      return {
        branchStep: { status: "created" as const, name: resolvedBranch },
        resolvedCommitMessage: suggestion.commitMessage,
        resolvedCommitSuggestion: suggestion,
      };
    });

  const runStackedAction: GitManagerShape["runStackedAction"] = Effect.fnUntraced(
    function* (input, options) {
      const progress = createProgressEmitter(input, options);
      const phases: GitActionProgressPhase[] = [
        ...(input.featureBranch ? (["branch"] as const) : []),
        "commit",
        ...(input.action !== "commit" ? (["push"] as const) : []),
        ...(input.action === "commit_push_pr" ? (["pr"] as const) : []),
      ];
      let currentPhase: GitActionProgressPhase | null = null;
      const runAction = Effect.gen(function* () {
        yield* progress.emit({
          kind: "action_started",
          phases,
        });

        const wantsPush = input.action !== "commit";
        const wantsPr = input.action === "commit_push_pr";

        const initialStatus = yield* gitCore.statusDetails(input.cwd, input.remote);
        if (!input.featureBranch && wantsPush && !initialStatus.branch) {
          return yield* gitManagerError("runStackedAction", "Cannot push from detached HEAD.");
        }
        if (!input.featureBranch && wantsPr && !initialStatus.branch) {
          return yield* gitManagerError(
            "runStackedAction",
            "Cannot create a pull request from detached HEAD.",
          );
        }

        let branchStep: { status: "created" | "skipped_not_requested"; name?: string };
        let commitMessageForStep = input.commitMessage;
        let preResolvedCommitSuggestion: CommitAndBranchSuggestion | undefined = undefined;

        if (input.featureBranch) {
          currentPhase = "branch";
          yield* progress.emit({
            kind: "phase_started",
            phase: "branch",
            label: "Preparing feature branch...",
          });
          const result = yield* runFeatureBranchStep(
            input.cwd,
            initialStatus.branch,
            input.remote,
            input.commitMessage,
            input.filePaths,
            input.settings,
          );
          branchStep = result.branchStep;
          commitMessageForStep = result.resolvedCommitMessage;
          preResolvedCommitSuggestion = result.resolvedCommitSuggestion;
        } else {
          branchStep = { status: "skipped_not_requested" as const };
        }

        const currentBranch = branchStep.name ?? initialStatus.branch;

        currentPhase = "commit";
        const commit = yield* runCommitStep(
          input.cwd,
          input.action,
          currentBranch,
          input.remote,
          commitMessageForStep,
          preResolvedCommitSuggestion,
          input.filePaths,
          input.settings,
          options?.progressReporter,
          progress.actionId,
        );

        const push = wantsPush
          ? yield* progress
              .emit({
                kind: "phase_started",
                phase: "push",
                label: "Pushing...",
              })
              .pipe(
                Effect.flatMap(() =>
                  Effect.gen(function* () {
                    currentPhase = "push";
                    return yield* gitCore.pushCurrentBranch(input.cwd, currentBranch, input.remote);
                  }),
                ),
              )
          : { status: "skipped_not_requested" as const };

        const pr = wantsPr
          ? yield* progress
              .emit({
                kind: "phase_started",
                phase: "pr",
                label: "Creating PR...",
              })
              .pipe(
                Effect.flatMap(() =>
                  Effect.gen(function* () {
                    currentPhase = "pr";
                    return yield* runPrStep(input.cwd, currentBranch, input.remote, input.settings);
                  }),
                ),
              )
          : { status: "skipped_not_requested" as const };

        const result = {
          action: input.action,
          branch: branchStep,
          commit,
          push,
          pr,
        };
        yield* progress.emit({
          kind: "action_finished",
          result,
        });
        return result;
      });

      return yield* runAction.pipe(
        Effect.catch((error) =>
          progress
            .emit({
              kind: "action_failed",
              phase: currentPhase,
              message: error.message,
            })
            .pipe(Effect.flatMap(() => Effect.fail(error))),
        ),
      );
    },
  );

  return {
    status,
    resolvePullRequest,
    preparePullRequestThread,
    runStackedAction,
  } satisfies GitManagerShape;
});

export const GitManagerLive = Layer.effect(GitManager, makeGitManager);
