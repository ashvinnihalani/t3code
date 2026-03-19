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

  it("supports worktree env for remote projects", () => {
    expect(
      supportsDraftWorktreeEnv({
        projectRemote: {
          kind: "ssh",
          hostAlias: "buildbox",
        },
      }),
    ).toBe(true);
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

  it("keeps remote worktree requests intact", () => {
    expect(
      resolveRequestedThreadEnvMode({
        projectRemote: {
          kind: "ssh",
          hostAlias: "buildbox",
        },
        requestedEnvMode: "worktree",
      }),
    ).toBe("worktree");
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

  it("keeps remote draft worktree mode before worktree creation", () => {
    expect(
      resolveEffectiveThreadEnvMode({
        projectRemote: {
          kind: "ssh",
          hostAlias: "buildbox",
        },
        draftThreadEnvMode: "worktree",
        worktreePath: null,
      }),
    ).toBe("worktree");
  });
});
