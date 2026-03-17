import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildExpiredTerminalContextToastCopy,
  deriveComposerSendState,
  resolveVisibleProviderHealthStatus,
} from "./ChatView.logic";

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
        projectRemote: null,
        session: null,
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
        projectRemote: {
          kind: "ssh",
          hostAlias: "g7e_axe",
        },
        session: null,
      }),
    ).toMatchObject({
      kind: "remote",
      status: "error",
      title: "Remote Codex launcher status",
    });
  });

  it("shows reconnect metadata for disconnected remote sessions", () => {
    expect(
      resolveVisibleProviderHealthStatus({
        status: {
          provider: "codex",
          status: "ready",
          available: true,
          authStatus: "authenticated",
          checkedAt: "2026-03-16T00:00:00.000Z",
        },
        projectRemote: {
          kind: "ssh",
          hostAlias: "g7e_axe",
        },
        session: {
          provider: "codex",
          status: "closed",
          orchestrationStatus: "stopped",
          providerThreadId: "thread_remote_123",
          resumeAvailable: true,
          createdAt: "2026-03-16T00:00:00.000Z",
          updatedAt: "2026-03-16T00:00:00.000Z",
        },
      }),
    ).toMatchObject({
      kind: "remote",
      status: "warning",
      message: "Resume is available for provider thread thread_remote_123.",
    });
  });
});
