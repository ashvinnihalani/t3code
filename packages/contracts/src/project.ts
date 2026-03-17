import { Schema } from "effect";
import { PositiveInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";
import { EditorId } from "./editor";

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
