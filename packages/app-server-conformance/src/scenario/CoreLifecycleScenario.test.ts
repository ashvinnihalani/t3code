import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

import { JsonRpcDriver } from "../protocol/JsonRpcDriver.ts";
import { spawnChildProcessJsonlTransport } from "../servers/ChildProcessJsonlTransport.ts";
import { runCoreLifecycleScenario } from "./CoreLifecycleScenario.ts";

const fixturePath = NodePath.resolve(
  import.meta.dirname,
  "../../test/fixtures/scripted-app-server.ts",
);
const goldenPath = NodePath.resolve(
  import.meta.dirname,
  "../../goldens/be6e8eac029b183056b7e4402879f15d2c85f61b/core-lifecycle.json",
);

describe("runCoreLifecycleScenario", () => {
  it("records a schema-valid normalized thread and turn lifecycle", async () => {
    const transport = spawnChildProcessJsonlTransport({
      executable: process.execPath,
      args: [fixturePath],
      cwd: import.meta.dirname,
    });
    const driver = new JsonRpcDriver(transport);

    try {
      const result = await runCoreLifecycleScenario({
        driver,
        workspace: import.meta.dirname,
      });
      expect(result.schemaIssues).toEqual([]);
      const golden = JSON.parse(await NodeFSP.readFile(goldenPath, "utf8"));
      expect(result.normalizedTrace).toEqual(golden);
    } finally {
      await driver.close();
    }
  });
});
