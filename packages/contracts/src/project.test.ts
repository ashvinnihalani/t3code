import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ProjectOpenPathInEditorInput,
  ProjectSearchEntriesInput,
  ProjectWriteFileInput,
} from "./project";

function decodeSync<S extends Schema.Top>(schema: S, input: unknown): Schema.Schema.Type<S> {
  return Schema.decodeUnknownSync(schema as never)(input) as Schema.Schema.Type<S>;
}

function decodes<S extends Schema.Top>(schema: S, input: unknown): boolean {
  try {
    Schema.decodeUnknownSync(schema as never)(input);
    return true;
  } catch {
    return false;
  }
}

describe("ProjectSearchEntriesInput", () => {
  it("accepts a project-scoped search request", () => {
    expect(
      decodes(ProjectSearchEntriesInput, {
        projectId: "project-1",
        query: "src",
        limit: 20,
      }),
    ).toBe(true);
  });
});

describe("ProjectWriteFileInput", () => {
  it("trims relative paths", () => {
    const parsed = decodeSync(ProjectWriteFileInput, {
      projectId: "project-1",
      relativePath: " plans/next.md ",
      contents: "# Plan\n",
    });
    expect(parsed.relativePath).toBe("plans/next.md");
  });
});

describe("ProjectOpenPathInEditorInput", () => {
  it("accepts project-aware file targets", () => {
    expect(
      decodes(ProjectOpenPathInEditorInput, {
        projectId: "project-1",
        threadId: "thread-1",
        relativePath: "src/main.ts",
        line: 12,
        column: 3,
        editor: "cursor",
      }),
    ).toBe(true);
  });

  it("rejects non-positive line numbers", () => {
    expect(
      decodes(ProjectOpenPathInEditorInput, {
        projectId: "project-1",
        relativePath: "src/main.ts",
        line: 0,
        editor: "cursor",
      }),
    ).toBe(false);
  });
});
