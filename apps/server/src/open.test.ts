import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { assertSuccess } from "@effect/vitest/utils";
import { FileSystem, Path, Effect } from "effect";

import {
  isCommandAvailable,
  launchDetached,
  resolveAvailableEditors,
  resolveEditorLaunch,
} from "./open";

it.layer(NodeServices.layer)("resolveEditorLaunch", (it) => {
  it.effect("returns commands for command-based editors", () =>
    Effect.gen(function* () {
      const antigravityLaunch = yield* resolveEditorLaunch(
        { target: "/tmp/workspace", editor: "antigravity" },
        "darwin",
      );
      assert.deepEqual(antigravityLaunch, {
        command: "agy",
        args: ["/tmp/workspace"],
      });

      const cursorLaunch = yield* resolveEditorLaunch(
        { target: "/tmp/workspace", editor: "cursor" },
        "darwin",
      );
      assert.deepEqual(cursorLaunch, {
        command: "cursor",
        args: ["/tmp/workspace"],
      });

      const traeLaunch = yield* resolveEditorLaunch(
        { target: "/tmp/workspace", editor: "trae" },
        "darwin",
      );
      assert.deepEqual(traeLaunch, {
        command: "trae",
        args: ["/tmp/workspace"],
      });

      const vscodeLaunch = yield* resolveEditorLaunch(
        { target: "/tmp/workspace", editor: "vscode" },
        "darwin",
      );
      assert.deepEqual(vscodeLaunch, {
        command: "code",
        args: ["/tmp/workspace"],
      });

      const vscodeInsidersLaunch = yield* resolveEditorLaunch(
        { target: "/tmp/workspace", editor: "vscode-insiders" },
        "darwin",
      );
      assert.deepEqual(vscodeInsidersLaunch, {
        command: "code-insiders",
        args: ["/tmp/workspace"],
      });

      const vscodiumLaunch = yield* resolveEditorLaunch(
        { target: "/tmp/workspace", editor: "vscodium" },
        "darwin",
      );
      assert.deepEqual(vscodiumLaunch, {
        command: "codium",
        args: ["/tmp/workspace"],
      });

      const zedLaunch = yield* resolveEditorLaunch(
        { target: "/tmp/workspace", editor: "zed" },
        "darwin",
      );
      assert.deepEqual(zedLaunch, {
        command: "zed",
        args: ["/tmp/workspace"],
      });

      const ideaLaunch = yield* resolveEditorLaunch(
        { target: "/tmp/workspace", editor: "idea" },
        "darwin",
      );
      assert.deepEqual(ideaLaunch, {
        command: "idea",
        args: ["/tmp/workspace"],
      });
    }),
  );

  it.effect("applies launch-style-specific navigation arguments", () =>
    Effect.gen(function* () {
      const lineOnly = yield* resolveEditorLaunch(
        { target: "/tmp/workspace/AGENTS.md:48", editor: "cursor" },
        "darwin",
      );
      assert.deepEqual(lineOnly, {
        command: "cursor",
        args: ["--goto", "/tmp/workspace/AGENTS.md:48"],
      });

      const lineAndColumn = yield* resolveEditorLaunch(
        { target: "/tmp/workspace/src/open.ts:71:5", editor: "cursor" },
        "darwin",
      );
      assert.deepEqual(lineAndColumn, {
        command: "cursor",
        args: ["--goto", "/tmp/workspace/src/open.ts:71:5"],
      });

      const traeLineAndColumn = yield* resolveEditorLaunch(
        { target: "/tmp/workspace/src/open.ts:71:5", editor: "trae" },
        "darwin",
      );
      assert.deepEqual(traeLineAndColumn, {
        command: "trae",
        args: ["--goto", "/tmp/workspace/src/open.ts:71:5"],
      });

      const vscodeLineAndColumn = yield* resolveEditorLaunch(
        { target: "/tmp/workspace/src/open.ts:71:5", editor: "vscode" },
        "darwin",
      );
      assert.deepEqual(vscodeLineAndColumn, {
        command: "code",
        args: ["--goto", "/tmp/workspace/src/open.ts:71:5"],
      });

      const vscodeInsidersLineAndColumn = yield* resolveEditorLaunch(
        { target: "/tmp/workspace/src/open.ts:71:5", editor: "vscode-insiders" },
        "darwin",
      );
      assert.deepEqual(vscodeInsidersLineAndColumn, {
        command: "code-insiders",
        args: ["--goto", "/tmp/workspace/src/open.ts:71:5"],
      });

      const vscodiumLineAndColumn = yield* resolveEditorLaunch(
        { target: "/tmp/workspace/src/open.ts:71:5", editor: "vscodium" },
        "darwin",
      );
      assert.deepEqual(vscodiumLineAndColumn, {
        command: "codium",
        args: ["--goto", "/tmp/workspace/src/open.ts:71:5"],
      });

      const antigravityLineAndColumn = yield* resolveEditorLaunch(
        { target: "/tmp/workspace/src/open.ts:71:5", editor: "antigravity" },
        "darwin",
      );
      assert.deepEqual(antigravityLineAndColumn, {
        command: "agy",
        args: ["--goto", "/tmp/workspace/src/open.ts:71:5"],
      });

      const zedLineAndColumn = yield* resolveEditorLaunch(
        { target: "/tmp/workspace/src/open.ts:71:5", editor: "zed" },
        "darwin",
      );
      assert.deepEqual(zedLineAndColumn, {
        command: "zed",
        args: ["/tmp/workspace/src/open.ts:71:5"],
      });

      const zedLineOnly = yield* resolveEditorLaunch(
        { target: "/tmp/workspace/AGENTS.md:48", editor: "zed" },
        "darwin",
      );
      assert.deepEqual(zedLineOnly, {
        command: "zed",
        args: ["/tmp/workspace/AGENTS.md:48"],
      });

      const ideaLineOnly = yield* resolveEditorLaunch(
        { target: "/tmp/workspace/AGENTS.md:48", editor: "idea" },
        "darwin",
      );
      assert.deepEqual(ideaLineOnly, {
        command: "idea",
        args: ["--line", "48", "/tmp/workspace/AGENTS.md"],
      });

      const ideaLineAndColumn = yield* resolveEditorLaunch(
        { target: "/tmp/workspace/src/open.ts:71:5", editor: "idea" },
        "darwin",
      );
      assert.deepEqual(ideaLineAndColumn, {
        command: "idea",
        args: ["--line", "71", "--column", "5", "/tmp/workspace/src/open.ts"],
      });
    }),
  );

  it.effect("maps file-manager editor to OS open commands", () =>
    Effect.gen(function* () {
      const launch1 = yield* resolveEditorLaunch(
        { target: "/tmp/workspace", editor: "file-manager" },
        "darwin",
      );
      assert.deepEqual(launch1, {
        command: "open",
        args: ["/tmp/workspace"],
      });

      const launch2 = yield* resolveEditorLaunch(
        { target: "C:\\workspace", editor: "file-manager" },
        "win32",
      );
      assert.deepEqual(launch2, {
        command: "explorer",
        args: ["C:\\workspace"],
      });

      const launch3 = yield* resolveEditorLaunch(
        { target: "/tmp/workspace", editor: "file-manager" },
        "linux",
      );
      assert.deepEqual(launch3, {
        command: "xdg-open",
        args: ["/tmp/workspace"],
      });
    }),
  );

  it.effect("rejects remote SSH targets for file-manager", () =>
    Effect.gen(function* () {
      const result = yield* resolveEditorLaunch(
        { target: "ssh://alice@example.com/workspace", editor: "file-manager" },
        "darwin",
      ).pipe(Effect.result);
      assert.equal(result._tag, "Failure");
    }),
  );

  it.effect("maps remote SSH folders for VS Code compatible editors", () =>
    Effect.gen(function* () {
      const cursorLaunch = yield* resolveEditorLaunch(
        {
          target: {
            kind: "remote-ssh",
            hostAlias: "prod",
            path: "/srv/app",
            isDirectory: true,
          },
          editor: "cursor",
        },
        "darwin",
      );
      assert.deepEqual(cursorLaunch, {
        command: "cursor",
        args: ["--remote", "ssh-remote+prod", "/srv/app/"],
      });

      const vscodeLaunch = yield* resolveEditorLaunch(
        {
          target: {
            kind: "remote-ssh",
            hostAlias: "prod",
            path: "/srv/app",
            isDirectory: true,
          },
          editor: "vscode",
        },
        "darwin",
      );
      assert.deepEqual(vscodeLaunch, {
        command: "code",
        args: ["--remote", "ssh-remote+prod", "/srv/app/"],
      });
    }),
  );

  it.effect("maps remote SSH files for supported editors", () =>
    Effect.gen(function* () {
      const cursorLaunch = yield* resolveEditorLaunch(
        {
          target: {
            kind: "remote-ssh",
            hostAlias: "prod",
            path: "/srv/app/src/main.ts",
            isDirectory: false,
            line: 12,
            column: 3,
          },
          editor: "cursor",
        },
        "darwin",
      );
      assert.deepEqual(cursorLaunch, {
        command: "cursor",
        args: ["--remote", "ssh-remote+prod", "--goto", "/srv/app/src/main.ts:12:3"],
      });

      const zedLaunch = yield* resolveEditorLaunch(
        {
          target: {
            kind: "remote-ssh",
            hostAlias: "prod",
            path: "/srv/app/src/main.ts",
            isDirectory: false,
            line: 12,
            column: 3,
          },
          editor: "zed",
        },
        "darwin",
      );
      assert.deepEqual(zedLaunch, {
        command: "zed",
        args: ["ssh://prod/srv/app/src/main.ts:12:3"],
      });
    }),
  );

  it.effect("rejects unsupported editors for remote SSH targets", () =>
    Effect.gen(function* () {
      const result = yield* resolveEditorLaunch(
        {
          target: {
            kind: "remote-ssh",
            hostAlias: "prod",
            path: "/srv/app",
            isDirectory: true,
          },
          editor: "antigravity",
        },
        "darwin",
      ).pipe(Effect.result);
      assert.equal(result._tag, "Failure");
    }),
  );
});

it.layer(NodeServices.layer)("launchDetached", (it) => {
  it.effect("resolves when command can be spawned", () =>
    Effect.gen(function* () {
      const result = yield* launchDetached({
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
      }).pipe(Effect.result);
      assertSuccess(result, undefined);
    }),
  );

  it.effect("rejects when command does not exist", () =>
    Effect.gen(function* () {
      const result = yield* launchDetached({
        command: `t3code-no-such-command-${Date.now()}`,
        args: [],
      }).pipe(Effect.result);
      assert.equal(result._tag, "Failure");
    }),
  );
});

it.layer(NodeServices.layer)("isCommandAvailable", (it) => {
  it.effect("resolves win32 commands with PATHEXT", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-open-test-" });
      yield* fs.writeFileString(path.join(dir, "code.CMD"), "@echo off\r\n");
      const env = {
        PATH: dir,
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
      } satisfies NodeJS.ProcessEnv;
      assert.equal(isCommandAvailable("code", { platform: "win32", env }), true);
    }),
  );

  it("returns false when a command is not on PATH", () => {
    const env = {
      PATH: "",
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    } satisfies NodeJS.ProcessEnv;
    assert.equal(isCommandAvailable("definitely-not-installed", { platform: "win32", env }), false);
  });

  it.effect("does not treat bare files without executable extension as available on win32", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-open-test-" });
      yield* fs.writeFileString(path.join(dir, "npm"), "echo nope\r\n");
      const env = {
        PATH: dir,
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
      } satisfies NodeJS.ProcessEnv;
      assert.equal(isCommandAvailable("npm", { platform: "win32", env }), false);
    }),
  );

  it.effect("appends PATHEXT for commands with non-executable extensions on win32", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-open-test-" });
      yield* fs.writeFileString(path.join(dir, "my.tool.CMD"), "@echo off\r\n");
      const env = {
        PATH: dir,
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
      } satisfies NodeJS.ProcessEnv;
      assert.equal(isCommandAvailable("my.tool", { platform: "win32", env }), true);
    }),
  );

  it.effect("uses platform-specific PATH delimiter for platform overrides", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const firstDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-open-test-" });
      const secondDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-open-test-" });
      yield* fs.writeFileString(path.join(firstDir, "code.CMD"), "@echo off\r\n");
      yield* fs.writeFileString(path.join(secondDir, "code.CMD"), "MZ");
      const env = {
        PATH: `${firstDir};${secondDir}`,
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
      } satisfies NodeJS.ProcessEnv;
      assert.equal(isCommandAvailable("code", { platform: "win32", env }), true);
    }),
  );
});

it.layer(NodeServices.layer)("resolveAvailableEditors", (it) => {
  it.effect("returns installed editors for command launches", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-editors-" });

      yield* fs.writeFileString(path.join(dir, "cursor.CMD"), "@echo off\r\n");
      yield* fs.writeFileString(path.join(dir, "trae.CMD"), "@echo off\r\n");
      yield* fs.writeFileString(path.join(dir, "code-insiders.CMD"), "@echo off\r\n");
      yield* fs.writeFileString(path.join(dir, "codium.CMD"), "@echo off\r\n");
      yield* fs.writeFileString(path.join(dir, "idea.CMD"), "@echo off\r\n");
      yield* fs.writeFileString(path.join(dir, "explorer.CMD"), "MZ");
      const editors = resolveAvailableEditors("win32", {
        PATH: dir,
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
      });
      assert.deepEqual(editors, [
        "cursor",
        "trae",
        "vscode-insiders",
        "vscodium",
        "idea",
        "file-manager",
      ]);
    }),
  );
});
