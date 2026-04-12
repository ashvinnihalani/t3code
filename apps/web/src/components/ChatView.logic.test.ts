import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildExpiredTerminalContextToastCopy,
  deriveComposerSendState,
  resolveVisibleProviderHealthStatus,
  resolveVisibleProviderThreadId,
  resolveVisibleThreadError,
} from "./ChatView.logic";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "../types";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    modelSelection: {
      provider: "codex",
      model: "gpt-5-codex",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-16T00:00:00.000Z",
    latestTurn: null,
    projectPath: "/tmp/project",
    branch: [null],
    worktreePath: [null],
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

describe("resolveVisibleProviderHealthStatus", () => {
  it("keeps provider health visible for local projects", () => {
    expect(
      resolveVisibleProviderHealthStatus({
        status: {
          provider: "codex",
          status: "error",
          available: false,
          authStatus: "unknown",
          checkedAt: "2026-03-16T00:00:00.000Z",
          message: "Codex CLI v0.27.0 is too old for T3 Code.",
        },
        projectHost: undefined,
        session: null,
        localCodexErrorsDismissedAfter: null,
      }),
    ).toMatchObject({
      kind: "local",
      status: {
        provider: "codex",
        status: "error",
      },
    });
  });

  it("shows launcher health for remote SSH projects before a session starts", () => {
    expect(
      resolveVisibleProviderHealthStatus({
        status: {
          provider: "codex",
          status: "error",
          available: false,
          authStatus: "unknown",
          checkedAt: "2026-03-16T00:00:00.000Z",
          message: "Codex CLI v0.27.0 is too old for T3 Code.",
        },
        projectHost: {
          kind: "ssh",
          hostAlias: "g7e_axe",
        },
        session: null,
        localCodexErrorsDismissedAfter: "2026-03-16T01:00:00.000Z",
      }),
    ).toMatchObject({
      kind: "remote",
      status: "error",
      title: "Remote Codex launcher status",
    });
  });

  it("suppresses background reconnect and disconnected remote status banners", () => {
    expect(
      resolveVisibleProviderHealthStatus({
        status: {
          provider: "codex",
          status: "ready",
          available: true,
          authStatus: "authenticated",
          checkedAt: "2026-03-16T00:00:00.000Z",
        },
        projectHost: {
          kind: "ssh",
          hostAlias: "g7e_axe",
        },
        session: {
          provider: "codex",
          status: "disconnected",
          orchestrationStatus: "disconnected",
          providerThreadId: "thread_remote_123",
          resumeAvailable: true,
          createdAt: "2026-03-16T00:00:00.000Z",
          updatedAt: "2026-03-16T00:00:00.000Z",
        },
        localCodexErrorsDismissedAfter: "2026-03-16T01:00:00.000Z",
      }),
    ).toBeNull();
  });

  it("hides dismissed local Codex provider health until a newer status arrives", () => {
    expect(
      resolveVisibleProviderHealthStatus({
        status: {
          provider: "codex",
          status: "error",
          available: false,
          authStatus: "unknown",
          checkedAt: "2026-03-16T00:00:00.000Z",
          message: "Codex CLI is missing.",
        },
        projectHost: undefined,
        session: null,
        localCodexErrorsDismissedAfter: "2026-03-16T00:00:00.000Z",
      }),
    ).toBeNull();

    expect(
      resolveVisibleProviderHealthStatus({
        status: {
          provider: "codex",
          status: "error",
          available: false,
          authStatus: "unknown",
          checkedAt: "2026-03-16T00:00:01.000Z",
          message: "Codex CLI is still missing.",
        },
        projectHost: undefined,
        session: null,
        localCodexErrorsDismissedAfter: "2026-03-16T00:00:00.000Z",
      }),
    ).toMatchObject({
      kind: "local",
      status: {
        status: "error",
      },
    });
  });

  it("suppresses remote stop-and-reconnect summaries even if they arrive on the error path", () => {
    expect(
      resolveVisibleProviderHealthStatus({
        status: {
          provider: "codex",
          status: "ready",
          available: true,
          authStatus: "authenticated",
          checkedAt: "2026-03-16T00:00:00.000Z",
        },
        projectHost: {
          kind: "ssh",
          hostAlias: "g7e_axe",
        },
        session: {
          provider: "codex",
          status: "error",
          orchestrationStatus: "error",
          lastError: "The provider service stopped and can reconnect on the next turn.",
          createdAt: "2026-03-16T00:00:00.000Z",
          updatedAt: "2026-03-16T00:00:00.000Z",
        },
        localCodexErrorsDismissedAfter: null,
      }),
    ).toBeNull();
  });
});

describe("resolveVisibleProviderThreadId", () => {
  it("prefers the current session provider thread id", () => {
    expect(
      resolveVisibleProviderThreadId(
        makeThread({
          codexThreadId: "legacy-thread-id",
          session: {
            provider: "codex",
            status: "ready",
            orchestrationStatus: "ready",
            providerThreadId: "provider-thread-123",
            createdAt: "2026-03-16T00:00:00.000Z",
            updatedAt: "2026-03-16T00:00:00.000Z",
          },
        }),
      ),
    ).toBe("provider-thread-123");
  });

  it("falls back to the legacy thread id when no session thread id exists", () => {
    expect(
      resolveVisibleProviderThreadId(
        makeThread({
          codexThreadId: "legacy-thread-id",
        }),
      ),
    ).toBe("legacy-thread-id");
  });

  it("returns null when no visible provider thread id exists", () => {
    expect(resolveVisibleProviderThreadId(makeThread())).toBeNull();
  });
});

describe("resolveVisibleThreadError", () => {
  it("hides stale local Codex session errors after dismissal", () => {
    expect(
      resolveVisibleThreadError({
        thread: makeThread({
          error: "Codex CLI is not installed.",
          session: {
            provider: "codex",
            status: "error",
            orchestrationStatus: "error",
            lastError: "Codex CLI is not installed.",
            createdAt: "2026-03-16T00:00:00.000Z",
            updatedAt: "2026-03-16T00:00:00.000Z",
          },
        }),
        projectHost: undefined,
        localCodexErrorsDismissedAfter: "2026-03-16T00:00:00.000Z",
      }),
    ).toBeNull();
  });

  it("keeps newer local Codex session errors visible after dismissal", () => {
    expect(
      resolveVisibleThreadError({
        thread: makeThread({
          error: "Codex CLI is not installed.",
          session: {
            provider: "codex",
            status: "error",
            orchestrationStatus: "error",
            lastError: "Codex CLI is not installed.",
            createdAt: "2026-03-16T00:00:00.000Z",
            updatedAt: "2026-03-16T00:00:01.000Z",
          },
        }),
        projectHost: undefined,
        localCodexErrorsDismissedAfter: "2026-03-16T00:00:00.000Z",
      }),
    ).toBe("Codex CLI is not installed.");
  });

  it("does not hide remote thread errors on settings dismissal", () => {
    expect(
      resolveVisibleThreadError({
        thread: makeThread({
          error: "Remote Codex session failed.",
          session: {
            provider: "codex",
            status: "error",
            orchestrationStatus: "error",
            lastError: "Remote Codex session failed.",
            createdAt: "2026-03-16T00:00:00.000Z",
            updatedAt: "2026-03-16T00:00:00.000Z",
          },
        }),
        projectHost: {
          kind: "ssh",
          hostAlias: "g7e_axe",
        },
        localCodexErrorsDismissedAfter: "2026-03-16T00:00:00.000Z",
      }),
    ).toBe("Remote Codex session failed.");
  });

  it("suppresses remote thread-management summaries in the thread error channel", () => {
    expect(
      resolveVisibleThreadError({
        thread: makeThread({
          error: "The provider service stopped and can reconnect on the next turn.",
          session: {
            provider: "codex",
            status: "closed",
            orchestrationStatus: "stopped",
            createdAt: "2026-03-16T00:00:00.000Z",
            updatedAt: "2026-03-16T00:00:00.000Z",
          },
        }),
        projectHost: {
          kind: "ssh",
          hostAlias: "g7e_axe",
        },
        localCodexErrorsDismissedAfter: null,
      }),
    ).toBeNull();
  });

  it("does not hide unrelated local UI errors", () => {
    expect(
      resolveVisibleThreadError({
        thread: makeThread({
          error: "You can attach up to 20 images per message.",
          session: {
            provider: "codex",
            status: "ready",
            orchestrationStatus: "ready",
            lastError: "Different provider error",
            createdAt: "2026-03-16T00:00:00.000Z",
            updatedAt: "2026-03-16T00:00:00.000Z",
          },
        }),
        projectHost: undefined,
        localCodexErrorsDismissedAfter: "2026-03-16T00:00:00.000Z",
      }),
    ).toBe("You can attach up to 20 images per message.");
  });
});

describe("deriveComposerSendState", () => {
  it("treats expired terminal pills as non-sendable content", () => {
    const state = deriveComposerSendState({
      prompt: "\uFFFC",
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId: ThreadId.makeUnsafe("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("");
    expect(state.sendableTerminalContexts).toEqual([]);
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(false);
  });

  it("keeps text sendable while excluding expired terminal pills", () => {
    const state = deriveComposerSendState({
      prompt: `yoo \uFFFC waddup`,
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId: ThreadId.makeUnsafe("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("yoo  waddup");
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(true);
  });
});

describe("buildExpiredTerminalContextToastCopy", () => {
  it("formats clear empty-state guidance", () => {
    expect(buildExpiredTerminalContextToastCopy(1, "empty")).toEqual({
      title: "Expired terminal context won't be sent",
      description: "Remove it or re-add it to include terminal output.",
    });
  });

  it("formats omission guidance for sent messages", () => {
    expect(buildExpiredTerminalContextToastCopy(2, "omitted")).toEqual({
      title: "Expired terminal contexts omitted from message",
      description: "Re-add it if you want that terminal output included.",
    });
  });
});
