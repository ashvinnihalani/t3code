import * as NodeFS from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

import { makeAppServerSettingsStore } from "./settingsStore.ts";

describe("app-server settings store", () => {
  it("falls back to launch defaults and persists validated settings", async () => {
    const directory = await NodeFS.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-codex-settings-"));
    try {
      const store = makeAppServerSettingsStore(directory, {}, "/default-workspace");
      expect(await store.read()).toEqual({
        connections: [
          {
            id: "local",
            name: "Local",
            connection: {
              kind: "local",
              executable: "codex",
              args: ["app-server"],
              workspace: "/default-workspace",
              env: {},
            },
          },
        ],
      });

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
      await store.write(saved);
      expect(await store.read()).toEqual(saved);
    } finally {
      await NodeFS.rm(directory, { recursive: true });
    }
  });

  it("migrates legacy settings when they are read", async () => {
    const directory = await NodeFS.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-codex-settings-"));
    try {
      await NodeFS.writeFile(
        NodePath.join(directory, "app-server-settings.json"),
        JSON.stringify({
          connection: {
            kind: "ssh",
            host: "legacy-host",
            username: "",
            port: null,
            identityFile: "",
            executable: "codex",
            args: ["app-server"],
            workspace: "/legacy",
            env: {},
          },
        }),
      );
      const store = makeAppServerSettingsStore(directory, {}, "/default-workspace");
      expect(await store.read()).toEqual({
        connections: [
          {
            id: "local",
            name: "Local",
            connection: {
              kind: "local",
              executable: "codex",
              args: ["app-server"],
              workspace: "/legacy",
              env: {},
            },
          },
          {
            id: "ssh-legacy",
            name: "legacy-host",
            connection: {
              kind: "ssh",
              host: "legacy-host",
              username: "",
              port: null,
              identityFile: "",
              executable: "codex",
              args: ["app-server"],
              workspace: "/legacy",
              env: {},
            },
          },
        ],
      });
    } finally {
      await NodeFS.rm(directory, { recursive: true });
    }
  });
});
