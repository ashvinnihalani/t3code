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

  it("builds a non-interactive SSH proxy to a durable Codex daemon", () => {
    const connection = {
      kind: "ssh" as const,
      host: "buildbox",
      username: "dev",
      port: 2222,
      identityFile: "/keys/id test",
      persistent: true,
      executable: "/opt/custom/codex-dev",
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
    expect(configuration.args.at(-1)).toContain(
      "configured_executable=$(env 'RUST_LOG=info' sh -c 'command -v \"$1\"' sh '/opt/custom/codex-dev')",
    );
    expect(configuration.args.at(-1)).toContain(
      'ln -s -- "$configured_executable" "$managed_executable"',
    );
    expect(configuration.args.at(-1)).toContain(
      "env 'RUST_LOG=info' \"$managed_executable\" 'app-server' 'daemon' 'enable-remote-control' >/dev/null",
    );
    expect(configuration.args.at(-1)).toContain(
      "env 'RUST_LOG=info' \"$managed_executable\" 'app-server' 'daemon' 'start' >/dev/null",
    );
    expect(configuration.args.at(-1)).toContain(
      "exec env 'RUST_LOG=info' \"$managed_executable\" 'app-server' 'proxy'",
    );
  });

  it("uses the configured remote CODEX_HOME for the custom daemon link", () => {
    const command = buildRemoteAppServerCommand({
      kind: "ssh",
      host: "buildbox",
      username: "",
      port: null,
      identityFile: "",
      persistent: true,
      executable: "custom-codex",
      args: ["app-server"],
      workspace: "/repo",
      env: { CODEX_HOME: "/state/codex home", PATH: "/custom/bin:/usr/bin" },
    });
    expect(command).toContain("codex_home='/state/codex home'");
    expect(command).toContain(
      "configured_executable=$(env 'CODEX_HOME=/state/codex home' 'PATH=/custom/bin:/usr/bin' sh",
    );
    expect(command).not.toContain("daemon' 'bootstrap");
  });

  it("runs the exact configured SSH command when persistence is disabled", () => {
    expect(
      buildRemoteAppServerCommand({
        kind: "ssh",
        host: "buildbox",
        username: "",
        port: null,
        identityFile: "",
        persistent: false,
        executable: "/opt/custom/codex-dev",
        args: ["app-server"],
        workspace: "/repo",
        env: { CODEX_HOME: "/state/codex" },
      }),
    ).toBe(
      "cd -- '/repo' && exec env 'CODEX_HOME=/state/codex' '/opt/custom/codex-dev' 'app-server'",
    );
  });

  it("keeps generic app-server harnesses on their configured SSH stdio command", () => {
    expect(
      buildRemoteAppServerCommand({
        kind: "ssh",
        host: "buildbox",
        username: "",
        port: null,
        identityFile: "",
        executable: "generic-agent",
        args: ["serve", "--stdio"],
        workspace: "/repo",
        env: {},
      }),
    ).toBe("cd -- '/repo' && exec 'generic-agent' 'serve' '--stdio'");
  });

  it("quotes remote shell values without interpolation", () => {
    expect(shellQuote("it's safe")).toBe("'it'\"'\"'s safe'");
  });
});
