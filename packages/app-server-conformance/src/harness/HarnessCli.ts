import * as NodeFSP from "node:fs/promises";

import { runConfiguredHarness } from "./ConfiguredHarness.ts";
import {
  harnessCommandHelp,
  parseHarnessCommandLine,
  type HarnessCommandEnvironment,
} from "./HarnessCommandLine.ts";

export interface HarnessCliInput {
  readonly argv: ReadonlyArray<string>;
  readonly environment: HarnessCommandEnvironment;
  readonly currentWorkingDirectory: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const runHarnessCli = async (input: HarnessCliInput): Promise<number> => {
  try {
    const command = parseHarnessCommandLine(
      input.argv,
      input.environment,
      input.currentWorkingDirectory,
    );
    if (command.kind === "help") {
      input.stdout(harnessCommandHelp);
      return 0;
    }

    const result = await runConfiguredHarness(command.harness);
    if (command.traceOutput !== undefined) {
      await NodeFSP.writeFile(
        command.traceOutput,
        `${JSON.stringify(result.normalizedTrace, null, 2)}\n`,
        "utf8",
      );
    }
    input.stdout(`${JSON.stringify(result.report, null, 2)}\n`);
    if (result.serverStderr.length > 0) input.stderr(result.serverStderr);
    return result.report.compatible ? 0 : 1;
  } catch (error) {
    input.stderr(`App-server conformance failed: ${errorMessage(error)}\n`);
    return 1;
  }
};
