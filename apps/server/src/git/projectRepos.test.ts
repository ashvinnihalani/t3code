import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { buildRemoteDiscoveryScript, discoverProjectRepos } from "./projectRepos";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function initGitRepo(repoPath: string): void {
  fs.mkdirSync(repoPath, { recursive: true });
  execFileSync("git", ["init"], { cwd: repoPath });
}

function runRemoteDiscoveryScript(workspaceRoot: string): string {
  return execFileSync("sh", ["-lc", buildRemoteDiscoveryScript(workspaceRoot)], {
    encoding: "utf8",
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("project repo discovery", () => {
  it("discovers nested local repos up to depth 5", async () => {
    const workspaceRoot = makeTempDir("project-repos-local-");
    initGitRepo(path.join(workspaceRoot, "src", "gitrepos", "NeMo"));
    initGitRepo(path.join(workspaceRoot, "src", "gitrepos", "Other"));

    const result = await discoverProjectRepos({ workspaceRoot });

    expect(result).toEqual({
      gitMode: "multi",
      gitRepos: [
        { repoPath: "src/gitrepos/NeMo", displayName: "NeMo" },
        { repoPath: "src/gitrepos/Other", displayName: "Other" },
      ],
    });
  });

  it("remote discovery script emits nested repos for non-git parent roots", () => {
    const workspaceRoot = makeTempDir("project-repos-remote-");
    initGitRepo(path.join(workspaceRoot, "src", "gitrepos", "NeMo"));
    initGitRepo(path.join(workspaceRoot, "src", "gitrepos", "Other"));

    const output = runRemoteDiscoveryScript(workspaceRoot);
    const parts = output.split("\0").filter(Boolean);

    expect(parts).toEqual(["multi", "src/gitrepos/NeMo", "NeMo", "src/gitrepos/Other", "Other"]);
  });

  it("remote discovery script resolves workspace roots relative to HOME", () => {
    const fakeHome = makeTempDir("project-repos-remote-home-");
    const workspaceRoot = path.join(fakeHome, "SFAILib");
    initGitRepo(path.join(workspaceRoot, "src", "gitrepos", "NeMo"));
    initGitRepo(path.join(workspaceRoot, "src", "gitrepos", "Other"));

    const output = execFileSync("sh", ["-lc", buildRemoteDiscoveryScript("SFAILib/src/gitrepos")], {
      cwd: fakeHome,
      env: {
        ...process.env,
        HOME: fakeHome,
      },
      encoding: "utf8",
    });
    const parts = output.split("\0").filter(Boolean);

    expect(parts).toEqual(["multi", "NeMo", "NeMo", "Other", "Other"]);
  });
});
