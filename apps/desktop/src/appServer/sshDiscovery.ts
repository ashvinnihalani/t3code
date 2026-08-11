import * as NodeFS from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { DiscoveredSshHost } from "../../../../packages/effect-codex-app-server/src/connection.ts";

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

async function configAliases(
  filePath: string,
  sshDirectory: string,
  visited: Set<string>,
): Promise<ReadonlyArray<string>> {
  const resolvedPath = NodePath.resolve(filePath);
  if (visited.has(resolvedPath)) return [];
  visited.add(resolvedPath);

  let raw: string;
  try {
    raw = await NodeFS.readFile(resolvedPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const aliases = new Set<string>();
  for (const line of raw.split(/\r?\n/u)) {
    const [directive = "", ...args] = directiveParts(withoutComment(line));
    if (directive.toLowerCase() === "host") {
      for (const alias of args) if (isConcreteHost(alias)) aliases.add(alias);
      continue;
    }
    if (directive.toLowerCase() !== "include") continue;

    for (const pattern of args) {
      const expanded = pattern.replace(/^~(?=$|\/|\\)/u, NodeOS.homedir());
      const absolute = NodePath.isAbsolute(expanded)
        ? expanded
        : NodePath.resolve(sshDirectory, expanded);
      for await (const includedPath of NodeFS.glob(absolute)) {
        for (const alias of await configAliases(includedPath, sshDirectory, visited)) {
          aliases.add(alias);
        }
      }
    }
  }
  return [...aliases];
}

function knownHostAliases(raw: string): ReadonlyArray<string> {
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

export async function discoverSshHosts(
  homeDirectory: string = NodeOS.homedir(),
): Promise<ReadonlyArray<DiscoveredSshHost>> {
  const sshDirectory = NodePath.join(homeDirectory, ".ssh");
  const aliases = new Map<string, DiscoveredSshHost>();
  for (const alias of await configAliases(
    NodePath.join(sshDirectory, "config"),
    sshDirectory,
    new Set<string>(),
  )) {
    aliases.set(alias, { alias, source: "ssh-config" });
  }

  try {
    const knownHosts = await NodeFS.readFile(NodePath.join(sshDirectory, "known_hosts"), "utf8");
    for (const alias of knownHostAliases(knownHosts)) {
      if (!aliases.has(alias)) aliases.set(alias, { alias, source: "known-hosts" });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return [...aliases.values()].toSorted((left, right) => left.alias.localeCompare(right.alias));
}
