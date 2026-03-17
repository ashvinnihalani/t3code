import type {
  RemoteProjectValidationInput,
  RemoteProjectValidationResult,
} from "@t3tools/contracts";

import { runProcess } from "../processRunner";
import { buildSshExecArgs, quotePosixShell } from "../sshCommand";

const REMOTE_PROJECT_VALIDATION_SENTINEL = "__T3_REMOTE_PROJECT_VALIDATE__";
const REMOTE_PROJECT_VALIDATION_TIMEOUT_MS = 10_000;
const REMOTE_PROJECT_VALIDATION_OUTPUT_FIELDS = 7;

function buildRemoteProjectValidationScript(workspaceRoot: string): string {
  const escapedWorkspaceRoot = quotePosixShell(workspaceRoot.trim());
  const escapedSentinel = quotePosixShell(REMOTE_PROJECT_VALIDATION_SENTINEL);

  return [
    `input_path=${escapedWorkspaceRoot}`,
    'case "$input_path" in',
    '  "~") target_path=$HOME ;;',
    '  "~/"*) target_path=$HOME/${input_path#~/} ;;',
    "  *) target_path=$input_path ;;",
    "esac",
    'if ! [ -e "$target_path" ]; then',
    "  exit 10",
    "fi",
    'if ! [ -d "$target_path" ]; then',
    "  exit 11",
    "fi",
    'cd "$target_path" || exit 12',
    "resolved_path=$(pwd -P 2>/dev/null || pwd)",
    "directory_name=${resolved_path##*/}",
    'if [ -z "$directory_name" ]; then directory_name=$resolved_path; fi',
    'hostname_value=$(hostname 2>/dev/null || printf "")',
    "git_available=0",
    'git_repository_root=""',
    "if command -v git >/dev/null 2>&1; then",
    "  git_available=1",
    '  git_repository_root=$(git rev-parse --show-toplevel 2>/dev/null || printf "")',
    "fi",
    "codex_cli_available=0",
    'codex_cli_version=""',
    "if command -v codex >/dev/null 2>&1; then",
    "  codex_cli_available=1",
    '  codex_cli_version=$(codex --version 2>/dev/null | head -n 1 || printf "")',
    "fi",
    `printf '%s\\0' ${escapedSentinel} "$resolved_path" "$directory_name" "$hostname_value" "$git_available" "$git_repository_root" "$codex_cli_available" "$codex_cli_version"`,
  ].join("\n");
}

function normalizeOptionalValue(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function parseRemoteProjectValidationOutput(stdout: string): RemoteProjectValidationResult {
  const sentinelIndex = stdout.lastIndexOf(REMOTE_PROJECT_VALIDATION_SENTINEL);
  if (sentinelIndex === -1) {
    throw new Error("Remote validation returned an unexpected response.");
  }

  const payload = stdout
    .slice(sentinelIndex)
    .split("\0")
    .slice(1, 1 + REMOTE_PROJECT_VALIDATION_OUTPUT_FIELDS);
  if (payload.length !== REMOTE_PROJECT_VALIDATION_OUTPUT_FIELDS) {
    throw new Error("Remote validation returned an incomplete response.");
  }

  const [
    rawWorkspaceRoot,
    rawDirectoryName,
    rawHostname,
    rawGitAvailable,
    rawGitRepositoryRoot,
    rawCodexCliAvailable,
    rawCodexCliVersion,
  ] = payload;

  const workspaceRoot = normalizeOptionalValue(rawWorkspaceRoot);
  if (!workspaceRoot) {
    throw new Error("Remote validation did not return a workspace path.");
  }

  return {
    workspaceRoot,
    directoryName: normalizeOptionalValue(rawDirectoryName) ?? workspaceRoot,
    hostname: normalizeOptionalValue(rawHostname),
    gitAvailable: rawGitAvailable === "1",
    gitRepositoryRoot: normalizeOptionalValue(rawGitRepositoryRoot),
    codexCliAvailable: rawCodexCliAvailable === "1",
    codexCliVersion: normalizeOptionalValue(rawCodexCliVersion),
  };
}

function describeRemoteValidationFailure(input: {
  readonly hostAlias: string;
  readonly workspaceRoot: string;
  readonly code: number | null;
  readonly stderr: string;
}): Error {
  const workspaceRoot = input.workspaceRoot.trim();
  const stderr = input.stderr.trim();

  switch (input.code) {
    case 10:
      return new Error(`Remote directory does not exist: ${input.hostAlias}:${workspaceRoot}`);
    case 11:
      return new Error(`Remote path is not a directory: ${input.hostAlias}:${workspaceRoot}`);
    case 12:
      return new Error(`Unable to enter remote directory: ${input.hostAlias}:${workspaceRoot}`);
    default: {
      const detail = stderr.length > 0 ? stderr : "SSH validation failed.";
      return new Error(`Failed to validate remote project on ${input.hostAlias}. ${detail}`);
    }
  }
}

export async function validateRemoteProjectOverSsh(
  input: RemoteProjectValidationInput,
  options: { readonly localCwd?: string } = {},
): Promise<RemoteProjectValidationResult> {
  const localCwd = options.localCwd ?? process.cwd();
  const result = await runProcess(
    "ssh",
    buildSshExecArgs({
      hostAlias: input.remote.hostAlias,
      command: "sh",
      args: ["-lc", buildRemoteProjectValidationScript(input.workspaceRoot)],
      localCwd,
    }),
    {
      cwd: localCwd,
      timeoutMs: REMOTE_PROJECT_VALIDATION_TIMEOUT_MS,
      allowNonZeroExit: true,
      outputMode: "truncate",
    },
  );

  if (result.timedOut || result.code !== 0) {
    throw describeRemoteValidationFailure({
      hostAlias: input.remote.hostAlias,
      workspaceRoot: input.workspaceRoot,
      code: result.code,
      stderr: result.stderr,
    });
  }

  return parseRemoteProjectValidationOutput(result.stdout);
}
