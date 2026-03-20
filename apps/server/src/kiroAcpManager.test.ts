import { afterEach, describe, expect, it, vi } from "vitest";
import { type ProviderSession, ThreadId, TurnId } from "@t3tools/contracts";

import {
  buildKiroAcpArgs,
  formatKiroProcessExitMessage,
  KiroAcpManager,
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
    runtimeMode: "full-access" as ProviderSession["runtimeMode"],
    cwd: undefined,
    createdAt: "2026-03-19T00:00:00.000Z",
    updatedAt: "2026-03-19T00:00:00.000Z",
    status: "ready" as ProviderSession["status"],
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

describe("buildKiroAcpArgs", () => {
  it("enables trust-all for full-access sessions", () => {
    expect(
      buildKiroAcpArgs({
        runtimeMode: "full-access",
        model: "claude-opus-4.6",
      }),
    ).toEqual(["acp", "--model", "claude-opus-4.6", "--trust-all-tools"]);
  });

  it("keeps supervised sessions on Kiro's default permission flow", () => {
    expect(
      buildKiroAcpArgs({
        runtimeMode: "approval-required",
        model: "claude-opus-4.6",
      }),
    ).toEqual(["acp", "--model", "claude-opus-4.6"]);
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

  it("auto-approves permission requests in full-access mode", async () => {
    const manager = new KiroAcpManager();
    const session = createTestSession();
    const events: Array<{ kind?: string; method: string; payload?: unknown; requestId?: string }> =
      [];
    manager.on("event", (event) => {
      events.push(
        event as { kind?: string; method: string; payload?: unknown; requestId?: string },
      );
    });

    await (
      manager as unknown as {
        handleRequest: (
          session: ReturnType<typeof createTestSession>,
          message: {
            jsonrpc: "2.0";
            id: number;
            method: string;
            params: unknown;
          },
        ) => Promise<void>;
      }
    ).handleRequest(session, {
      jsonrpc: "2.0",
      id: 1,
      method: "session/request_permission",
      params: {
        toolCall: {
          toolCallId: "tool-1",
          title: "Running: pwd",
        },
        options: [
          { optionId: "allow_always", kind: "allow_always" },
          { optionId: "allow_once", kind: "allow_once" },
          { optionId: "reject_once", kind: "reject_once" },
        ],
      },
    });

    expect(session.rpc.respond).toHaveBeenCalledWith(1, {
      outcome: {
        outcome: "selected",
        optionId: "allow_always",
      },
    });
    expect(session.pendingPermissionRequests.size).toBe(0);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "request",
          method: "item/requestApproval",
        }),
        expect.objectContaining({
          method: "item/requestApproval/decision",
          payload: expect.objectContaining({
            decision: "acceptForSession",
            autoApproved: true,
          }),
        }),
      ]),
    );
  });

  it("tracks permission requests for supervised sessions", async () => {
    const manager = new KiroAcpManager();
    const session = {
      ...createTestSession(),
      runtimeMode: "approval-required" as const,
    };
    const events: Array<{ kind?: string; method: string; requestId?: string }> = [];
    manager.on("event", (event) => {
      events.push(event as { kind?: string; method: string; requestId?: string });
    });

    await (
      manager as unknown as {
        handleRequest: (
          session: ReturnType<typeof createTestSession>,
          message: {
            jsonrpc: "2.0";
            id: number;
            method: string;
            params: unknown;
          },
        ) => Promise<void>;
      }
    ).handleRequest(session, {
      jsonrpc: "2.0",
      id: 1,
      method: "session/request_permission",
      params: {
        toolCall: {
          toolCallId: "tool-1",
          title: "Running: pwd",
        },
        options: [{ optionId: "allow_once", kind: "allow_once" }],
      },
    });

    expect(session.rpc.respond).not.toHaveBeenCalled();
    expect(session.pendingPermissionRequests.size).toBe(1);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "request",
          method: "item/requestApproval",
        }),
      ]),
    );
  });

  it("rejects unsupported ACP request methods explicitly", async () => {
    const manager = new KiroAcpManager();
    const session = createTestSession();
    const events: Array<{ kind?: string; method: string; message?: string }> = [];
    manager.on("event", (event) => {
      events.push(event as { kind?: string; method: string; message?: string });
    });

    await (
      manager as unknown as {
        handleRequest: (
          session: ReturnType<typeof createTestSession>,
          message: {
            jsonrpc: "2.0";
            id: number;
            method: string;
            params: unknown;
          },
        ) => Promise<void>;
      }
    ).handleRequest(session, {
      jsonrpc: "2.0",
      id: 7,
      method: "session/request_user_input",
      params: {
        prompt: "Choose a default model",
      },
    });

    expect(session.rpc.respond).toHaveBeenCalledWith(7, undefined, {
      code: -32601,
      message: "Unsupported Kiro ACP request method 'session/request_user_input'.",
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "error",
          method: "session/requestUnsupported",
          message: "Unsupported Kiro ACP request method 'session/request_user_input'.",
        }),
      ]),
    );
  });
});
