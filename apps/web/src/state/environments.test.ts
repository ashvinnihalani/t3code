import { describe, expect, it } from "vite-plus/test";

import { directPrimaryEnvironmentId } from "./environments";

describe("directPrimaryEnvironmentId", () => {
  it("keeps Local primary when the selected thread is on SSH", () => {
    expect(
      directPrimaryEnvironmentId({
        connections: [
          {
            id: "ssh-buildbox",
            name: "Build box",
            connection: {
              kind: "ssh",
              host: "buildbox",
              username: "",
              port: null,
              identityFile: "",
              executable: "codex",
              args: ["app-server"],
              workspace: "/workspace",
              env: {},
            },
          },
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
      }),
    ).toBe("local");
  });

  it("returns no primary environment before settings load", () => {
    expect(directPrimaryEnvironmentId(null)).toBeNull();
  });
});
