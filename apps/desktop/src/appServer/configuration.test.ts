import { describe, expect, it } from "@effect/vitest";

import {
  AppServerConfigurationError,
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
