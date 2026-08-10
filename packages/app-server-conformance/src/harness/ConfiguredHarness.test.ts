import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

import { runConfiguredHarness } from "./ConfiguredHarness.ts";

const fixturePath = NodePath.resolve(
  import.meta.dirname,
  "../../test/fixtures/scripted-app-server.ts",
);

describe("runConfiguredHarness", () => {
  it("runs the client scenario against an executable selected at runtime", async () => {
    const result = await runConfiguredHarness({
      executable: process.execPath,
      args: [fixturePath],
      cwd: import.meta.dirname,
      workspace: import.meta.dirname,
      environment: {},
      timeoutMs: 5_000,
    });

    expect(result.report).toEqual({
      compatible: true,
      scenario: "core-lifecycle",
      traceEntries: 14,
      observedMethods: [
        "initialize",
        "initialized",
        "thread/start",
        "thread/started",
        "turn/start",
        "turn/started",
        "item/started",
        "item/agentMessage/delta",
        "item/completed",
        "turn/completed",
      ],
      schemaIssues: [],
      lifecycleIssues: [],
    });
  });
});
