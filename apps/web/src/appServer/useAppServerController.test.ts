import { describe, expect, it } from "@effect/vitest";

import {
  fromSettingsDraft,
  projectEnvironmentProjects,
  removeProjectFromSnapshot,
  removeThreadFromSnapshot,
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
      snapshot: { updatedAt: 1, threads: [thread], workspaces: ["/workspace"] },
      account: null,
      remote: null,
      models: [],
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
      snapshot: { updatedAt: 1, threads: [], workspaces: ["/workspace", "/new-project"] },
      account: null,
      remote: null,
      models: [],
    };
    expect(projectEnvironmentProjects([environment])).toMatchObject([
      { key: "local:/workspace", threads: [] },
      { key: "local:/new-project", threads: [] },
    ]);
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
    };

    expect(removeThreadFromSnapshot(snapshot, "thread-1")).toMatchObject({
      threads: [{ id: "thread-2" }],
      workspaces: ["/workspace"],
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
    };

    expect(removeProjectFromSnapshot(snapshot, "/remove")).toMatchObject({
      threads: [{ id: "keep" }],
      workspaces: ["/keep"],
    });
  });
});
