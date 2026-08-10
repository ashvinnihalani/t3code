import { describe, expect, it } from "@effect/vitest";

import type { TraceEntry } from "../protocol/MessageRecorder.ts";
import { normalizeTrace } from "./TraceNormalizer.ts";

describe("normalizeTrace", () => {
  it("preserves identity relationships while replacing machine-specific values", () => {
    const trace: ReadonlyArray<TraceEntry> = [
      {
        sequence: 1,
        direction: "client-to-server",
        kind: "request",
        method: "turn/start",
        id: 41,
        payload: {
          id: 41,
          method: "turn/start",
          params: {
            threadId: "thread-local-a",
            cwd: "/tmp/workspace",
            version: "0.0.32",
          },
        },
      },
      {
        sequence: 2,
        direction: "server-to-client",
        kind: "notification",
        method: "item/agentMessage/delta",
        payload: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "thread-local-a",
            turnId: "turn-random",
            itemId: "item-random",
            status: "inProgress",
            path: "/tmp/workspace/src/main.ts",
            logPath: "/tmp/codex/session.log",
          },
        },
      },
      {
        sequence: 3,
        direction: "server-to-client",
        kind: "response",
        id: 41,
        payload: { id: 41, result: { threadId: "thread-local-a" } },
      },
    ];

    expect(
      normalizeTrace(trace, {
        workspace: "/tmp/workspace",
        codexHome: "/tmp/codex",
      }),
    ).toEqual([
      {
        ...trace[0],
        id: "$request1",
        payload: {
          id: "$request1",
          method: "turn/start",
          params: {
            threadId: "$thread1",
            cwd: "$WORKSPACE",
            version: "$VERSION",
          },
        },
      },
      {
        ...trace[1],
        payload: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "$thread1",
            turnId: "$turn1",
            itemId: "$item1",
            status: "inProgress",
            path: "$WORKSPACE/src/main.ts",
            logPath: "$CODEX_HOME/session.log",
          },
        },
      },
      {
        ...trace[2],
        id: "$request1",
        payload: { id: "$request1", result: { threadId: "$thread1" } },
      },
    ]);
  });

  it("assigns distinct logical identities without normalizing semantic values", () => {
    const trace: ReadonlyArray<TraceEntry> = [
      {
        sequence: 1,
        direction: "server-to-client",
        kind: "notification",
        method: "turn/completed",
        payload: {
          method: "turn/completed",
          params: {
            thread_id: "thread-a",
            turn_id: "turn-a",
            status: "failed",
            toolName: "shell",
          },
        },
      },
      {
        sequence: 2,
        direction: "server-to-client",
        kind: "notification",
        method: "turn/completed",
        payload: {
          method: "turn/completed",
          params: {
            thread_id: "thread-b",
            turn_id: "turn-b",
            status: "interrupted",
            toolName: "shell",
          },
        },
      },
    ];

    const normalized = normalizeTrace(trace, { workspace: "/workspace", codexHome: "/codex" });
    expect(normalized.map((entry) => entry.payload)).toEqual([
      {
        method: "turn/completed",
        params: {
          thread_id: "$thread1",
          turn_id: "$turn1",
          status: "failed",
          toolName: "shell",
        },
      },
      {
        method: "turn/completed",
        params: {
          thread_id: "$thread2",
          turn_id: "$turn2",
          status: "interrupted",
          toolName: "shell",
        },
      },
    ]);
  });
});
