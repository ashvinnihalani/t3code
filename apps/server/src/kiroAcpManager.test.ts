import { describe, expect, it, vi } from "vitest";
import { ThreadId, TurnId } from "@t3tools/contracts";

import {
  extractKiroCommandResultText,
  formatKiroProcessExitMessage,
  KiroAcpManager,
  parseKiroContextWindowSnapshot,
  readKiroTextChunk,
} from "./kiroAcpManager";

type TestSession = {
  threadId: ThreadId;
  process: {
    kill: ReturnType<typeof vi.fn>;
  };
  rpc: {
    request: ReturnType<typeof vi.fn>;
    respond: ReturnType<typeof vi.fn>;
    notify: ReturnType<typeof vi.fn>;
  };
  runtimeMode: "full-access";
  cwd: undefined;
  createdAt: string;
  updatedAt: string;
  status: "ready";
  model: undefined;
  sessionId: string;
  activeTurnId: TurnId | undefined;
  modeState: {
    currentModeId: string | undefined;
    defaultModeId: string | undefined;
    availableModes: Array<{ id: string; name?: string; description?: string }>;
  };
  turns: [];
  pendingPermissionRequests: Map<
    string,
    {
      rpcRequestId: number | string;
      requestId: string;
      toolCallId: string | undefined;
      requestType: string;
      options: Array<{ optionId: string; kind?: string }>;
    }
  >;
  suppressReplay: boolean;
  toolCallKinds: Map<string, string>;
};

function createTestSession(): TestSession {
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
    session.rpc.request = vi.fn(() => Promise.resolve(undefined));
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
      ]),
    );
  });

  it("does not duplicate completion when turn_end arrives before session/prompt resolves", async () => {
    const manager = new KiroAcpManager();
    const session = createTestSession();
    session.activeTurnId = undefined;
    const deferred: { resolve?: (value: unknown) => void } = {};
    session.rpc.request = vi.fn((_method: string, params?: unknown) => {
      const payload = params as { content?: unknown; prompt?: unknown } | undefined;
      expect(payload?.prompt).toBeDefined();
      expect(payload?.content).toBeUndefined();
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
    await Promise.resolve();

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

    expect(String(result.turnId)).toMatch(/^kiro:/);
    expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
  });

  it("maps full-access default turns onto the code mode before prompting", async () => {
    const manager = new KiroAcpManager();
    const session = createTestSession();
    session.modeState = {
      currentModeId: "ask",
      defaultModeId: "ask",
      availableModes: [
        { id: "ask", name: "Ask", description: "Request permission before making any changes" },
        { id: "architect", name: "Architect", description: "Design and plan software systems" },
        { id: "code", name: "Code", description: "Write and modify code with full tool access" },
      ],
    };
    session.rpc.request = vi.fn(async (method: string) => {
      if (method === "session/prompt") {
        return {};
      }
      return null;
    });
    (
      manager as unknown as {
        sessions: Map<string, ReturnType<typeof createTestSession>>;
      }
    ).sessions.set(session.threadId, session);

    await manager.sendTurn({
      threadId: session.threadId,
      input: "hello",
    });

    expect(session.rpc.request).toHaveBeenNthCalledWith(1, "session/set_mode", {
      sessionId: "session-1",
      modeId: "code",
    });
    expect(session.rpc.request).toHaveBeenNthCalledWith(
      2,
      "session/prompt",
      expect.objectContaining({
        sessionId: "session-1",
        prompt: expect.any(Array),
      }),
    );
    expect(session.modeState.currentModeId).toBe("code");
  });

  it("prefers kiro_default over custom current agents for default turns", async () => {
    const manager = new KiroAcpManager();
    const session = createTestSession();
    session.modeState = {
      currentModeId: "amzn-builder",
      defaultModeId: "amzn-builder",
      availableModes: [
        {
          id: "amzn-builder",
          name: "amzn-builder",
          description: "Managed custom builder agent",
        },
        {
          id: "kiro_default",
          name: "kiro_default",
          description: "The default agent for Kiro CLI",
        },
        {
          id: "kiro_planner",
          name: "kiro_planner",
          description: "Specialized planning agent",
        },
      ],
    };
    session.rpc.request = vi.fn(async (method: string) => {
      if (method === "session/prompt") {
        return {};
      }
      return null;
    });
    (
      manager as unknown as {
        sessions: Map<string, ReturnType<typeof createTestSession>>;
      }
    ).sessions.set(session.threadId, session);

    await manager.sendTurn({
      threadId: session.threadId,
      input: "hello",
    });

    expect(session.rpc.request).toHaveBeenNthCalledWith(1, "session/set_mode", {
      sessionId: "session-1",
      modeId: "kiro_default",
    });
    expect(session.rpc.request).toHaveBeenNthCalledWith(
      2,
      "session/prompt",
      expect.objectContaining({
        sessionId: "session-1",
        prompt: expect.any(Array),
      }),
    );
    expect(session.modeState.currentModeId).toBe("kiro_default");
  });

  it("uses tracked tool kinds when Kiro omits the permission request kind", async () => {
    const manager = new KiroAcpManager();
    const session = createTestSession();
    session.toolCallKinds.set("call-1", "execute");
    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    manager.on("event", (event) => {
      events.push(event as { type: string; payload?: Record<string, unknown> });
    });

    await (
      manager as unknown as {
        handleRequest: (
          session: ReturnType<typeof createTestSession>,
          message: { jsonrpc: "2.0"; id: number; method: string; params: unknown },
        ) => Promise<void>;
      }
    ).handleRequest(session, {
      jsonrpc: "2.0",
      id: 1,
      method: "session/request_permission",
      params: {
        toolCall: {
          toolCallId: "call-1",
          title: "Run command",
        },
        options: [{ optionId: "allow", kind: "allow_once" }],
      },
    });

    const requestOpened = events.find((event) => event.type === "request.opened");
    expect(requestOpened?.payload?.requestType).toBe("command_execution_approval");
    expect(session.pendingPermissionRequests.get("kiro:call-1")?.requestType).toBe(
      "command_execution_approval",
    );
  });

  it("preserves the original request type when resolving approvals", async () => {
    const manager = new KiroAcpManager();
    const session = createTestSession();
    session.pendingPermissionRequests.set("kiro:call-1", {
      rpcRequestId: 1,
      requestId: "kiro:call-1",
      toolCallId: "call-1",
      requestType: "command_execution_approval",
      options: [{ optionId: "allow", kind: "allow_once" }],
    });
    (
      manager as unknown as {
        sessions: Map<string, ReturnType<typeof createTestSession>>;
      }
    ).sessions.set(session.threadId, session);
    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    manager.on("event", (event) => {
      events.push(event as { type: string; payload?: Record<string, unknown> });
    });

    await manager.respondToRequest(session.threadId, "kiro:call-1", "accept");

    const requestResolved = events.find((event) => event.type === "request.resolved");
    expect(requestResolved?.payload?.requestType).toBe("command_execution_approval");
    expect(requestResolved?.payload?.decision).toBe("accept");
  });
});
