import type { WorkspaceOpenRequest } from "../../../packages/effect-codex-app-server/src/connection.ts";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";

vi.mock("electron", () => ({
  shell: { openPath: vi.fn() },
}));

import { editorArguments, listWorkspaceOpeners, openWorkspace } from "./workspaceLauncher.ts";

const localConnection = {
  kind: "local" as const,
  executable: "codex",
  args: ["app-server"],
  workspace: "/work/local",
  env: {},
};

const sshConnection = {
  kind: "ssh" as const,
  host: "buildbox",
  username: "ashvin",
  port: null,
  identityFile: "",
  executable: "codex",
  args: ["app-server"],
  workspace: "/srv/project",
  env: {},
};

function dependencies(executableSuffix = "/cursor") {
  return {
    platform: "darwin" as const,
    environment: { PATH: "/tools/bin" },
    openPath: vi.fn(async () => ""),
    spawnDetached: vi.fn(async () => undefined),
    canExecute: vi.fn(async (path: string) => path.endsWith(executableSuffix)),
  };
}

describe("workspace launcher", () => {
  it("lists installed editors and Finder for local workspaces", async () => {
    const result = await listWorkspaceOpeners(localConnection, dependencies());

    expect(result).toEqual([
      { id: "cursor", label: "Cursor" },
      { id: "file-manager", label: "Finder" },
    ]);
  });

  it("keeps local file managers out of SSH workspaces", async () => {
    const result = await listWorkspaceOpeners(sshConnection, dependencies("/code"));

    expect(result).toEqual([{ id: "vscode", label: "VS Code" }]);
  });

  it("reuses upstream-compatible remote SSH editor arguments", () => {
    const request: WorkspaceOpenRequest = {
      connection: sshConnection,
      cwd: "/srv/project",
      opener: "vscode",
    };

    expect(editorArguments(request, "vscode")).toEqual([
      "--remote",
      "ssh-remote+ashvin@buildbox",
      "/srv/project/",
    ]);
    expect(editorArguments(request, "zed")).toEqual(["ssh://ashvin@buildbox/srv/project"]);
  });

  it("opens local folders with the platform file manager", async () => {
    const launcher = dependencies();
    const result = await openWorkspace(
      { connection: localConnection, cwd: "/work/local", opener: "file-manager" },
      launcher,
    );

    expect(result).toEqual({ ok: true });
    expect(launcher.openPath).toHaveBeenCalledWith("/work/local");
  });

  it("rejects the file manager for SSH paths", async () => {
    const result = await openWorkspace(
      { connection: sshConnection, cwd: "/srv/project", opener: "file-manager" },
      dependencies(),
    );

    expect(result).toEqual({
      ok: false,
      error: "The file manager cannot open an SSH workspace.",
    });
  });
});
