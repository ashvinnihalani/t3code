import { describe, expect, it, vi, beforeEach } from "vitest";

const runProcessMock = vi.fn();

vi.mock("../processRunner", () => ({
  runProcess: runProcessMock,
}));

describe("validateRemoteProjectOverSsh", () => {
  beforeEach(() => {
    runProcessMock.mockReset();
  });

  it("parses the canonical remote workspace path and capability probes", async () => {
    runProcessMock.mockResolvedValue({
      stdout: [
        "shell noise before payload\n",
        "__T3_REMOTE_PROJECT_VALIDATE__",
        "/srv/app",
        "app",
        "prod-host",
        "1",
        "/srv/app",
        "1",
        "codex-cli 0.115.0",
        "",
      ].join("\0"),
      stderr: "",
      code: 0,
      signal: null,
      timedOut: false,
    });

    const { validateRemoteProjectOverSsh } = await import("./validateRemoteProject");
    const result = await validateRemoteProjectOverSsh(
      {
        remote: { kind: "ssh", hostAlias: "prod" },
        workspaceRoot: "~/app",
      },
      { localCwd: "/tmp" },
    );

    expect(result).toEqual({
      workspaceRoot: "/srv/app",
      directoryName: "app",
      hostname: "prod-host",
      gitAvailable: true,
      gitRepositoryRoot: "/srv/app",
      codexCliAvailable: true,
      codexCliVersion: "codex-cli 0.115.0",
    });
    expect(runProcessMock).toHaveBeenCalledWith(
      "ssh",
      expect.any(Array),
      expect.objectContaining({
        cwd: "/tmp",
        allowNonZeroExit: true,
      }),
    );
  });

  it("surfaces a clear path-not-found error", async () => {
    runProcessMock.mockResolvedValue({
      stdout: "",
      stderr: "",
      code: 10,
      signal: null,
      timedOut: false,
    });

    const { validateRemoteProjectOverSsh } = await import("./validateRemoteProject");

    await expect(
      validateRemoteProjectOverSsh({
        remote: { kind: "ssh", hostAlias: "prod" },
        workspaceRoot: "/missing/project",
      }),
    ).rejects.toThrow("Remote directory does not exist: prod:/missing/project");
  });

  it("rejects malformed validation output", async () => {
    runProcessMock.mockResolvedValue({
      stdout: "__T3_REMOTE_PROJECT_VALIDATE__\0only-one-field\0",
      stderr: "",
      code: 0,
      signal: null,
      timedOut: false,
    });

    const { validateRemoteProjectOverSsh } = await import("./validateRemoteProject");

    await expect(
      validateRemoteProjectOverSsh({
        remote: { kind: "ssh", hostAlias: "prod" },
        workspaceRoot: "/srv/app",
      }),
    ).rejects.toThrow("Remote validation returned an incomplete response.");
  });
});
