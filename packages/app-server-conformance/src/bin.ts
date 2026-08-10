#!/usr/bin/env node

import { runHarnessCli } from "./harness/HarnessCli.ts";

const runtime = process;

runtime.exitCode = await runHarnessCli({
  argv: runtime.argv.slice(2),
  environment: runtime.env,
  currentWorkingDirectory: runtime.cwd(),
  stdout: (text) => runtime.stdout.write(text),
  stderr: (text) => runtime.stderr.write(text),
});
