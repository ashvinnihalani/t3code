import { describe, expect, it } from "@effect/vitest";

import {
  fromSettingsDraft,
  projectEnvironmentProjects,
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
      snapshot: { updatedAt: 1, threads: [thread] },
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
});
