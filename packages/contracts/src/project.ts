import { Schema } from "effect";
import { PositiveInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";
import { EditorId } from "./editor";
import { EnvironmentDefinition, EnvironmentFileLocation, EnvironmentId } from "./orchestration";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;
const ProjectRouteInput = Schema.Struct({
  projectId: ProjectId,
});

export const ProjectSearchEntriesInput = Schema.Struct({
  ...ProjectRouteInput.fields,
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

const ProjectEntryKind = Schema.Literals(["file", "directory"]);

export const ProjectEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  parentPath: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export const ProjectWriteFileInput = Schema.Struct({
  ...ProjectRouteInput.fields,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  contents: Schema.String,
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectEditorTarget = Schema.Struct({
  ...ProjectRouteInput.fields,
  threadId: Schema.optional(ThreadId),
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  line: Schema.optional(PositiveInt),
  column: Schema.optional(PositiveInt),
});
export type ProjectEditorTarget = typeof ProjectEditorTarget.Type;

export const ProjectOpenInEditorInput = Schema.Struct({
  ...ProjectRouteInput.fields,
  editor: EditorId,
});
export type ProjectOpenInEditorInput = typeof ProjectOpenInEditorInput.Type;

export const ProjectOpenPathInEditorInput = Schema.Struct({
  ...ProjectEditorTarget.fields,
  editor: EditorId,
});
export type ProjectOpenPathInEditorInput = typeof ProjectOpenPathInEditorInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;

export const ProjectEnvironmentConfigDefaults = Schema.Struct({
  selectedEnvironmentId: Schema.NullOr(EnvironmentId),
});
export type ProjectEnvironmentConfigDefaults = typeof ProjectEnvironmentConfigDefaults.Type;

export const ProjectEnvironmentConfig = Schema.Struct({
  version: Schema.Literal(1),
  defaults: ProjectEnvironmentConfigDefaults,
  environments: Schema.Array(EnvironmentDefinition),
});
export type ProjectEnvironmentConfig = typeof ProjectEnvironmentConfig.Type;

export const ProjectReadEnvironmentConfigInput = Schema.Struct({
  ...ProjectRouteInput.fields,
  fileLocation: EnvironmentFileLocation,
});
export type ProjectReadEnvironmentConfigInput = typeof ProjectReadEnvironmentConfigInput.Type;

export const ProjectReadEnvironmentConfigResult = Schema.Struct({
  path: TrimmedNonEmptyString,
  config: Schema.NullOr(ProjectEnvironmentConfig),
});
export type ProjectReadEnvironmentConfigResult = typeof ProjectReadEnvironmentConfigResult.Type;

export const ProjectWriteEnvironmentConfigInput = Schema.Struct({
  ...ProjectRouteInput.fields,
  fileLocation: EnvironmentFileLocation,
  config: ProjectEnvironmentConfig,
});
export type ProjectWriteEnvironmentConfigInput = typeof ProjectWriteEnvironmentConfigInput.Type;

export const ProjectWriteEnvironmentConfigResult = Schema.Struct({
  path: TrimmedNonEmptyString,
});
export type ProjectWriteEnvironmentConfigResult = typeof ProjectWriteEnvironmentConfigResult.Type;

export const ProjectMigrateEnvironmentConfigInput = Schema.Struct({
  ...ProjectRouteInput.fields,
  from: EnvironmentFileLocation,
  to: EnvironmentFileLocation,
});
export type ProjectMigrateEnvironmentConfigInput = typeof ProjectMigrateEnvironmentConfigInput.Type;

export const ProjectMigrateEnvironmentConfigResult = Schema.Struct({
  path: TrimmedNonEmptyString,
  migrated: Schema.Boolean,
});
export type ProjectMigrateEnvironmentConfigResult =
  typeof ProjectMigrateEnvironmentConfigResult.Type;
