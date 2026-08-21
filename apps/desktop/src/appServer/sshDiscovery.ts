import type { DiscoveredSshHost } from "effect-codex-app-server/connection";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";

function withoutComment(line: string): string {
  return (line.includes("#") ? line.slice(0, line.indexOf("#")) : line).trim();
}

function directiveParts(line: string): ReadonlyArray<string> {
  return line
    .replace(/=(?!=)/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

function isConcreteHost(value: string): boolean {
  return value.length > 0 && !value.startsWith("!") && !value.includes("*") && !value.includes("?");
}

const readOptional = (
  fileSystem: FileSystem.FileSystem,
  filePath: string,
): Effect.Effect<string | null, PlatformError.PlatformError> =>
  fileSystem
    .readFileString(filePath)
    .pipe(
      Effect.catch((error) =>
        error.reason._tag === "NotFound" ? Effect.succeed<string | null>(null) : Effect.fail(error),
      ),
    );

function configAliases(input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly filePath: string;
  readonly sshDirectory: string;
  readonly homeDirectory: string;
  readonly visited: Set<string>;
}): Effect.Effect<ReadonlyArray<string>, PlatformError.PlatformError> {
  return Effect.gen(function* () {
    const resolvedPath = input.path.resolve(input.filePath);
    if (input.visited.has(resolvedPath)) return [] as ReadonlyArray<string>;
    input.visited.add(resolvedPath);
    const raw = yield* readOptional(input.fileSystem, resolvedPath);
    if (raw === null) return [];

    const aliases = new Set<string>();
    for (const line of raw.split(/\r?\n/u)) {
      const [directive = "", ...args] = directiveParts(withoutComment(line));
      if (directive.toLowerCase() === "host") {
        for (const alias of args) if (isConcreteHost(alias)) aliases.add(alias);
        continue;
      }
      if (directive.toLowerCase() !== "include") continue;

      for (const pattern of args) {
        const expanded = pattern.replace(/^~(?=$|\/|\\)/u, input.homeDirectory);
        const absolute = input.path.isAbsolute(expanded)
          ? expanded
          : input.path.resolve(input.sshDirectory, expanded);
        const includedPaths = yield* input.fileSystem.glob(absolute);
        for (const includedPath of includedPaths) {
          const included = yield* configAliases({ ...input, filePath: includedPath });
          for (const alias of included) aliases.add(alias);
        }
      }
    }
    return [...aliases];
  });
}

export function knownHostAliases(raw: string): ReadonlyArray<string> {
  const aliases = new Set<string>();
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const fields = trimmed.split(/\s+/u);
    const hostField = trimmed.startsWith("@") ? fields[1] : fields[0];
    if (!hostField || hostField.startsWith("|")) continue;
    for (const entry of hostField.split(",")) {
      const bracketed = /^\[([^\]]+)\]:\d+$/u.exec(entry)?.[1];
      const host = bracketed ?? entry;
      if (isConcreteHost(host)) aliases.add(host);
    }
  }
  return [...aliases];
}

export const discoverSshHosts = Effect.fn("desktop.appServer.discoverSshHosts")(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly homeDirectory: string;
}) {
  const sshDirectory = input.path.join(input.homeDirectory, ".ssh");
  const aliases = new Map<string, DiscoveredSshHost>();
  const configured = yield* configAliases({
    ...input,
    filePath: input.path.join(sshDirectory, "config"),
    sshDirectory,
    visited: new Set(),
  });
  for (const alias of configured) aliases.set(alias, { alias, source: "ssh-config" });

  const knownHosts = yield* readOptional(
    input.fileSystem,
    input.path.join(sshDirectory, "known_hosts"),
  );
  if (knownHosts !== null) {
    for (const alias of knownHostAliases(knownHosts)) {
      if (!aliases.has(alias)) aliases.set(alias, { alias, source: "known-hosts" });
    }
  }
  return [...aliases.values()].toSorted((left, right) => left.alias.localeCompare(right.alias));
});
