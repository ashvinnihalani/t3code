import { describe, expect, it } from "@effect/vitest";

import {
  appServerTerminalKey,
  fromSettingsDraft,
  projectAppServerDirectory,
  projectEnvironmentProjects,
  removeProjectFromSnapshot,
  removeThreadFromSnapshot,
  resolveAppServerBrowsePath,
  resolveProjectFilePath,
  toSettingsDraft,
  type EnvironmentState,
} from "./useAppServerController";

const localProfile = {
  id: "local",
  name: "Local",
  connection: {
    kind: "local" as const,
    executable: "codex",
    args: ["app-server"],
    workspace: "/workspace",
    env: {},
  },
};

describe("app-server environment controller", () => {
  it("scopes terminal sessions to their app-server environment", () => {
    expect(appServerTerminalKey("local", { threadId: "thread-1", terminalId: "term-1" })).not.toBe(
      appServerTerminalKey("build-box", { threadId: "thread-1", terminalId: "term-1" }),
    );
  });

  it("round-trips editable connection profiles", () => {
    expect(fromSettingsDraft(toSettingsDraft(localProfile))).toEqual(localProfile);
    expect(
      fromSettingsDraft({
        ...toSettingsDraft(localProfile),
        id: "build-box",
        name: "Build box",
        kind: "ssh",
        host: "build-box",
        username: "agent",
        port: "2222",
        identityFile: "/keys/build-box",
        persistent: true,
      }),
    ).toEqual({
      id: "build-box",
      name: "Build box",
      connection: {
        kind: "ssh",
        executable: "codex",
        args: ["app-server"],
        workspace: "/workspace",
        env: {},
        host: "build-box",
        username: "agent",
        port: 2222,
        identityFile: "/keys/build-box",
        persistent: true,
      },
    });
  });

  it("keeps identical project and thread ids scoped to their environments", () => {
    const thread = {
      id: "thread-1",
      name: "Shared id",
      preview: "",
      cwd: "/workspace",
      createdAt: 1,
      updatedAt: 1,
      status: "idle",
    } as const;
    const environment = (id: string, name: string): EnvironmentState => ({
      profile: { ...localProfile, id, name },
      phase: "connected",
      attempt: 1,
      error: null,
      retryAt: null,
      snapshot: { updatedAt: 1, threads: [thread], workspaces: ["/workspace"], details: {} },
      account: null,
      remote: null,
      models: [],
      workspaceOpeners: [],
    });

    expect(
      projectEnvironmentProjects([environment("local", "Local"), environment("ssh", "SSH")]),
    ).toMatchObject([
      { key: "local:/workspace", environmentId: "local", threads: [{ id: "thread-1" }] },
      { key: "ssh:/workspace", environmentId: "ssh", threads: [{ id: "thread-1" }] },
    ]);
  });

  it("keeps an added project visible before it has threads", () => {
    const environment: EnvironmentState = {
      profile: localProfile,
      phase: "connected",
      attempt: 1,
      error: null,
      retryAt: null,
      snapshot: {
        updatedAt: 1,
        threads: [],
        workspaces: ["/workspace", "/new-project"],
        details: {},
      },
      account: null,
      remote: null,
      models: [],
      workspaceOpeners: [],
    };
    expect(projectEnvironmentProjects([environment])).toMatchObject([
      { key: "local:/workspace", threads: [] },
      { key: "local:/new-project", threads: [] },
    ]);
  });

  it("resolves and projects app-server directory browsing", () => {
    expect(resolveAppServerBrowsePath("~/src", "/Users/tester")).toBe("/Users/tester/src");
    expect(resolveAppServerBrowsePath("packages", "/Users/tester", "/repo")).toBe("/repo/packages");
    expect(
      projectAppServerDirectory("/repo", {
        entries: [
          { fileName: "zeta", isDirectory: true, isFile: false },
          { fileName: "README.md", isDirectory: false, isFile: true },
          { fileName: "alpha", isDirectory: true, isFile: false },
        ],
      }),
    ).toEqual({
      parentPath: "/repo",
      entries: [
        { name: "alpha", fullPath: "/repo/alpha" },
        { name: "zeta", fullPath: "/repo/zeta" },
      ],
    });
  });

  it("keeps direct app-server file access inside the selected project", () => {
    expect(resolveProjectFilePath("/repo", "src/index.ts")).toBe("/repo/src/index.ts");
    expect(() => resolveProjectFilePath("/repo", "../secrets.txt")).toThrow(
      "Workspace file paths must stay inside the selected project.",
    );
  });

  it("removes one archived thread without removing its project", () => {
    const snapshot = {
      updatedAt: 1,
      threads: [
        {
          id: "thread-1",
          name: "First",
          preview: "",
          cwd: "/workspace",
          createdAt: 1,
          updatedAt: 1,
          status: "idle" as const,
        },
        {
          id: "thread-2",
          name: "Second",
          preview: "",
          cwd: "/workspace",
          createdAt: 1,
          updatedAt: 1,
          status: "idle" as const,
        },
      ],
      workspaces: ["/workspace"],
      details: {
        "thread-1": {
          id: "thread-1",
          name: "First",
          preview: "",
          cwd: "/workspace",
          createdAt: 1,
          updatedAt: 1,
          status: "idle" as const,
          turns: [],
        },
      },
    };

    expect(removeThreadFromSnapshot(snapshot, "thread-1")).toMatchObject({
      threads: [{ id: "thread-2" }],
      workspaces: ["/workspace"],
      details: {},
    });
  });

  it("removes a project and every thread rooted in it", () => {
    const snapshot = {
      updatedAt: 1,
      threads: [
        {
          id: "remove",
          name: null,
          preview: "",
          cwd: "/remove",
          createdAt: 1,
          updatedAt: 1,
          status: "idle" as const,
        },
        {
          id: "keep",
          name: null,
          preview: "",
          cwd: "/keep",
          createdAt: 1,
          updatedAt: 1,
          status: "idle" as const,
        },
      ],
      workspaces: ["/remove", "/keep"],
      details: {
        remove: {
          id: "remove",
          name: null,
          preview: "",
          cwd: "/remove",
          createdAt: 1,
          updatedAt: 1,
          status: "idle" as const,
          turns: [],
        },
        keep: {
          id: "keep",
          name: null,
          preview: "",
          cwd: "/keep",
          createdAt: 1,
          updatedAt: 1,
          status: "idle" as const,
          turns: [],
        },
      },
    };

    expect(removeProjectFromSnapshot(snapshot, "/remove")).toMatchObject({
      threads: [{ id: "keep" }],
      workspaces: ["/keep"],
      details: { keep: { id: "keep" } },
    });
  });
});
