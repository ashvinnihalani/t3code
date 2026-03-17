import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SshHostSummary } from "@t3tools/contracts";

interface SshHostRecord {
  alias: string;
  hostname: string | null;
  user: string | null;
  port: number | null;
  sourcePath: string;
}

interface ListSshHostsOptions {
  configPath?: string;
  homeDir?: string;
}

const GLOB_META_PATTERN = /[*?]/;
const WILDCARD_HOST_PATTERN = /[*?!]/;

function stripQuotes(input: string): string {
  if (
    (input.startsWith('"') && input.endsWith('"')) ||
    (input.startsWith("'") && input.endsWith("'"))
  ) {
    return input.slice(1, -1);
  }
  return input;
}

function splitDirectiveArguments(input: string): string[] {
  return input
    .trim()
    .split(/\s+/)
    .map(stripQuotes)
    .filter((value) => value.length > 0);
}

function parsePort(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function isConcreteHostAlias(value: string): boolean {
  return value.length > 0 && !WILDCARD_HOST_PATTERN.test(value);
}

function expandHomePath(input: string, homeDir: string): string {
  if (input === "~") {
    return homeDir;
  }
  if (input.startsWith("~/")) {
    return path.join(homeDir, input.slice(2));
  }
  return input;
}

function wildcardSegmentToRegExp(segment: string): RegExp {
  const escaped = segment.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
}

async function expandGlobPattern(pattern: string): Promise<string[]> {
  const normalized = path.normalize(pattern);
  if (!GLOB_META_PATTERN.test(normalized)) {
    return [normalized];
  }

  const parsed = path.parse(normalized);
  const root = parsed.root || path.sep;
  const relative = normalized.slice(root.length);
  const segments = relative.split(path.sep).filter((segment) => segment.length > 0);

  const walk = async (currentDir: string, index: number): Promise<string[]> => {
    if (index >= segments.length) {
      return [currentDir];
    }

    const segment = segments[index];
    if (!segment) {
      return [];
    }

    if (!GLOB_META_PATTERN.test(segment)) {
      return walk(path.join(currentDir, segment), index + 1);
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
    const matcher = wildcardSegmentToRegExp(segment);
    const matches = entries.filter((entry) => matcher.test(entry.name));
    const nested = await Promise.all(
      matches.map((entry) => walk(path.join(currentDir, entry.name), index + 1)),
    );
    return nested.flat();
  };

  return walk(root, 0);
}

async function parseSshConfigFile(input: {
  filePath: string;
  homeDir: string;
  records: Map<string, SshHostRecord>;
  visitedFiles: Set<string>;
}): Promise<void> {
  const resolvedPath = path.resolve(input.filePath);
  if (input.visitedFiles.has(resolvedPath)) {
    return;
  }
  input.visitedFiles.add(resolvedPath);

  const contents = await fs.readFile(resolvedPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (contents === null) {
    return;
  }

  const currentSourcePath = resolvedPath;
  let currentAliases: string[] = [];

  for (const rawLine of contents.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const [directiveRaw] = trimmed.split(/\s+/, 1);
    if (!directiveRaw) {
      continue;
    }
    const directive = directiveRaw.toLowerCase();
    const value = trimmed.slice(directiveRaw.length).trim();
    if (value.length === 0) {
      continue;
    }

    if (directive === "include") {
      const includePatterns = splitDirectiveArguments(value);
      for (const includePattern of includePatterns) {
        const expandedPattern = expandHomePath(includePattern, input.homeDir);
        const absolutePattern = path.isAbsolute(expandedPattern)
          ? expandedPattern
          : path.resolve(path.dirname(resolvedPath), expandedPattern);
        const includePaths = await expandGlobPattern(absolutePattern);
        for (const includePath of includePaths) {
          await parseSshConfigFile({
            ...input,
            filePath: includePath,
          });
        }
      }
      continue;
    }

    if (directive === "host") {
      currentAliases = splitDirectiveArguments(value).filter(isConcreteHostAlias);
      for (const alias of currentAliases) {
        if (!input.records.has(alias)) {
          input.records.set(alias, {
            alias,
            hostname: null,
            user: null,
            port: null,
            sourcePath: currentSourcePath,
          });
        }
      }
      continue;
    }

    if (currentAliases.length === 0) {
      continue;
    }

    for (const alias of currentAliases) {
      const existing = input.records.get(alias);
      if (!existing) {
        continue;
      }

      if (directive === "hostname" && existing.hostname === null) {
        existing.hostname = stripQuotes(value);
      } else if (directive === "user" && existing.user === null) {
        existing.user = stripQuotes(value);
      } else if (directive === "port" && existing.port === null) {
        existing.port = parsePort(value);
      }
    }
  }
}

export async function listSshHosts(options: ListSshHostsOptions = {}): Promise<SshHostSummary[]> {
  const homeDir = options.homeDir ?? os.homedir();
  const configPath = options.configPath ?? path.join(homeDir, ".ssh", "config");
  const records = new Map<string, SshHostRecord>();
  const visitedFiles = new Set<string>();

  await parseSshConfigFile({
    filePath: configPath,
    homeDir,
    records,
    visitedFiles,
  });

  return Array.from(records.values())
    .toSorted((left, right) => left.alias.localeCompare(right.alias))
    .map((record) => ({
      alias: record.alias,
      hostname: record.hostname,
      user: record.user,
      port: record.port,
      sourcePath: record.sourcePath,
    }));
}
