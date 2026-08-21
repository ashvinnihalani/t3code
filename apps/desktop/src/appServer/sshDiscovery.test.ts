import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { discoverSshHosts } from "./sshDiscovery.ts";

describe("discoverSshHosts", () => {
  it.effect("reuses OpenSSH config aliases, includes, and unhashed known hosts", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homeDirectory = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-codex-ssh-",
      });
      const sshDirectory = path.join(homeDirectory, ".ssh");
      yield* fileSystem.makeDirectory(path.join(sshDirectory, "conf.d"), { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(sshDirectory, "config"),
        "Include conf.d/*\nHost build-box *.internal\n",
      );
      yield* fileSystem.writeFileString(
        path.join(sshDirectory, "conf.d", "work"),
        "Host gpu-box\n",
      );
      yield* fileSystem.writeFileString(
        path.join(sshDirectory, "known_hosts"),
        "[private.example.com]:2222 ssh-ed25519 AAAA\n|1|hashed ignored\n",
      );

      assert.deepEqual(yield* discoverSshHosts({ fileSystem, path, homeDirectory }), [
        { alias: "build-box", source: "ssh-config" },
        { alias: "gpu-box", source: "ssh-config" },
        { alias: "private.example.com", source: "known-hosts" },
      ]);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});
