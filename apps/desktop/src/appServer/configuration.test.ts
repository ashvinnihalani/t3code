import { describe, expect, it } from "vite-plus/test";

import {
  AppServerConfigurationError,
  buildRemoteAppServerCommand,
  defaultAppServerDesktopSettings,
  parseAppServerDesktopSettings,
  resolveConfiguredAppServerProcess,
  shellQuote,
} from "./configuration.ts";

describe("app-server desktop configuration", () => {
  it("creates a local codex app-server profile by default", () => {
    expect(defaultAppServerDesktopSettings({}, "/workspace")).toEqual({
      connections: [
        {
          id: "local",
          name: "Local",
          connection: {
            kind: "local",
            executable: "codex",
            args: ["app-server"],
            workspace: "/workspace",
            env: {},
          },
        },
      ],
    });
  });

  it("requires one canonical local connection and unique ids", () => {
    expect(() => parseAppServerDesktopSettings({ connections: [] })).toThrow(
      AppServerConfigurationError,
    );
    expect(() =>
      parseAppServerDesktopSettings({
        connections: [
          {
            id: "remote",
            name: "Remote",
            connection: {
              kind: "ssh",
              host: "buildbox",
              username: "",
              port: null,
              identityFile: "",
              executable: "codex",
              args: ["app-server"],
              workspace: "/repo",
              env: {},
            },
          },
        ],
      }),
    ).toThrow(/local app-server connection/);
  });

  it("adds common desktop executable paths for local launches", () => {
    const configuration = resolveConfiguredAppServerProcess(
      {
        kind: "local",
        executable: "codex",
        args: ["app-server"],
        workspace: "/repo",
        env: {},
      },
      { HOME: "/Users/test", PATH: "/usr/bin" },
      "/Users/test",
      "darwin",
    );
    expect(configuration).toMatchObject({
      executable: "codex",
      args: ["app-server"],
      cwd: "/repo",
    });
    expect(configuration.env.PATH).toContain("/opt/homebrew/bin");
    expect(configuration.env.PATH).toContain("/Users/test/.local/bin");
  });

  it("builds a non-interactive SSH stdio launch", () => {
    const connection = {
      kind: "ssh" as const,
      host: "buildbox",
      username: "dev",
      port: 2222,
      identityFile: "/keys/id test",
      executable: "codex",
      args: ["app-server"],
      workspace: "/repo with spaces",
      env: { RUST_LOG: "info" },
    };
    const configuration = resolveConfiguredAppServerProcess(
      connection,
      { PATH: "/usr/bin" },
      "/tmp",
      "darwin",
    );
    expect(configuration.executable).toBe("ssh");
    expect(configuration.args).toContain("BatchMode=yes");
    expect(configuration.args).toContain("dev@buildbox");
    expect(configuration.args).toContain("2222");
    expect(configuration.args.at(-1)).toBe(buildRemoteAppServerCommand(connection));
  });

  it("quotes remote shell values without interpolation", () => {
    expect(shellQuote("it's safe")).toBe("'it'\"'\"'s safe'");
  });
});
