import { randomUUID } from "node:crypto";

import { Effect, Exit, FileSystem, Layer, Option, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import type { ProjectRemoteTarget } from "@t3tools/contracts";
import { DEFAULT_GIT_TEXT_GENERATION_MODEL } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { TextGenerationError } from "../Errors.ts";
import {
  type BranchNameGenerationInput,
  type BranchNameGenerationResult,
  type CommitMessageGenerationResult,
  type PrContentGenerationResult,
  type TextGenerationShape,
  TextGeneration,
} from "../Services/TextGeneration.ts";

const CODEX_REASONING_EFFORT = "low";
const CODEX_TIMEOUT_MS = 180_000;
const CODEX_DISABLE_WEB_SEARCH_CONFIG = "tools.web_search=false";

function toCodexOutputJsonSchema(schema: Schema.Top): unknown {
  const document = Schema.toJsonSchemaDocument(schema);
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    return {
      ...document.schema,
      $defs: document.definitions,
    };
  }
  return document.schema;
}

function normalizeCodexError(
  operation: string,
  error: unknown,
  fallback: string,
): TextGenerationError {
  if (Schema.is(TextGenerationError)(error)) {
    return error;
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      error.message.includes("Command not found: codex") ||
      lower.includes("spawn codex") ||
      lower.includes("enoent")
    ) {
      return new TextGenerationError({
        operation,
        detail: "Codex CLI (`codex`) is required but not available on PATH.",
        cause: error,
      });
    }
    return new TextGenerationError({
      operation,
      detail: `${fallback}: ${error.message}`,
      cause: error,
    });
  }

  return new TextGenerationError({
    operation,
    detail: fallback,
    cause: error,
  });
}

function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const truncated = value.slice(0, maxChars);
  return `${truncated}\n\n[truncated]`;
}

function sanitizeCommitSubject(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const withoutTrailingPeriod = singleLine.replace(/[.]+$/g, "").trim();
  if (withoutTrailingPeriod.length === 0) {
    return "Update project files";
  }

  if (withoutTrailingPeriod.length <= 72) {
    return withoutTrailingPeriod;
  }
  return withoutTrailingPeriod.slice(0, 72).trimEnd();
}

function sanitizePrTitle(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  if (singleLine.length > 0) {
    return singleLine;
  }
  return "Update project changes";
}

function extractFencedBlock(raw: string): string | null {
  const match = raw.match(/```(?:[a-z0-9_-]+)?\s*([\s\S]*?)```/i);
  const candidate = match?.[1]?.trim() ?? "";
  return candidate.length > 0 ? candidate : null;
}

function extractFencedJson(raw: string): string | null {
  return extractFencedBlock(raw);
}

function extractBalancedJson(raw: string): string | null {
  const start = raw.search(/[{[]/);
  if (start < 0) {
    return null;
  }

  const stack: string[] = [];
  let inString = false;
  let escaping = false;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (!char) {
      continue;
    }

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === "\\") {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }
    if (char === "}" || char === "]") {
      const last = stack[stack.length - 1];
      const matchesPair = (last === "{" && char === "}") || (last === "[" && char === "]");
      if (!matchesPair) {
        return null;
      }
      stack.pop();
      if (stack.length === 0) {
        return raw.slice(start, index + 1).trim();
      }
    }
  }

  return null;
}

function collectStructuredOutputCandidates(raw: string): ReadonlyArray<string> {
  const candidates = new Set<string>();
  const trimmed = raw.trim();
  if (trimmed.length > 0) {
    candidates.add(trimmed);
  }

  const fenced = extractFencedJson(trimmed);
  if (fenced) {
    candidates.add(fenced);
  }

  const balanced = extractBalancedJson(trimmed);
  if (balanced) {
    candidates.add(balanced);
  }

  return Array.from(candidates);
}

function stripFormattingWrapper(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if (
      (first === '"' && last === '"') ||
      (first === "'" && last === "'") ||
      (first === "`" && last === "`")
    ) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

function normalizeFallbackText(raw: string): string {
  return (extractFencedBlock(raw) ?? raw).replace(/\r\n/g, "\n").trim();
}

function isCommitPreambleLine(raw: string): boolean {
  const trimmed = raw.trim();
  return (
    /^(?:here(?:'s| is)|proposed|suggested)\b/i.test(trimmed) ||
    /^(?:commit message|message|output)\s*:?\s*$/i.test(trimmed)
  );
}

function parseCommitMessageFallback(raw: string, wantsBranch: boolean) {
  const normalized = normalizeFallbackText(raw);
  if (normalized.length === 0) {
    return {
      subject: "Update project files",
      body: "",
      ...(wantsBranch ? { branch: sanitizeFeatureBranchName("update-project-files") } : {}),
    };
  }

  let subject = "";
  let branch: string | undefined;
  const bodyLines: string[] = [];
  let activeSection: "body" | null = null;

  for (const line of normalized.split("\n")) {
    const trimmed = line.trim();

    const subjectMatch = /^(?:subject|title|summary|commit(?: message)?)\s*:\s*(.+)$/i.exec(
      trimmed,
    );
    if (subjectMatch) {
      subject = stripFormattingWrapper(subjectMatch[1] ?? "");
      activeSection = null;
      continue;
    }

    const bodyMatch = /^(?:body|description)\s*:\s*(.*)$/i.exec(trimmed);
    if (bodyMatch) {
      activeSection = "body";
      const initialBodyLine = stripFormattingWrapper(bodyMatch[1] ?? "");
      if (initialBodyLine.length > 0) {
        bodyLines.push(initialBodyLine);
      }
      continue;
    }

    const branchMatch = /^branch\s*:\s*(.+)$/i.exec(trimmed);
    if (branchMatch) {
      branch = stripFormattingWrapper(branchMatch[1] ?? "");
      activeSection = null;
      continue;
    }

    if (trimmed.length === 0) {
      if (subject.length > 0 || bodyLines.length > 0) {
        bodyLines.push("");
      }
      continue;
    }

    if (subject.length === 0) {
      if (isCommitPreambleLine(trimmed)) {
        continue;
      }
      subject = stripFormattingWrapper(trimmed.replace(/^[-*]\s+/, ""));
      activeSection = null;
      continue;
    }

    if (activeSection === "body") {
      bodyLines.push(line.trimEnd());
      continue;
    }

    bodyLines.push(line.trimEnd());
  }

  const parsedSubject = sanitizeCommitSubject(subject);
  if (parsedSubject.length === 0) {
    return null;
  }

  const parsedBody = bodyLines.join("\n").trim();
  return {
    subject: parsedSubject,
    body: parsedBody,
    ...(wantsBranch
      ? { branch: sanitizeFeatureBranchName(branch && branch.length > 0 ? branch : parsedSubject) }
      : {}),
  };
}

const makeCodexTextGeneration = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const serverConfig = yield* Effect.service(ServerConfig);

  type MaterializedImageAttachments = {
    readonly imagePaths: ReadonlyArray<string>;
  };

  const readStreamAsString = <E>(
    operation: string,
    stream: Stream.Stream<Uint8Array, E>,
  ): Effect.Effect<string, TextGenerationError> =>
    Effect.gen(function* () {
      let text = "";
      yield* Stream.runForEach(stream, (chunk) =>
        Effect.sync(() => {
          text += Buffer.from(chunk).toString("utf8");
        }),
      ).pipe(
        Effect.mapError((cause) =>
          normalizeCodexError(operation, cause, "Failed to collect process output"),
        ),
      );
      return text;
    });

  const tempDir = process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? "/tmp";

  const writeTempFile = (
    operation: string,
    prefix: string,
    content: string,
  ): Effect.Effect<string, TextGenerationError> => {
    const filePath = path.join(tempDir, `t3code-${prefix}-${process.pid}-${randomUUID()}.tmp`);
    return fileSystem.writeFileString(filePath, content).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation,
            detail: `Failed to write temp file at ${filePath}.`,
            cause,
          }),
      ),
      Effect.as(filePath),
    );
  };

  const safeUnlink = (filePath: string): Effect.Effect<void, never> =>
    fileSystem.remove(filePath).pipe(Effect.catch(() => Effect.void));

  const materializeImageAttachments = (
    _operation: "generateCommitMessage" | "generatePrContent" | "generateBranchName",
    attachments: BranchNameGenerationInput["attachments"],
  ): Effect.Effect<MaterializedImageAttachments, TextGenerationError> =>
    Effect.gen(function* () {
      if (!attachments || attachments.length === 0) {
        return { imagePaths: [] };
      }

      const imagePaths: string[] = [];
      for (const attachment of attachments) {
        if (attachment.type !== "image") {
          continue;
        }

        const resolvedPath = resolveAttachmentPath({
          stateDir: serverConfig.stateDir,
          attachment,
        });
        if (!resolvedPath || !path.isAbsolute(resolvedPath)) {
          continue;
        }
        const fileInfo = yield* fileSystem
          .stat(resolvedPath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (!fileInfo || fileInfo.type !== "File") {
          continue;
        }
        imagePaths.push(resolvedPath);
      }
      return { imagePaths };
    });

  const resolveCodexWorkingDirectory = (input: {
    cwd: string;
    remote?: ProjectRemoteTarget | null;
  }): Effect.Effect<string> =>
    Effect.gen(function* () {
      if (input.remote?.kind === "ssh") {
        return serverConfig.cwd;
      }

      const cwdStat = yield* fileSystem
        .stat(input.cwd)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (cwdStat?.type === "Directory") {
        return input.cwd;
      }

      return serverConfig.cwd;
    });

  const runCodexJson = <S extends Schema.Top>({
    operation,
    cwd,
    remote,
    prompt,
    outputSchemaJson,
    fallbackDecode,
    imagePaths = [],
    cleanupPaths = [],
    model,
  }: {
    operation: "generateCommitMessage" | "generatePrContent" | "generateBranchName";
    cwd: string;
    remote?: ProjectRemoteTarget | null;
    prompt: string;
    outputSchemaJson: S;
    fallbackDecode?: ((rawOutput: string) => S["Type"] | null) | undefined;
    imagePaths?: ReadonlyArray<string>;
    cleanupPaths?: ReadonlyArray<string>;
    model?: string;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const executionCwd = yield* resolveCodexWorkingDirectory({
        cwd,
        ...(remote !== undefined ? { remote } : {}),
      });
      let commandStdout = "";
      const outputPath = yield* writeTempFile(operation, "codex-output", "");
      const jsonSchema = JSON.stringify(toCodexOutputJsonSchema(outputSchemaJson), null, 2);
      const structuredPrompt = [
        prompt,
        "",
        "Return exactly one JSON object that matches this schema.",
        "Do not wrap the JSON in markdown fences.",
        "Do not add any explanation before or after the JSON.",
        "JSON schema:",
        jsonSchema,
      ].join("\n");

      const runCodexCommand = Effect.gen(function* () {
        const command = ChildProcess.make(
          "codex",
          [
            "exec",
            "-s",
            "read-only",
            "--model",
            model ?? DEFAULT_GIT_TEXT_GENERATION_MODEL,
            "--config",
            `model_reasoning_effort="${CODEX_REASONING_EFFORT}"`,
            "--config",
            CODEX_DISABLE_WEB_SEARCH_CONFIG,
            "--output-last-message",
            outputPath,
            ...imagePaths.flatMap((imagePath) => ["--image", imagePath]),
            "-",
          ],
          {
            cwd: executionCwd,
            shell: process.platform === "win32",
            stdin: {
              stream: Stream.make(new TextEncoder().encode(structuredPrompt)),
            },
          },
        );

        const child = yield* commandSpawner
          .spawn(command)
          .pipe(
            Effect.mapError((cause) =>
              normalizeCodexError(operation, cause, "Failed to spawn Codex CLI process"),
            ),
          );

        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            readStreamAsString(operation, child.stdout),
            readStreamAsString(operation, child.stderr),
            child.exitCode.pipe(
              Effect.map((value) => Number(value)),
              Effect.mapError((cause) =>
                normalizeCodexError(operation, cause, "Failed to read Codex CLI exit code"),
              ),
            ),
          ],
          { concurrency: "unbounded" },
        );
        commandStdout = stdout;

        if (exitCode !== 0) {
          const stderrDetail = stderr.trim();
          const stdoutDetail = stdout.trim();
          const detail = stderrDetail.length > 0 ? stderrDetail : stdoutDetail;
          return yield* new TextGenerationError({
            operation,
            detail:
              detail.length > 0
                ? `Codex CLI command failed: ${detail}`
                : `Codex CLI command failed with code ${exitCode}.`,
          });
        }
      });

      const cleanup = Effect.all(
        [outputPath, ...cleanupPaths].map((filePath) => safeUnlink(filePath)),
        {
          concurrency: "unbounded",
        },
      ).pipe(Effect.asVoid);

      return yield* Effect.gen(function* () {
        yield* runCodexCommand.pipe(
          Effect.scoped,
          Effect.timeoutOption(CODEX_TIMEOUT_MS),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  new TextGenerationError({ operation, detail: "Codex CLI request timed out." }),
                ),
              onSome: () => Effect.void,
            }),
          ),
        );

        return yield* fileSystem.readFileString(outputPath).pipe(
          Effect.mapError(
            (cause) =>
              new TextGenerationError({
                operation,
                detail: "Failed to read Codex output file.",
                cause,
              }),
          ),
          Effect.map((rawOutput) => {
            const trimmedFileOutput = rawOutput.trim();
            if (trimmedFileOutput.length > 0) {
              return rawOutput;
            }
            return commandStdout.trim().length > 0 ? commandStdout : rawOutput;
          }),
          Effect.flatMap((rawOutput) =>
            Effect.gen(function* () {
              const decode = Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson));
              let lastError: unknown = undefined;

              for (const candidate of collectStructuredOutputCandidates(rawOutput)) {
                const decoded = yield* Effect.exit(decode(candidate));
                if (Exit.isSuccess(decoded)) {
                  return decoded.value;
                }
                lastError = decoded.cause;
              }

              const fallbackValue = fallbackDecode?.(rawOutput);
              if (fallbackValue !== null && fallbackValue !== undefined) {
                return fallbackValue;
              }

              return yield* new TextGenerationError({
                operation,
                detail: "Codex returned invalid structured output.",
                cause: lastError ?? rawOutput,
              });
            }),
          ),
        );
      }).pipe(Effect.ensuring(cleanup));
    });

  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = (input) => {
    const wantsBranch = input.includeBranch === true;

    const prompt = [
      "You write concise git commit messages.",
      wantsBranch
        ? "Return a JSON object with keys: subject, body, branch."
        : "Return a JSON object with keys: subject, body.",
      "Rules:",
      "- subject must be imperative, <= 72 chars, and no trailing period",
      "- body can be empty string or short bullet points",
      ...(wantsBranch
        ? ["- branch must be a short semantic git branch fragment for this change"]
        : []),
      "- capture the primary user-visible or developer-visible change",
      "",
      `Branch: ${input.branch ?? "(detached)"}`,
      "",
      "Staged files:",
      limitSection(input.stagedSummary, 6_000),
      "",
      "Staged patch:",
      limitSection(input.stagedPatch, 40_000),
    ].join("\n");

    const outputSchemaJson = wantsBranch
      ? Schema.Struct({
          subject: Schema.String,
          body: Schema.String,
          branch: Schema.String,
        })
      : Schema.Struct({
          subject: Schema.String,
          body: Schema.String,
        });

    return runCodexJson({
      operation: "generateCommitMessage",
      cwd: input.cwd,
      ...(input.remote ? { remote: input.remote } : {}),
      prompt,
      outputSchemaJson,
      fallbackDecode: (rawOutput) => parseCommitMessageFallback(rawOutput, wantsBranch),
      ...(input.model ? { model: input.model } : {}),
    }).pipe(
      Effect.map(
        (generated) =>
          ({
            subject: sanitizeCommitSubject(generated.subject),
            body: generated.body.trim(),
            ...("branch" in generated && typeof generated.branch === "string"
              ? { branch: sanitizeFeatureBranchName(generated.branch) }
              : {}),
          }) satisfies CommitMessageGenerationResult,
      ),
    );
  };

  const generatePrContent: TextGenerationShape["generatePrContent"] = (input) => {
    const prompt = [
      "You write GitHub pull request content.",
      "Return a JSON object with keys: title, body.",
      "Rules:",
      "- title should be concise and specific",
      "- body must be markdown and include headings '## Summary' and '## Testing'",
      "- under Summary, provide short bullet points",
      "- under Testing, include bullet points with concrete checks or 'Not run' where appropriate",
      "",
      `Base branch: ${input.baseBranch}`,
      `Head branch: ${input.headBranch}`,
      "",
      "Commits:",
      limitSection(input.commitSummary, 12_000),
      "",
      "Diff stat:",
      limitSection(input.diffSummary, 12_000),
      "",
      "Diff patch:",
      limitSection(input.diffPatch, 40_000),
    ].join("\n");

    return runCodexJson({
      operation: "generatePrContent",
      cwd: input.cwd,
      ...(input.remote ? { remote: input.remote } : {}),
      prompt,
      outputSchemaJson: Schema.Struct({
        title: Schema.String,
        body: Schema.String,
      }),
      ...(input.model ? { model: input.model } : {}),
    }).pipe(
      Effect.map(
        (generated) =>
          ({
            title: sanitizePrTitle(generated.title),
            body: generated.body.trim(),
          }) satisfies PrContentGenerationResult,
      ),
    );
  };

  const generateBranchName: TextGenerationShape["generateBranchName"] = (input) => {
    return Effect.gen(function* () {
      const { imagePaths } = yield* materializeImageAttachments(
        "generateBranchName",
        input.attachments,
      );
      const attachmentLines = (input.attachments ?? []).map(
        (attachment) =>
          `- ${attachment.name} (${attachment.mimeType}, ${attachment.sizeBytes} bytes)`,
      );

      const promptSections = [
        "You generate concise git branch names.",
        "Return a JSON object with key: branch.",
        "Rules:",
        "- Branch should describe the requested work from the user message.",
        "- Keep it short and specific (2-6 words).",
        "- Use plain words only, no issue prefixes and no punctuation-heavy text.",
        "- If images are attached, use them as primary context for visual/UI issues.",
        "",
        "User message:",
        limitSection(input.message, 8_000),
      ];
      if (attachmentLines.length > 0) {
        promptSections.push(
          "",
          "Attachment metadata:",
          limitSection(attachmentLines.join("\n"), 4_000),
        );
      }
      const prompt = promptSections.join("\n");

      const generated = yield* runCodexJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        ...(input.remote ? { remote: input.remote } : {}),
        prompt,
        outputSchemaJson: Schema.Struct({
          branch: Schema.String,
        }),
        imagePaths,
        ...(input.model ? { model: input.model } : {}),
      });

      return {
        branch: sanitizeBranchFragment(generated.branch),
      } satisfies BranchNameGenerationResult;
    });
  };

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
  } satisfies TextGenerationShape;
});

export const CodexTextGenerationLive = Layer.effect(TextGeneration, makeCodexTextGeneration);
