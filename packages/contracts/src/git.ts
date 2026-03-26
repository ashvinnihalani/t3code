import { Schema } from "effect";
import { NonNegativeInt, PositiveInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas";
import { ModelSelection } from "./model";

const TrimmedNonEmptyStringSchema = TrimmedNonEmptyString;

// Domain Types

export const GitStackedAction = Schema.Literals(["commit", "commit_push", "commit_push_pr"]);
export type GitStackedAction = typeof GitStackedAction.Type;
export const GitActionProgressPhase = Schema.Literals(["branch", "commit", "push", "pr"]);
export type GitActionProgressPhase = typeof GitActionProgressPhase.Type;
export const GitActionProgressKind = Schema.Literals([
  "action_started",
  "phase_started",
  "hook_started",
  "hook_output",
  "hook_finished",
  "action_finished",
  "action_failed",
]);
export type GitActionProgressKind = typeof GitActionProgressKind.Type;
export const GitActionProgressStream = Schema.Literals(["stdout", "stderr"]);
export type GitActionProgressStream = typeof GitActionProgressStream.Type;
const GitCommitStepStatus = Schema.Literals(["created", "skipped_no_changes"]);
const GitPushStepStatus = Schema.Literals([
  "pushed",
  "skipped_not_requested",
  "skipped_up_to_date",
]);
const GitBranchStepStatus = Schema.Literals(["created", "skipped_not_requested"]);
const GitPrStepStatus = Schema.Literals(["created", "opened_existing", "skipped_not_requested"]);
const GitStatusPrState = Schema.Literals(["open", "closed", "merged"]);
const GitPullRequestReference = TrimmedNonEmptyStringSchema;
const GitPullRequestState = Schema.Literals(["open", "closed", "merged"]);
const GitPreparePullRequestThreadMode = Schema.Literals(["local", "worktree"]);
export const GitRequestSettings = Schema.Struct({
  githubBinaryPath: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
  commitPrompt: Schema.optional(Schema.String.check(Schema.isMaxLength(10_000))),
  textGenerationModelSelection: Schema.optional(ModelSelection),
});
export type GitRequestSettings = typeof GitRequestSettings.Type;

export const GitBranch = Schema.Struct({
  name: TrimmedNonEmptyStringSchema,
  isRemote: Schema.optional(Schema.Boolean),
  remoteName: Schema.optional(TrimmedNonEmptyStringSchema),
  current: Schema.Boolean,
  isDefault: Schema.Boolean,
  worktreePath: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
});
export type GitBranch = typeof GitBranch.Type;

const GitWorktree = Schema.Struct({
  path: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
});
const GitResolvedPullRequest = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyStringSchema,
  url: Schema.String,
  baseBranch: TrimmedNonEmptyStringSchema,
  headBranch: TrimmedNonEmptyStringSchema,
  state: GitPullRequestState,
});
export type GitResolvedPullRequest = typeof GitResolvedPullRequest.Type;

// RPC Inputs

export const GitStatusInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  projectId: Schema.optional(ProjectId),
  repos: Schema.optional(
    Schema.Array(
      Schema.Struct({
        repoId: TrimmedNonEmptyStringSchema,
        branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyStringSchema)),
      }),
    ),
  ),
  settings: Schema.optional(GitRequestSettings),
});
export type GitStatusInput = typeof GitStatusInput.Type;

export const GitPullInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  projectId: Schema.optional(ProjectId),
  repos: Schema.optional(
    Schema.Array(
      Schema.Struct({
        repoId: TrimmedNonEmptyStringSchema,
        branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyStringSchema)),
      }),
    ),
  ),
});
export type GitPullInput = typeof GitPullInput.Type;

export const GitRunStackedActionInput = Schema.Struct({
  actionId: TrimmedNonEmptyStringSchema,
  cwd: TrimmedNonEmptyStringSchema,
  projectId: Schema.optional(ProjectId),
  repos: Schema.optional(
    Schema.Array(
      Schema.Struct({
        repoId: TrimmedNonEmptyStringSchema,
        branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyStringSchema)),
      }),
    ),
  ),
  action: GitStackedAction,
  commitMessage: Schema.optional(TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(10_000))),
  featureBranch: Schema.optional(Schema.Boolean),
  filePaths: Schema.optional(
    Schema.Array(TrimmedNonEmptyStringSchema).check(Schema.isMinLength(1)),
  ),
  settings: Schema.optional(GitRequestSettings),
  modelSelection: ModelSelection,
});
export type GitRunStackedActionInput = typeof GitRunStackedActionInput.Type;

export const GitListBranchesInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  projectId: Schema.optional(ProjectId),
  repos: Schema.optional(
    Schema.Array(
      Schema.Struct({
        repoId: TrimmedNonEmptyStringSchema,
        branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyStringSchema)),
      }),
    ),
  ),
});
export type GitListBranchesInput = typeof GitListBranchesInput.Type;

export const GitCreateWorktreeInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  projectId: Schema.optional(ProjectId),
  repos: Schema.optional(
    Schema.Array(
      Schema.Struct({
        repoId: TrimmedNonEmptyStringSchema,
        branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyStringSchema)),
      }),
    ),
  ),
  branch: TrimmedNonEmptyStringSchema,
  newBranch: Schema.optional(TrimmedNonEmptyStringSchema),
  path: Schema.NullOr(TrimmedNonEmptyStringSchema),
});
export type GitCreateWorktreeInput = typeof GitCreateWorktreeInput.Type;

export const GitPullRequestRefInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  projectId: Schema.optional(ProjectId),
  reference: GitPullRequestReference,
  settings: Schema.optional(GitRequestSettings),
});
export type GitPullRequestRefInput = typeof GitPullRequestRefInput.Type;

export const GitPreparePullRequestThreadInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  projectId: Schema.optional(ProjectId),
  reference: GitPullRequestReference,
  mode: GitPreparePullRequestThreadMode,
  settings: Schema.optional(GitRequestSettings),
});
export type GitPreparePullRequestThreadInput = typeof GitPreparePullRequestThreadInput.Type;

export const GitRemoveWorktreeInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  projectId: Schema.optional(ProjectId),
  path: TrimmedNonEmptyStringSchema,
  force: Schema.optional(Schema.Boolean),
});
export type GitRemoveWorktreeInput = typeof GitRemoveWorktreeInput.Type;

export const GitCreateBranchInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  projectId: Schema.optional(ProjectId),
  repos: Schema.optional(
    Schema.Array(
      Schema.Struct({
        repoId: TrimmedNonEmptyStringSchema,
        branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyStringSchema)),
      }),
    ),
  ),
  branch: TrimmedNonEmptyStringSchema,
});
export type GitCreateBranchInput = typeof GitCreateBranchInput.Type;

export const GitCheckoutInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  projectId: Schema.optional(ProjectId),
  repos: Schema.optional(
    Schema.Array(
      Schema.Struct({
        repoId: TrimmedNonEmptyStringSchema,
        branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyStringSchema)),
      }),
    ),
  ),
  branch: TrimmedNonEmptyStringSchema,
});
export type GitCheckoutInput = typeof GitCheckoutInput.Type;

export const GitInitInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  projectId: Schema.optional(ProjectId),
});
export type GitInitInput = typeof GitInitInput.Type;

// RPC Results

const GitStatusPr = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyStringSchema,
  url: Schema.String,
  baseBranch: TrimmedNonEmptyStringSchema,
  headBranch: TrimmedNonEmptyStringSchema,
  state: GitStatusPrState,
});

export const GitStatusResult = Schema.Struct({
  branch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  hasWorkingTreeChanges: Schema.Boolean,
  workingTree: Schema.Struct({
    files: Schema.Array(
      Schema.Struct({
        path: TrimmedNonEmptyStringSchema,
        insertions: NonNegativeInt,
        deletions: NonNegativeInt,
      }),
    ),
    insertions: NonNegativeInt,
    deletions: NonNegativeInt,
  }),
  hasUpstream: Schema.Boolean,
  aheadCount: NonNegativeInt,
  behindCount: NonNegativeInt,
  pr: Schema.NullOr(GitStatusPr),
});
export type GitStatusResult = typeof GitStatusResult.Type;

export const GitListBranchesResult = Schema.Struct({
  branches: Schema.Array(GitBranch),
  isRepo: Schema.Boolean,
  hasOriginRemote: Schema.Boolean,
});
export type GitListBranchesResult = typeof GitListBranchesResult.Type;

export const GitCreateWorktreeResult = Schema.Struct({
  worktree: GitWorktree,
});
export type GitCreateWorktreeResult = typeof GitCreateWorktreeResult.Type;

export const GitResolvePullRequestResult = Schema.Struct({
  pullRequest: GitResolvedPullRequest,
});
export type GitResolvePullRequestResult = typeof GitResolvePullRequestResult.Type;

export const GitPreparePullRequestThreadResult = Schema.Struct({
  pullRequest: GitResolvedPullRequest,
  branch: TrimmedNonEmptyStringSchema,
  worktreePath: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
});
export type GitPreparePullRequestThreadResult = typeof GitPreparePullRequestThreadResult.Type;

export const GitProjectRepoTarget = Schema.Struct({
  repoId: TrimmedNonEmptyStringSchema,
  cwd: TrimmedNonEmptyStringSchema,
  relativePath: TrimmedNonEmptyStringSchema,
  displayName: TrimmedNonEmptyStringSchema,
});
export type GitProjectRepoTarget = typeof GitProjectRepoTarget.Type;

export const GitProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type GitProjectInput = typeof GitProjectInput.Type;

export const GitProjectCreateBranchInput = Schema.Struct({
  projectId: ProjectId,
  branch: TrimmedNonEmptyStringSchema,
});
export type GitProjectCreateBranchInput = typeof GitProjectCreateBranchInput.Type;

export const GitProjectCheckoutInput = Schema.Struct({
  projectId: ProjectId,
  branch: TrimmedNonEmptyStringSchema,
});
export type GitProjectCheckoutInput = typeof GitProjectCheckoutInput.Type;

export const GitProjectCreateWorktreeInput = Schema.Struct({
  projectId: ProjectId,
  branch: TrimmedNonEmptyStringSchema,
  newBranch: Schema.optional(TrimmedNonEmptyStringSchema),
  path: Schema.NullOr(TrimmedNonEmptyStringSchema),
});
export type GitProjectCreateWorktreeInput = typeof GitProjectCreateWorktreeInput.Type;

export const GitProjectPullInput = GitProjectInput;
export type GitProjectPullInput = typeof GitProjectPullInput.Type;

export const GitProjectStatusInput = Schema.Struct({
  projectId: ProjectId,
  settings: Schema.optional(GitRequestSettings),
});
export type GitProjectStatusInput = typeof GitProjectStatusInput.Type;

export const GitProjectListBranchesInput = GitProjectInput;
export type GitProjectListBranchesInput = typeof GitProjectListBranchesInput.Type;

export const GitProjectRunStackedActionInput = Schema.Struct({
  actionId: TrimmedNonEmptyStringSchema,
  projectId: ProjectId,
  action: GitStackedAction,
  commitMessage: Schema.optional(TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(10_000))),
  featureBranch: Schema.optional(Schema.Boolean),
  settings: Schema.optional(GitRequestSettings),
  modelSelection: ModelSelection,
});
export type GitProjectRunStackedActionInput = typeof GitProjectRunStackedActionInput.Type;

export const GitRunStackedActionResult = Schema.Struct({
  action: GitStackedAction,
  branch: Schema.Struct({
    status: GitBranchStepStatus,
    name: Schema.optional(TrimmedNonEmptyStringSchema),
  }),
  commit: Schema.Struct({
    status: GitCommitStepStatus,
    commitSha: Schema.optional(TrimmedNonEmptyStringSchema),
    subject: Schema.optional(TrimmedNonEmptyStringSchema),
  }),
  push: Schema.Struct({
    status: GitPushStepStatus,
    branch: Schema.optional(TrimmedNonEmptyStringSchema),
    upstreamBranch: Schema.optional(TrimmedNonEmptyStringSchema),
    setUpstream: Schema.optional(Schema.Boolean),
  }),
  pr: Schema.Struct({
    status: GitPrStepStatus,
    url: Schema.optional(Schema.String),
    number: Schema.optional(PositiveInt),
    baseBranch: Schema.optional(TrimmedNonEmptyStringSchema),
    headBranch: Schema.optional(TrimmedNonEmptyStringSchema),
    title: Schema.optional(TrimmedNonEmptyStringSchema),
  }),
});
export type GitRunStackedActionResult = typeof GitRunStackedActionResult.Type;

export const GitProjectBranchState = Schema.Struct({
  repoId: TrimmedNonEmptyStringSchema,
  cwd: TrimmedNonEmptyStringSchema,
  relativePath: TrimmedNonEmptyStringSchema,
  displayName: TrimmedNonEmptyStringSchema,
  branches: Schema.Array(GitBranch),
  isRepo: Schema.Boolean,
  hasOriginRemote: Schema.Boolean,
  error: Schema.optional(TrimmedNonEmptyStringSchema),
});
export type GitProjectBranchState = typeof GitProjectBranchState.Type;

export const GitProjectListBranchesResult = Schema.Struct({
  repos: Schema.Array(GitProjectBranchState),
});
export type GitProjectListBranchesResult = typeof GitProjectListBranchesResult.Type;

export const GitProjectStatusRepoResult = Schema.Struct({
  repoId: TrimmedNonEmptyStringSchema,
  cwd: TrimmedNonEmptyStringSchema,
  relativePath: TrimmedNonEmptyStringSchema,
  displayName: TrimmedNonEmptyStringSchema,
  eligible: Schema.Boolean,
  skippedReason: Schema.optional(
    Schema.Literals(["clean", "no_ahead_commits", "blocked", "not_selected"]),
  ),
  status: GitStatusResult,
  error: Schema.optional(TrimmedNonEmptyStringSchema),
});
export type GitProjectStatusRepoResult = typeof GitProjectStatusRepoResult.Type;

export const GitProjectStatusResult = Schema.Struct({
  repos: Schema.Array(GitProjectStatusRepoResult),
});
export type GitProjectStatusResult = typeof GitProjectStatusResult.Type;

export const GitProjectCreateBranchRepoResult = Schema.Struct({
  repoId: TrimmedNonEmptyStringSchema,
  cwd: TrimmedNonEmptyStringSchema,
  relativePath: TrimmedNonEmptyStringSchema,
  displayName: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
  status: Schema.Literals(["created", "exists", "failed"]),
  error: Schema.optional(TrimmedNonEmptyStringSchema),
});
export type GitProjectCreateBranchRepoResult = typeof GitProjectCreateBranchRepoResult.Type;

export const GitProjectCreateBranchResult = Schema.Struct({
  repos: Schema.Array(GitProjectCreateBranchRepoResult),
});
export type GitProjectCreateBranchResult = typeof GitProjectCreateBranchResult.Type;

export const GitProjectCheckoutRepoResult = Schema.Struct({
  repoId: TrimmedNonEmptyStringSchema,
  cwd: TrimmedNonEmptyStringSchema,
  relativePath: TrimmedNonEmptyStringSchema,
  displayName: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
  status: Schema.Literals(["checked_out", "reused", "failed"]),
  error: Schema.optional(TrimmedNonEmptyStringSchema),
});
export type GitProjectCheckoutRepoResult = typeof GitProjectCheckoutRepoResult.Type;

export const GitProjectCheckoutResult = Schema.Struct({
  repos: Schema.Array(GitProjectCheckoutRepoResult),
});
export type GitProjectCheckoutResult = typeof GitProjectCheckoutResult.Type;

export const GitProjectCreateWorktreeRepoResult = Schema.Struct({
  repoId: TrimmedNonEmptyStringSchema,
  cwd: TrimmedNonEmptyStringSchema,
  relativePath: TrimmedNonEmptyStringSchema,
  displayName: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
  worktreePath: Schema.optional(TrimmedNonEmptyStringSchema),
  status: Schema.Literals(["created", "reused", "failed"]),
  error: Schema.optional(TrimmedNonEmptyStringSchema),
});
export type GitProjectCreateWorktreeRepoResult = typeof GitProjectCreateWorktreeRepoResult.Type;

export const GitProjectCreateWorktreeResult = Schema.Struct({
  parentPath: TrimmedNonEmptyStringSchema,
  repos: Schema.Array(GitProjectCreateWorktreeRepoResult),
});
export type GitProjectCreateWorktreeResult = typeof GitProjectCreateWorktreeResult.Type;

export const GitProjectPullRepoResult = Schema.Struct({
  repoId: TrimmedNonEmptyStringSchema,
  cwd: TrimmedNonEmptyStringSchema,
  relativePath: TrimmedNonEmptyStringSchema,
  displayName: TrimmedNonEmptyStringSchema,
  status: Schema.Literals(["pulled", "skipped_up_to_date", "failed"]),
  branch: Schema.optional(TrimmedNonEmptyStringSchema),
  upstreamBranch: Schema.optional(TrimmedNonEmptyStringSchema),
  error: Schema.optional(TrimmedNonEmptyStringSchema),
});
export type GitProjectPullRepoResult = typeof GitProjectPullRepoResult.Type;

export const GitProjectPullResult = Schema.Struct({
  repos: Schema.Array(GitProjectPullRepoResult),
});
export type GitProjectPullResult = typeof GitProjectPullResult.Type;

export const GitProjectRunStackedActionRepoResult = Schema.Struct({
  repoId: TrimmedNonEmptyStringSchema,
  cwd: TrimmedNonEmptyStringSchema,
  relativePath: TrimmedNonEmptyStringSchema,
  displayName: TrimmedNonEmptyStringSchema,
  eligible: Schema.Boolean,
  skippedReason: Schema.optional(
    Schema.Literals(["clean", "no_ahead_commits", "blocked", "not_selected"]),
  ),
  result: Schema.optional(GitRunStackedActionResult),
  error: Schema.optional(TrimmedNonEmptyStringSchema),
});
export type GitProjectRunStackedActionRepoResult = typeof GitProjectRunStackedActionRepoResult.Type;

export const GitProjectRunStackedActionResult = Schema.Struct({
  action: GitStackedAction,
  repos: Schema.Array(GitProjectRunStackedActionRepoResult),
});
export type GitProjectRunStackedActionResult = typeof GitProjectRunStackedActionResult.Type;

export const GitStatusResponse = GitProjectStatusResult;
export type GitStatusResponse = typeof GitStatusResponse.Type;

export const GitListBranchesResponse = GitProjectListBranchesResult;
export type GitListBranchesResponse = typeof GitListBranchesResponse.Type;

export const GitCreateBranchResponse = GitProjectCreateBranchResult;
export type GitCreateBranchResponse = typeof GitCreateBranchResponse.Type;

export const GitCheckoutResponse = GitProjectCheckoutResult;
export type GitCheckoutResponse = typeof GitCheckoutResponse.Type;

export const GitCreateWorktreeResponse = GitProjectCreateWorktreeResult;
export type GitCreateWorktreeResponse = typeof GitCreateWorktreeResponse.Type;

export const GitPullResponse = GitProjectPullResult;
export type GitPullResponse = typeof GitPullResponse.Type;

export const GitRunStackedActionResponse = GitProjectRunStackedActionResult;
export type GitRunStackedActionResponse = typeof GitRunStackedActionResponse.Type;

export const GitPullResult = Schema.Struct({
  status: Schema.Literals(["pulled", "skipped_up_to_date"]),
  branch: TrimmedNonEmptyStringSchema,
  upstreamBranch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
});
export type GitPullResult = typeof GitPullResult.Type;

const GitActionProgressBase = Schema.Struct({
  actionId: TrimmedNonEmptyStringSchema,
  cwd: TrimmedNonEmptyStringSchema,
  action: GitStackedAction,
  repoId: Schema.optional(TrimmedNonEmptyStringSchema),
  relativePath: Schema.optional(TrimmedNonEmptyStringSchema),
  displayName: Schema.optional(TrimmedNonEmptyStringSchema),
});

const GitActionStartedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("action_started"),
  phases: Schema.Array(GitActionProgressPhase),
});
const GitActionPhaseStartedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("phase_started"),
  phase: GitActionProgressPhase,
  label: TrimmedNonEmptyStringSchema,
});
const GitActionHookStartedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("hook_started"),
  hookName: TrimmedNonEmptyStringSchema,
});
const GitActionHookOutputEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("hook_output"),
  hookName: Schema.NullOr(TrimmedNonEmptyStringSchema),
  stream: GitActionProgressStream,
  text: TrimmedNonEmptyStringSchema,
});
const GitActionHookFinishedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("hook_finished"),
  hookName: TrimmedNonEmptyStringSchema,
  exitCode: Schema.NullOr(Schema.Int),
  durationMs: Schema.NullOr(NonNegativeInt),
});
const GitActionFinishedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("action_finished"),
  result: GitRunStackedActionResult,
});
const GitActionFailedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("action_failed"),
  phase: Schema.NullOr(GitActionProgressPhase),
  message: TrimmedNonEmptyStringSchema,
});

export const GitActionProgressEvent = Schema.Union([
  GitActionStartedEvent,
  GitActionPhaseStartedEvent,
  GitActionHookStartedEvent,
  GitActionHookOutputEvent,
  GitActionHookFinishedEvent,
  GitActionFinishedEvent,
  GitActionFailedEvent,
]);
export type GitActionProgressEvent = typeof GitActionProgressEvent.Type;
