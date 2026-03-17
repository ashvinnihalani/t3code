import { describe, expect, it } from "vitest";

import { resolveVisibleProviderHealthStatus } from "./ChatView.logic";

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
