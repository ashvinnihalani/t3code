import { describe, expect, it } from "vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";

import { buildThreadRestartToastMarker } from "./threadReconnectToast";
import type { Thread } from "../types";

function createThread(
  overrides: Partial<Thread> & {
    session?: Thread["session"];
  } = {},
): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread 1",
    modelSelection: {
      provider: "codex",
      model: "gpt-5.3-codex",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    latestTurn: null,
    projectPath: "/tmp/project-1",
    branch: [],
    worktreePath: [],
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

describe("buildThreadRestartToastMarker", () => {
  it("returns a marker for resume fallback fresh starts", () => {
    expect(
      buildThreadRestartToastMarker(
        createThread({
          session: {
            provider: "kiro",
            status: "ready",
            orchestrationStatus: "ready",
            reconnectState: "fresh-start",
            reconnectSummary:
              "Persisted provider session was unavailable; started a new provider session.",
            reconnectUpdatedAt: "2026-04-04T00:01:00.000Z",
            createdAt: "2026-04-04T00:00:00.000Z",
            updatedAt: "2026-04-04T00:01:00.000Z",
          },
        }),
      ),
    ).toBe(
      "fresh-start:2026-04-04T00:01:00.000Z:Persisted provider session was unavailable; started a new provider session.",
    );
  });

  it("does not return a marker for normal fresh starts", () => {
    expect(
      buildThreadRestartToastMarker(
        createThread({
          session: {
            provider: "codex",
            status: "ready",
            orchestrationStatus: "ready",
            reconnectState: "fresh-start",
            reconnectSummary: "Started a new provider session.",
            reconnectUpdatedAt: "2026-04-04T00:01:00.000Z",
            createdAt: "2026-04-04T00:00:00.000Z",
            updatedAt: "2026-04-04T00:01:00.000Z",
          },
        }),
      ),
    ).toBeNull();
  });

  it("does not return a marker for resumed sessions", () => {
    expect(
      buildThreadRestartToastMarker(
        createThread({
          session: {
            provider: "claudeAgent",
            status: "ready",
            orchestrationStatus: "ready",
            reconnectState: "resume-thread",
            reconnectSummary: "Resumed the persisted remote provider session.",
            reconnectUpdatedAt: "2026-04-04T00:01:00.000Z",
            createdAt: "2026-04-04T00:00:00.000Z",
            updatedAt: "2026-04-04T00:01:00.000Z",
          },
        }),
      ),
    ).toBeNull();
  });
});
