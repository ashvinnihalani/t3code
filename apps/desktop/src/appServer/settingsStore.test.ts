import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { defaultAppServerDesktopSettings } from "./configuration.ts";
import { makeAppServerSettingsStore } from "./settingsStore.ts";

describe("app-server settings store", () => {
  it.effect("falls back to defaults and persists validated connection profiles", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-codex-settings-",
      });
      const store = makeAppServerSettingsStore({
        fileSystem,
        path,
        settingsPath: path.join(directory, "app-server-settings.json"),
        defaults: defaultAppServerDesktopSettings({}, "/default-workspace"),
      });

      assert.strictEqual((yield* store.read).connections[0]?.id, "local");
      const saved = {
        connections: [
          {
            id: "local",
            name: "Local",
            connection: {
              kind: "local" as const,
              executable: "codex",
              args: ["app-server"],
              workspace: "/default-workspace",
              env: {},
            },
          },
          {
            id: "build-box",
            name: "Build box",
            connection: {
              kind: "ssh" as const,
              host: "build-box",
              username: "",
              port: null,
              identityFile: "",
              executable: "codex",
              args: ["app-server"],
              workspace: "/work/project",
              env: {},
            },
          },
        ],
      };
      assert.deepEqual(yield* store.write(saved), saved);
      assert.deepEqual(yield* store.read, saved);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});
