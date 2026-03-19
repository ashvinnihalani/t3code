/**
 * Git process helpers - centralized git command execution with typed errors.
 *
 * @module GitServiceLive
 */
import { Effect, Layer, Schema } from "effect";

import {
  buildCommandTransportInvocation,
  buildHostCommandTransportTarget,
} from "../../commandTransport";
import { runProcess } from "../../processRunner";
import { GitCommandError } from "../Errors.ts";
import {
  ExecuteGitInput,
  ExecuteGitResult,
  GitService,
  GitServiceShape,
} from "../Services/GitService.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

function quoteGitCommand(args: ReadonlyArray<string>): string {
  return `git ${args.join(" ")}`;
}

function toGitCommandError(
  input: Pick<ExecuteGitInput, "operation" | "cwd" | "args">,
  detail: string,
) {
  return (cause: unknown) =>
    Schema.is(GitCommandError)(cause)
      ? cause
      : new GitCommandError({
          operation: input.operation,
          command: quoteGitCommand(input.args),
          cwd: input.cwd,
          detail: `${cause instanceof Error && cause.message.length > 0 ? cause.message : "Unknown error"} - ${detail}`,
          ...(cause !== undefined ? { cause } : {}),
        });
}

const makeGitService = Effect.gen(function* () {
  const execute: GitServiceShape["execute"] = Effect.fnUntraced(function* (input) {
    const commandInput = {
      ...input,
      args: [...input.args],
    } as const;
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const normalizedEnv = input.env
      ? Object.fromEntries(
          Object.entries(input.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        )
      : undefined;
    const target = input.target ?? buildHostCommandTransportTarget(input.remote);
    const invocation = buildCommandTransportInvocation({
      target,
      command: "git",
      args: commandInput.args,
      cwd: commandInput.cwd,
      ...(normalizedEnv ? { env: normalizedEnv } : {}),
      localCwd: process.cwd(),
    });

    const result = yield* Effect.tryPromise({
      try: () =>
        runProcess(invocation.command, invocation.args, {
          cwd: invocation.cwd,
          env: invocation.env,
          timeoutMs,
          allowNonZeroExit: input.allowNonZeroExit,
          maxBufferBytes: maxOutputBytes,
          outputMode: "truncate",
        }),
      catch: toGitCommandError(commandInput, "failed to spawn."),
    });

    if (!input.allowNonZeroExit && result.code !== 0) {
      const trimmedStderr = result.stderr.trim();
      return yield* new GitCommandError({
        operation: commandInput.operation,
        command: quoteGitCommand(commandInput.args),
        cwd: commandInput.cwd,
        detail:
          trimmedStderr.length > 0
            ? `${quoteGitCommand(commandInput.args)} failed: ${trimmedStderr}`
            : `${quoteGitCommand(commandInput.args)} failed with code ${result.code}.`,
      });
    }

    return {
      code: result.code ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
    } satisfies ExecuteGitResult;
  });

  return {
    execute,
  } satisfies GitServiceShape;
});

export const GitServiceLive = Layer.effect(GitService, makeGitService);
