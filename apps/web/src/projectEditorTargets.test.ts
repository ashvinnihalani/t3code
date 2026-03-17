import { describe, expect, it } from "vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import {
  resolveProjectAbsolutePathFromRelativePath,
  resolveProjectEditorTargetFromMarkdownHref,
  resolveProjectEditorTargetFromRawPath,
  resolveProjectRelativePathFromAbsolutePath,
} from "./projectEditorTargets";

const projectId = ProjectId.makeUnsafe("project-1");
const threadId = ThreadId.makeUnsafe("thread-1");

describe("projectEditorTargets", () => {
  it("resolves in-project raw paths to project-aware editor targets", () => {
    expect(
      resolveProjectEditorTargetFromRawPath("src/main.ts:12:3", {
        projectId,
        threadId,
        referenceRoot: "/workspace",
        remote: null,
      }),
    ).toEqual({
      kind: "project-path",
      input: {
        projectId,
        threadId,
        relativePath: "src/main.ts",
        line: 12,
        column: 3,
      },
    });
  });

  it("falls back to shell targets for local paths outside the project", () => {
    expect(
      resolveProjectEditorTargetFromRawPath("../outside.ts", {
        projectId,
        threadId,
        referenceRoot: "/workspace",
        remote: null,
      }),
    ).toEqual({
      kind: "shell",
      target: "/outside.ts",
    });
  });

  it("does not emit shell fallbacks for remote paths outside the project", () => {
    expect(
      resolveProjectEditorTargetFromRawPath("../outside.ts", {
        projectId,
        threadId,
        referenceRoot: "/workspace",
        remote: { kind: "ssh", hostAlias: "prod" },
      }),
    ).toBeNull();
  });

  it("resolves markdown file links against the project root", () => {
    expect(
      resolveProjectEditorTargetFromMarkdownHref("./docs/guide.md#L9C2", {
        projectId,
        threadId,
        referenceRoot: "/workspace",
        remote: null,
      }),
    ).toEqual({
      kind: "project-path",
      input: {
        projectId,
        threadId,
        relativePath: "docs/guide.md",
        line: 9,
        column: 2,
      },
    });
  });

  it("round-trips relative and absolute project paths", () => {
    const absolutePath = "/workspace/src/main.ts";
    expect(resolveProjectRelativePathFromAbsolutePath(absolutePath, "/workspace")).toBe(
      "src/main.ts",
    );
    expect(resolveProjectAbsolutePathFromRelativePath("src/main.ts", "/workspace")).toBe(
      absolutePath,
    );
  });
});
