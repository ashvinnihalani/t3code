import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listSshHosts } from "./sshHosts";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("listSshHosts", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists concrete host aliases from the main config file", async () => {
    const homeDir = makeTempDir("t3code-ssh-hosts-home-");
    const sshDir = path.join(homeDir, ".ssh");
    fs.mkdirSync(sshDir, { recursive: true });
    fs.writeFileSync(
      path.join(sshDir, "config"),
      `
        Host *
          User ignored-default

        Host work
          HostName example.com
          User ash
          Port 2222

        Host *.wildcard
          HostName wildcard.example.com
      `,
      "utf8",
    );

    await expect(listSshHosts({ homeDir })).resolves.toEqual([
      {
        alias: "work",
        hostname: "example.com",
        user: "ash",
        port: 2222,
        sourcePath: path.join(sshDir, "config"),
      },
    ]);
  });

  it("loads hosts from included config files", async () => {
    const homeDir = makeTempDir("t3code-ssh-hosts-include-");
    const sshDir = path.join(homeDir, ".ssh");
    const includeDir = path.join(sshDir, "config.d");
    fs.mkdirSync(includeDir, { recursive: true });
    fs.writeFileSync(path.join(sshDir, "config"), "Include ~/.ssh/config.d/*\n", "utf8");
    fs.writeFileSync(
      path.join(includeDir, "prod.conf"),
      `
        Host prod
          HostName prod.example.com
          User deploy
      `,
      "utf8",
    );

    await expect(listSshHosts({ homeDir })).resolves.toEqual([
      {
        alias: "prod",
        hostname: "prod.example.com",
        user: "deploy",
        port: null,
        sourcePath: path.join(includeDir, "prod.conf"),
      },
    ]);
  });
});
