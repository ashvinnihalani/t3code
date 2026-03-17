import { describe, expect, it } from "vitest";
import {
  resolveEffectiveThreadEnvMode,
  resolveRequestedThreadEnvMode,
  supportsDraftWorktreeEnv,
} from "./threadEnvMode";

describe("supportsDraftWorktreeEnv", () => {
  it("supports worktree env for local projects", () => {
    expect(supportsDraftWorktreeEnv({ projectRemote: null })).toBe(true);
  });

  it("disables worktree env for remote projects", () => {
    expect(
      supportsDraftWorktreeEnv({
        projectRemote: {
          kind: "ssh",
          hostAlias: "buildbox",
        },
      }),
    ).toBe(false);
  });
});

describe("resolveRequestedThreadEnvMode", () => {
  it("keeps worktree mode for local projects", () => {
    expect(
      resolveRequestedThreadEnvMode({
        projectRemote: null,
        requestedEnvMode: "worktree",
      }),
    ).toBe("worktree");
  });

  it("forces remote worktree requests back to local", () => {
    expect(
      resolveRequestedThreadEnvMode({
        projectRemote: {
          kind: "ssh",
          hostAlias: "buildbox",
        },
        requestedEnvMode: "worktree",
      }),
    ).toBe("local");
  });
});

describe("resolveEffectiveThreadEnvMode", () => {
  it("prefers an actual worktree path over the requested env mode", () => {
    expect(
      resolveEffectiveThreadEnvMode({
        projectRemote: {
          kind: "ssh",
          hostAlias: "buildbox",
        },
        draftThreadEnvMode: "local",
        worktreePath: "/remote/repo/.t3/worktrees/feature-a",
      }),
    ).toBe("worktree");
  });

  it("normalizes stale remote draft worktree mode without a worktree path back to local", () => {
    expect(
      resolveEffectiveThreadEnvMode({
        projectRemote: {
          kind: "ssh",
          hostAlias: "buildbox",
        },
        draftThreadEnvMode: "worktree",
        worktreePath: null,
      }),
    ).toBe("local");
  });
});
