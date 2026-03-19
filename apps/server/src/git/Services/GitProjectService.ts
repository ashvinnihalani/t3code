import type {
  GitListRepositoriesResult,
  GitRequestSettings,
  GitRunAggregateActionResult,
  ProjectRemoteTarget,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { GitManagerServiceError } from "../Errors.ts";

export interface GitProjectListRepositoriesInput {
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly remote?: ProjectRemoteTarget | null;
  readonly threadId?: ThreadId;
}

export interface GitProjectRunAggregateActionInput {
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly remote?: ProjectRemoteTarget | null;
  readonly threadId?: ThreadId;
  readonly action: "commit" | "push";
  readonly repoIds?: ReadonlyArray<string>;
  readonly settings?: GitRequestSettings;
}

export interface GitProjectServiceShape {
  readonly listRepositories: (
    input: GitProjectListRepositoriesInput,
  ) => Effect.Effect<GitListRepositoriesResult, GitManagerServiceError>;
  readonly runAggregateAction: (
    input: GitProjectRunAggregateActionInput,
  ) => Effect.Effect<GitRunAggregateActionResult, GitManagerServiceError>;
}

export class GitProjectService extends ServiceMap.Service<
  GitProjectService,
  GitProjectServiceShape
>()("t3/git/Services/GitProjectService") {}
