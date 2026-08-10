import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

const manifestPath = NodePath.resolve(import.meta.dirname, "../reference-manifest.json");
const generatedSchemaPath = NodePath.resolve(
  import.meta.dirname,
  "../../effect-codex-app-server/src/_generated/schema.gen.ts",
);

describe("reference manifest", () => {
  it("pins the requested T3 and Codex protocol revisions", async () => {
    const manifest = JSON.parse(await NodeFSP.readFile(manifestPath, "utf8")) as {
      readonly t3BaseTag: string;
      readonly t3BaseCommit: string;
      readonly codexProtocolRef: string;
      readonly schemaSha256: string;
    };

    expect(manifest.t3BaseTag).toBe("v0.0.32");
    expect(manifest.t3BaseCommit).toBe("be1a836745395286cbd392512179ab5816f538ba");
    expect(manifest.codexProtocolRef).toBe("678157acaa819d5510adfe359abb5d0392cfe461");

    const schema = await NodeFSP.readFile(generatedSchemaPath);
    const schemaSha256 = NodeCrypto.createHash("sha256").update(schema).digest("hex");
    expect(manifest.schemaSha256).toBe(schemaSha256);
  });
});
