import * as NodeFS from "node:fs/promises";
import * as NodePath from "node:path";

import type { AppServerDesktopSettings } from "../../../../packages/effect-codex-app-server/src/connection.ts";

import { defaultAppServerDesktopSettings, parseAppServerDesktopSettings } from "./configuration.ts";

const SETTINGS_FILE_NAME = "app-server-settings.json";

export interface AppServerSettingsStore {
  readonly read: () => Promise<AppServerDesktopSettings>;
  readonly write: (value: unknown) => Promise<AppServerDesktopSettings>;
}

export function makeAppServerSettingsStore(
  userDataDirectory: string,
  environment: NodeJS.ProcessEnv,
  defaultCwd: string,
): AppServerSettingsStore {
  const settingsPath = NodePath.join(userDataDirectory, SETTINGS_FILE_NAME);
  const defaults = defaultAppServerDesktopSettings(environment, defaultCwd);

  const read = async () => {
    try {
      return parseAppServerDesktopSettings(JSON.parse(await NodeFS.readFile(settingsPath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaults;
      throw error;
    }
  };

  const write = async (value: unknown) => {
    const settings = parseAppServerDesktopSettings(value);
    await NodeFS.mkdir(userDataDirectory, { recursive: true });
    const temporaryPath = `${settingsPath}.${process.pid}.tmp`;
    await NodeFS.writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await NodeFS.rename(temporaryPath, settingsPath);
    return settings;
  };

  return { read, write };
}
