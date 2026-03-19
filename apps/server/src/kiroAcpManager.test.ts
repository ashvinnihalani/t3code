import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadId, TurnId } from "@t3tools/contracts";

import { formatKiroProcessExitMessage, KiroAcpManager, readKiroTextChunk } from "./kiroAcpManager";

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
    modelState: {
      currentModelId: undefined,
      availableModels: [],
    },
    commandsSnapshot: {
      commands: [],
      prompts: [],
      tools: [],
      mcpServers: [],
    },
    turns: [],
    pendingPermissionRequests: new Map(),
    suppressReplay: false,
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

describe("KiroAcpManager", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits turn/completed when ACP sends turn_end", async () => {
    const manager = new KiroAcpManager();
    const session = createTestSession();
    const events: Array<{ method: string; turnId?: string; payload?: unknown }> = [];
    manager.on("event", (event) => {
      events.push(event as { method: string; turnId?: string; payload?: unknown });
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

    expect(session.activeTurnId).toBeUndefined();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "turn/completed",
          turnId: "turn-1",
          payload: expect.objectContaining({
            turn: expect.objectContaining({
              status: "completed",
              stopReason: "done",
            }),
          }),
        }),
      ]),
    );
  });

  it("does not duplicate completion when turn_end arrives before session/prompt resolves", async () => {
    const manager = new KiroAcpManager();
    const session = createTestSession();
    const deferred: { resolve?: (value: unknown) => void } = {};
    session.rpc.request = vi.fn((_method: string) => {
      return new Promise((resolve) => {
        deferred.resolve = resolve;
      });
    });
    (
      manager as unknown as {
        sessions: Map<string, ReturnType<typeof createTestSession>>;
      }
    ).sessions.set(session.threadId, session);

    const events: Array<{ method: string; turnId?: string }> = [];
    manager.on("event", (event) => {
      events.push(event as { method: string; turnId?: string });
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
    expect(events.filter((event) => event.method === "turn/completed")).toHaveLength(1);
  });

  it("force-stops the session when cancel hangs", async () => {
    vi.useFakeTimers();

    const manager = new KiroAcpManager();
    const session = createTestSession();
    session.rpc.request = vi.fn(async (method: string) => {
      if (method === "session/cancel") {
        return await new Promise(() => undefined);
      }
      return undefined;
    });
    (
      manager as unknown as {
        sessions: Map<string, ReturnType<typeof createTestSession>>;
      }
    ).sessions.set(session.threadId, session);

    const events: Array<{ method: string; payload?: unknown }> = [];
    manager.on("event", (event) => {
      events.push(event as { method: string; payload?: unknown });
    });

    const interruptPromise = manager.interruptTurn(session.threadId);
    await vi.advanceTimersByTimeAsync(10_000);
    await interruptPromise;

    expect(session.process.kill).toHaveBeenCalledTimes(1);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "turn/aborted",
          payload: expect.objectContaining({
            reason: expect.stringContaining("session/cancel"),
          }),
        }),
      ]),
    );
  });
});
