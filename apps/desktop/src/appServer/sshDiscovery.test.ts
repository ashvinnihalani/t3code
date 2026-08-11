import * as NodeFS from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

import { discoverSshHosts } from "./sshDiscovery.ts";

describe("discoverSshHosts", () => {
  it("reuses OpenSSH config aliases, includes, and unhashed known hosts", async () => {
    const home = await NodeFS.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-codex-ssh-"));
    try {
      const ssh = NodePath.join(home, ".ssh");
      await NodeFS.mkdir(NodePath.join(ssh, "conf.d"), { recursive: true });
      await NodeFS.writeFile(
        NodePath.join(ssh, "config"),
        "Include conf.d/*\nHost build-box *.internal\n",
      );
      await NodeFS.writeFile(NodePath.join(ssh, "conf.d", "work"), "Host gpu-box\n");
      await NodeFS.writeFile(
        NodePath.join(ssh, "known_hosts"),
        "[private.example.com]:2222 ssh-ed25519 AAAA\n|1|hashed ignored\n",
      );

      expect(await discoverSshHosts(home)).toEqual([
        { alias: "build-box", source: "ssh-config" },
        { alias: "gpu-box", source: "ssh-config" },
        { alias: "private.example.com", source: "known-hosts" },
      ]);
    } finally {
      await NodeFS.rm(home, { recursive: true });
    }
  });
});
