import { describe, expect, it } from "@effect/vitest";

import {
  AppServerConfigurationError,
  buildRemoteAppServerCommand,
  resolveConfiguredAppServerProcess,
  resolveAppServerProcessConfiguration,
} from "./configuration.ts";

describe("resolveAppServerProcessConfiguration", () => {
  it("defaults to a managed Codex app-server process", () => {
    expect(resolveAppServerProcessConfiguration({}, "/workspace")).toEqual({
      executable: "codex",
      args: ["app-server"],
      cwd: "/workspace",
      env: {},
    });
  });

  it("launches a remote app-server through OpenSSH stdio", () => {
    const connection = {
      kind: "ssh" as const,
      host: "build-box",
      username: "agent",
      port: 2222,
      identityFile: "/keys/work identity",
      executable: "/opt/codex/bin/codex",
      args: ["app-server", "--stdio"],
      workspace: "/work/project with spaces",
      env: { HARNESS_MODE: "remote" },
    };
    expect(buildRemoteAppServerCommand(connection)).toBe(
      "cd -- '/work/project with spaces' && exec env 'HARNESS_MODE=remote' '/opt/codex/bin/codex' 'app-server' '--stdio'",
    );
    expect(
      resolveConfiguredAppServerProcess({ connection }, { PATH: "/usr/bin" }, "/local", "darwin"),
    ).toEqual({
      executable: "ssh",
      args: [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-i",
        "/keys/work identity",
        "-p",
        "2222",
        "agent@build-box",
        "cd -- '/work/project with spaces' && exec env 'HARNESS_MODE=remote' '/opt/codex/bin/codex' 'app-server' '--stdio'",
      ],
      cwd: "/local",
      env: { PATH: "/usr/bin" },
    });
  });

  it("shell-quotes remote launch values", () => {
    expect(
      buildRemoteAppServerCommand({
        kind: "ssh",
        host: "host",
        username: "",
        port: null,
        identityFile: "",
        executable: "codex'preview",
        args: ["app-server"],
        workspace: "/work/user's project",
        env: {},
      }),
    ).toBe(`cd -- '/work/user'"'"'s project' && exec 'codex'"'"'preview' 'app-server'`);
  });

  it("accepts a generic executable, arguments, environment, and workspace", () => {
    expect(
      resolveAppServerProcessConfiguration(
        {
          EXISTING: "preserved",
          T3CODE_APP_SERVER_EXECUTABLE: "generic-harness",
          T3CODE_APP_SERVER_ARGS: '["serve","--stdio"]',
          T3CODE_APP_SERVER_ENV: '{"HARNESS_MODE":"test"}',
          T3CODE_APP_SERVER_WORKSPACE: "/project",
        },
        "/workspace",
      ),
    ).toEqual({
      executable: "generic-harness",
      args: ["serve", "--stdio"],
      cwd: "/project",
      env: {
        EXISTING: "preserved",
        HARNESS_MODE: "test",
        T3CODE_APP_SERVER_ARGS: '["serve","--stdio"]',
        T3CODE_APP_SERVER_ENV: '{"HARNESS_MODE":"test"}',
        T3CODE_APP_SERVER_EXECUTABLE: "generic-harness",
        T3CODE_APP_SERVER_WORKSPACE: "/project",
      },
    });
  });

  it("rejects malformed process configuration", () => {
    expect(() =>
      resolveAppServerProcessConfiguration({ T3CODE_APP_SERVER_ARGS: "app-server" }, "/workspace"),
    ).toThrow(AppServerConfigurationError);
    expect(() =>
      resolveAppServerProcessConfiguration({ T3CODE_APP_SERVER_ENV: '{"PORT":42}' }, "/workspace"),
    ).toThrow(AppServerConfigurationError);
  });
});
