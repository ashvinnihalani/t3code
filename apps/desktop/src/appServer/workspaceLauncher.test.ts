import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

vi.mock("electron", () => ({ shell: { openPath: vi.fn() } }));

import { editorArguments, listWorkspaceOpeners, openWorkspace } from "./workspaceLauncher.ts";

const localProfile = {
  id: "local",
  name: "Local",
  connection: {
    kind: "local" as const,
    executable: "codex",
    args: ["app-server"],
    workspace: "/work/local",
    env: {},
  },
};

const sshProfile = {
  id: "buildbox",
  name: "Build box",
  connection: {
    kind: "ssh" as const,
    host: "buildbox",
    username: "ashvin",
    port: null,
    identityFile: "",
    executable: "codex",
    args: ["app-server"],
    workspace: "/srv/project",
    env: {},
  },
};

function dependencies(executableSuffix = "/cursor") {
  return {
    platform: "darwin" as const,
    environment: { PATH: "/tools/bin" },
    openPath: vi.fn(async () => ""),
    spawnDetached: vi.fn(async () => undefined),
    canExecute: vi.fn(async (path: string) => path.endsWith(executableSuffix)),
    joinPath: (...paths: ReadonlyArray<string>) => paths.join("/"),
  };
}

describe("app-server workspace launcher", () => {
  it("lists installed editors and Finder for local workspaces", async () => {
    await expect(listWorkspaceOpeners(localProfile, dependencies())).resolves.toEqual([
      "cursor",
      "file-manager",
    ]);
  });

  it("detects and launches the bundled Zed CLI", async () => {
    const launcher = dependencies("/Applications/Zed.app/Contents/MacOS/cli");
    await expect(listWorkspaceOpeners(localProfile, launcher)).resolves.toEqual([
      "zed",
      "file-manager",
    ]);
    await expect(
      openWorkspace({ profile: localProfile, cwd: "/work/local", editor: "zed" }, launcher),
    ).resolves.toEqual({ ok: true });
    expect(launcher.spawnDetached).toHaveBeenCalledWith(
      "/Applications/Zed.app/Contents/MacOS/cli",
      ["/work/local"],
    );
  });

  it("keeps local file managers out of SSH workspaces", async () => {
    await expect(listWorkspaceOpeners(sshProfile, dependencies("/code"))).resolves.toEqual([
      "vscode",
    ]);
  });

  it("uses editor-native SSH workspace arguments", () => {
    expect(editorArguments(sshProfile, "/srv/project", "vscode")).toEqual([
      "--remote",
      "ssh-remote+ashvin@buildbox",
      "/srv/project/",
    ]);
    expect(editorArguments(sshProfile, "/srv/project", "zed")).toEqual([
      "ssh://ashvin@buildbox/srv/project",
    ]);
  });

  it("opens a local workspace in the platform file manager", async () => {
    const launcher = dependencies();
    await expect(
      openWorkspace(
        { profile: localProfile, cwd: "/work/local", editor: "file-manager" },
        launcher,
      ),
    ).resolves.toEqual({ ok: true });
    expect(launcher.openPath).toHaveBeenCalledWith("/work/local");
  });

  it("rejects a file manager for SSH workspaces", async () => {
    await expect(
      openWorkspace(
        { profile: sshProfile, cwd: "/srv/project", editor: "file-manager" },
        dependencies(),
      ),
    ).resolves.toEqual({
      ok: false,
      error: "The file manager cannot open an SSH workspace.",
    });
  });
});
