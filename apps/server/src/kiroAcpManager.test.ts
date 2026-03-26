import { describe, expect, it, vi } from "vitest";
import { ThreadId, TurnId } from "@t3tools/contracts";

import {
  extractKiroCommandResultText,
  formatKiroProcessExitMessage,
  KiroAcpManager,
  parseKiroContextWindowSnapshot,
  readKiroTextChunk,
} from "./kiroAcpManager";

function createTestSession() {
  return {
    threadId: ThreadId.makeUnsafe("thread-1"),
    process: {
      kill: vi.fn(),
    },
    rpc: {
      request: vi.fn(),
      respond: vi.fn(),
      notify: vi.fn(),
    },
    runtimeMode: "full-access" as const,
    cwd: undefined,
    createdAt: "2026-03-19T00:00:00.000Z",
    updatedAt: "2026-03-19T00:00:00.000Z",
    status: "ready" as const,
    model: undefined,
    sessionId: "session-1",
    activeTurnId: TurnId.makeUnsafe("turn-1"),
    modeState: {
      currentModeId: undefined,
      defaultModeId: undefined,
      availableModes: [],
    },
    turns: [],
    pendingPermissionRequests: new Map(),
    suppressReplay: false,
    toolCallKinds: new Map(),
  };
}

describe("readKiroTextChunk", () => {
  it("preserves significant chunk whitespace", () => {
    expect(readKiroTextChunk(" this")).toBe(" this");
    expect(readKiroTextChunk("done ")).toBe("done ");
  });

  it("drops empty or whitespace-only chunks", () => {
    expect(readKiroTextChunk("   ")).toBeUndefined();
    expect(readKiroTextChunk(undefined)).toBeUndefined();
  });
});

describe("formatKiroProcessExitMessage", () => {
  it("includes stderr and a path hint for command-not-found exits", () => {
    expect(
      formatKiroProcessExitMessage({
        code: 127,
        signal: null,
        stderr: "sh: kiro-cli: command not found",
        command: "kiro-cli acp",
      }),
    ).toContain("full `kiro-cli` executable path");
  });
});

describe("extractKiroCommandResultText", () => {
  it("flattens nested command results into readable text", () => {
    expect(
      extractKiroCommandResultText({
        content: [
          {
            type: "text",
            text: "Current context window (5.9% used)",
          },
          {
            type: "text",
            text: "Your prompts 3.8%",
          },
        ],
      }),
    ).toContain("Current context window (5.9% used)");
  });
});

describe("parseKiroContextWindowSnapshot", () => {
  it("parses context usage percentages from /context show output", () => {
    expect(
      parseKiroContextWindowSnapshot(`
Current context window (5.9% used)
█ Context files 0.9%
█ Tools 0.5%
█ Kiro responses 0.7%
█ Your prompts 3.8%
      `),
    ).toEqual({
      usedTokens: 590,
      usedPercentage: 5.9,
      inputTokens: 380,
      outputTokens: 70,
      toolUses: 1,
      compactsAutomatically: true,
    });
  });
});

describe("KiroAcpManager", () => {
  it("emits turn.completed when ACP sends turn_end", async () => {
    const manager = new KiroAcpManager();
    const session = createTestSession();
    session.rpc.request = vi.fn((method: string) => {
      if (method === "_kiro.dev/commands/execute") {
        return Promise.resolve("Current context window (5.9% used)");
      }
      return Promise.resolve(undefined);
    });
    const events: Array<{ type: string; turnId?: string; payload?: unknown }> = [];
    manager.on("event", (event) => {
      events.push(event as { type: string; turnId?: string; payload?: unknown });
    });

    await (
      manager as unknown as {
        handleNotification: (
          session: ReturnType<typeof createTestSession>,
          method: string,
          params: unknown,
        ) => Promise<void>;
      }
    ).handleNotification(session, "session/update", {
      update: {
        sessionUpdate: "turn_end",
        stopReason: "done",
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(session.activeTurnId).toBeUndefined();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "turn.completed",
          turnId: "turn-1",
          payload: expect.objectContaining({
            state: "completed",
            stopReason: "done",
          }),
        }),
        expect.objectContaining({
          type: "thread.token-usage.updated",
          payload: {
            usage: expect.objectContaining({
              usedPercentage: 5.9,
              compactsAutomatically: true,
            }),
          },
        }),
      ]),
    );
  });

  it("does not duplicate completion when turn_end arrives before session/prompt resolves", async () => {
    const manager = new KiroAcpManager();
    const session = createTestSession();
    const deferred: { resolve?: (value: unknown) => void } = {};
    session.rpc.request = vi.fn((method: string) => {
      if (method === "_kiro.dev/commands/execute") {
        return Promise.resolve("Current context window (6.1% used)");
      }
      return new Promise((resolve) => {
        deferred.resolve = resolve;
      });
    });
    (
      manager as unknown as {
        sessions: Map<string, ReturnType<typeof createTestSession>>;
      }
    ).sessions.set(session.threadId, session);

    const events: Array<{ type: string; turnId?: string }> = [];
    manager.on("event", (event) => {
      events.push(event as { type: string; turnId?: string });
    });

    const sendPromise = manager.sendTurn({
      threadId: session.threadId,
      input: "hello",
    });
    const activeTurnId = session.activeTurnId;
    expect(activeTurnId).toBeDefined();

    await (
      manager as unknown as {
        handleNotification: (
          session: ReturnType<typeof createTestSession>,
          method: string,
          params: unknown,
        ) => Promise<void>;
      }
    ).handleNotification(session, "session/update", {
      update: {
        sessionUpdate: "turn_end",
      },
    });

    if (!deferred.resolve) {
      throw new Error("Expected session/prompt resolver to be registered.");
    }
    deferred.resolve({});
    const result = await sendPromise;

    expect(result.turnId).toBe(activeTurnId);
    expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
  });
});
