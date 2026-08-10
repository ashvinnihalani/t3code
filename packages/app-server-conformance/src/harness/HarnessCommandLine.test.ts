import { describe, expect, it } from "@effect/vitest";

import { parseHarnessCommandLine } from "./HarnessCommandLine.ts";

describe("parseHarnessCommandLine", () => {
  it("builds a harness configuration from command-line arguments", () => {
    expect(
      parseHarnessCommandLine(
        [
          "--executable",
          "/opt/harness/bin/server",
          "--arg=app-server",
          "--arg=--stdio",
          "--cwd",
          "/tmp/harness",
          "--workspace",
          "/tmp/project",
          "--env",
          "MODE=test",
          "--timeout-ms",
          "1234",
          "--trace-output",
          "/tmp/trace.json",
        ],
        {},
        "/fallback",
      ),
    ).toEqual({
      kind: "run",
      harness: {
        executable: "/opt/harness/bin/server",
        args: ["app-server", "--stdio"],
        cwd: "/tmp/harness",
        workspace: "/tmp/project",
        environment: { MODE: "test" },
        timeoutMs: 1234,
      },
      traceOutput: "/tmp/trace.json",
    });
  });

  it("supports environment-only harness selection", () => {
    expect(
      parseHarnessCommandLine(
        [],
        {
          T3_APP_SERVER_EXECUTABLE: "/opt/harness/bin/server",
          T3_APP_SERVER_ARGS_JSON: '["serve","--jsonl"]',
          T3_APP_SERVER_ENV_JSON: '{"MODE":"test"}',
          T3_APP_SERVER_TIMEOUT_MS: "9000",
        },
        "/workspace",
      ),
    ).toEqual({
      kind: "run",
      harness: {
        executable: "/opt/harness/bin/server",
        args: ["serve", "--jsonl"],
        cwd: "/workspace",
        workspace: "/workspace",
        environment: { MODE: "test" },
        timeoutMs: 9000,
      },
    });
  });

  it("accepts the argument separator forwarded by package scripts", () => {
    const command = parseHarnessCommandLine(
      ["--", "--executable", "/opt/harness/bin/server"],
      {},
      "/workspace",
    );

    expect(command).toMatchObject({
      kind: "run",
      harness: { executable: "/opt/harness/bin/server" },
    });
  });

  it("rejects invalid executable environment", () => {
    expect(() => parseHarnessCommandLine([], {}, "/workspace")).toThrow(
      "An app-server executable is required",
    );
  });
});
