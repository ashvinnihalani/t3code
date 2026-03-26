import fs from "node:fs/promises";
import path from "node:path";

import type {
  EnvironmentDefinition,
  EnvironmentFileLocation,
  ProjectEnvironmentConfig,
} from "@t3tools/contracts";

interface ResolveEnvironmentConfigPathInput {
  readonly fileLocation: EnvironmentFileLocation;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly baseDir: string;
}

function encodeTomlString(value: string): string {
  return JSON.stringify(value);
}

function parseTomlString(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return JSON.parse(trimmed);
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseStringArray(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed === "[]") return [];
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw new Error("Expected array value.");
  }
  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) return [];
  return inner
    .split(",")
    .map((entry) => parseTomlString(entry))
    .filter((entry) => entry.length > 0);
}

export function resolveEnvironmentConfigPath(input: ResolveEnvironmentConfigPathInput): string {
  if (input.fileLocation === "project") {
    return path.join(input.projectRoot, ".t3", "environment.toml");
  }
  return path.join(input.baseDir, input.projectId, "environment.toml");
}

export function stringifyProjectEnvironmentConfig(config: ProjectEnvironmentConfig): string {
  const lines: string[] = [];
  lines.push("version = 1");
  lines.push("");
  lines.push("[defaults]");
  lines.push(
    `selected_environment_id = ${
      config.defaults.selectedEnvironmentId === null
        ? "null"
        : encodeTomlString(config.defaults.selectedEnvironmentId)
    }`,
  );

  for (const environment of config.environments) {
    lines.push("");
    lines.push("[[environments]]");
    lines.push(`id = ${encodeTomlString(environment.id)}`);
    lines.push(`name = ${encodeTomlString(environment.name)}`);
    lines.push(`category = ${encodeTomlString(environment.category)}`);
    lines.push(`mode = ${encodeTomlString(environment.mode)}`);
    lines.push(
      `startup_action_ids = [${environment.startupActionIds
        .map((actionId) => encodeTomlString(actionId))
        .join(", ")}]`,
    );
    lines.push(`runtime_mode = ${encodeTomlString(environment.runtimeMode)}`);
    lines.push(`created_at = ${encodeTomlString(environment.createdAt)}`);
    lines.push(`updated_at = ${encodeTomlString(environment.updatedAt)}`);
  }

  return `${lines.join("\n")}\n`;
}

export function parseProjectEnvironmentConfig(contents: string): ProjectEnvironmentConfig {
  let version: 1 | null = null;
  let selectedEnvironmentId: string | null = null;
  const environments: EnvironmentDefinition[] = [];
  let section: "root" | "defaults" | "environment" = "root";
  let currentEnvironment: {
    id?: string;
    name?: string;
    category?: EnvironmentDefinition["category"];
    mode?: EnvironmentDefinition["mode"];
    startupActionIds?: string[];
    runtimeMode?: EnvironmentDefinition["runtimeMode"];
    createdAt?: string;
    updatedAt?: string;
  } | null = null;

  const commitEnvironment = () => {
    if (!currentEnvironment) return;
    const requiredKeys = [
      "id",
      "name",
      "category",
      "mode",
      "startupActionIds",
      "runtimeMode",
      "createdAt",
      "updatedAt",
    ] as const;
    for (const key of requiredKeys) {
      if (currentEnvironment[key] === undefined) {
        throw new Error(`Environment is missing required key '${key}'.`);
      }
    }
    environments.push(currentEnvironment as EnvironmentDefinition);
  };

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    if (line === "[defaults]") {
      commitEnvironment();
      currentEnvironment = null;
      section = "defaults";
      continue;
    }
    if (line === "[[environments]]") {
      commitEnvironment();
      currentEnvironment = {};
      section = "environment";
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      throw new Error(`Invalid TOML line '${line}'.`);
    }
    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim();

    if (section === "root") {
      if (key === "version") {
        if (value !== "1") {
          throw new Error("Unsupported environment config version.");
        }
        version = 1;
        continue;
      }
      throw new Error(`Unexpected root key '${key}'.`);
    }

    if (section === "defaults") {
      if (key === "selected_environment_id") {
        selectedEnvironmentId = value === "null" ? null : parseTomlString(value);
        continue;
      }
      throw new Error(`Unexpected defaults key '${key}'.`);
    }

    if (!currentEnvironment) {
      throw new Error("Encountered environment key without environment section.");
    }

    switch (key) {
      case "id":
        currentEnvironment.id = parseTomlString(value);
        break;
      case "name":
        currentEnvironment.name = parseTomlString(value);
        break;
      case "category":
        currentEnvironment.category = parseTomlString(value) as EnvironmentDefinition["category"];
        break;
      case "mode":
        currentEnvironment.mode = parseTomlString(value) as EnvironmentDefinition["mode"];
        break;
      case "startup_action_ids":
        currentEnvironment.startupActionIds = parseStringArray(value);
        break;
      case "runtime_mode":
        currentEnvironment.runtimeMode = parseTomlString(
          value,
        ) as EnvironmentDefinition["runtimeMode"];
        break;
      case "created_at":
        currentEnvironment.createdAt = parseTomlString(value);
        break;
      case "updated_at":
        currentEnvironment.updatedAt = parseTomlString(value);
        break;
      default:
        throw new Error(`Unexpected environment key '${key}'.`);
    }
  }

  commitEnvironment();

  if (version !== 1) {
    throw new Error("Environment config is missing version = 1.");
  }

  return {
    version: 1,
    defaults: {
      selectedEnvironmentId,
    },
    environments,
  };
}

export async function readEnvironmentConfigFile(
  pathname: string,
): Promise<ProjectEnvironmentConfig | null> {
  try {
    const contents = await fs.readFile(pathname, "utf8");
    return parseProjectEnvironmentConfig(contents);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeEnvironmentConfigFile(
  pathname: string,
  config: ProjectEnvironmentConfig,
): Promise<void> {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  const tempPath = `${pathname}.tmp`;
  await fs.writeFile(tempPath, stringifyProjectEnvironmentConfig(config), "utf8");
  await fs.rename(tempPath, pathname);
}

export async function migrateEnvironmentConfigFile(input: {
  readonly fromPath: string;
  readonly toPath: string;
}): Promise<boolean> {
  const config = await readEnvironmentConfigFile(input.fromPath);
  if (!config) {
    return false;
  }
  await writeEnvironmentConfigFile(input.toPath, config);
  await fs.rm(input.fromPath, { force: true });
  return true;
}
