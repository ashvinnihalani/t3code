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
      }),
    ).toMatchObject({
      provider: "codex",
      status: "error",
    });
  });

  it("hides local provider health for remote SSH projects", () => {
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
      }),
    ).toBeNull();
  });
});
