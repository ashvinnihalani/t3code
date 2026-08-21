import type { EditorId } from "@t3tools/contracts";
import type { AppServerConnectionProfile } from "effect-codex-app-server/connection";
import type { IpcMain } from "electron";
import { shell } from "electron";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  APP_SERVER_WORKSPACE_OPEN_CHANNEL,
  APP_SERVER_WORKSPACE_OPENERS_CHANNEL,
} from "../ipc/channels.ts";
import { parseAppServerConnectionProfile } from "./configuration.ts";

interface EditorDefinition {
  readonly id: Extract<EditorId, "cursor" | "vscode" | "zed">;
  readonly commands: ReadonlyArray<string>;
  readonly macApplicationCommands: ReadonlyArray<string>;
}

const EDITORS: ReadonlyArray<EditorDefinition> = [
  {
    id: "cursor",
    commands: ["cursor"],
    macApplicationCommands: ["/Applications/Cursor.app/Contents/Resources/app/bin/cursor"],
  },
  {
    id: "vscode",
    commands: ["code"],
    macApplicationCommands: [
      "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    ],
  },
  {
    id: "zed",
    commands: ["zed", "zeditor"],
    macApplicationCommands: ["/Applications/Zed.app/Contents/MacOS/cli"],
  },
];

interface ResolvedEditor extends EditorDefinition {
  readonly executable: string;
}

export interface WorkspaceLauncherDependencies {
  readonly platform: NodeJS.Platform;
  readonly environment: NodeJS.ProcessEnv;
  readonly openPath: (path: string) => Promise<string>;
  readonly spawnDetached: (command: string, args: ReadonlyArray<string>) => Promise<void>;
  readonly canExecute: (path: string) => Promise<boolean>;
  readonly joinPath: (...paths: ReadonlyArray<string>) => string;
}

function executableSearchPaths(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): ReadonlyArray<string> {
  return environment.PATH?.split(platform === "win32" ? ";" : ":").filter(Boolean) ?? [];
}

async function resolveEditors(
  dependencies: WorkspaceLauncherDependencies,
): Promise<ReadonlyArray<ResolvedEditor>> {
  const searchPaths = executableSearchPaths(dependencies.environment, dependencies.platform);
  const resolved = await Promise.all(
    EDITORS.map(async (editor): Promise<ResolvedEditor | null> => {
      const candidates = [
        ...(dependencies.platform === "darwin" ? editor.macApplicationCommands : []),
        ...editor.commands.flatMap((command) =>
          searchPaths.map((directory) => dependencies.joinPath(directory, command)),
        ),
      ];
      const availability = await Promise.all(candidates.map(dependencies.canExecute));
      const executable = candidates.find((_candidate, index) => availability[index]);
      return executable === undefined ? null : { ...editor, executable };
    }),
  );
  return resolved.filter((editor): editor is ResolvedEditor => editor !== null);
}

function remoteHost(profile: AppServerConnectionProfile): string {
  const connection = profile.connection;
  if (connection.kind !== "ssh") return "";
  return connection.username ? `${connection.username}@${connection.host}` : connection.host;
}

export function editorArguments(
  profile: AppServerConnectionProfile,
  cwd: string,
  editor: ResolvedEditor["id"],
): ReadonlyArray<string> {
  if (profile.connection.kind === "local") return [cwd];
  const host = remoteHost(profile);
  if (editor === "zed") return [`ssh://${host}${cwd}`];
  return ["--remote", `ssh-remote+${host}`, cwd.endsWith("/") ? cwd : `${cwd}/`];
}

export async function listWorkspaceOpeners(
  profileValue: unknown,
  dependencies: WorkspaceLauncherDependencies,
): Promise<ReadonlyArray<EditorId>> {
  const profile = parseAppServerConnectionProfile(profileValue);
  const editors = (await resolveEditors(dependencies)).map((editor) => editor.id);
  return profile.connection.kind === "local" ? [...editors, "file-manager"] : editors;
}

export async function openWorkspace(
  value: unknown,
  dependencies: WorkspaceLauncherDependencies,
): Promise<{ readonly ok: boolean; readonly error?: string }> {
  try {
    if (typeof value !== "object" || value === null) throw new Error("Invalid open request.");
    const request = value as {
      readonly profile?: unknown;
      readonly cwd?: unknown;
      readonly editor?: unknown;
    };
    const profile = parseAppServerConnectionProfile(request.profile);
    const cwd = typeof request.cwd === "string" ? request.cwd.trim() : "";
    if (cwd.length === 0) throw new Error("Workspace path must not be empty.");
    if (request.editor === "file-manager") {
      if (profile.connection.kind !== "local") {
        throw new Error("The file manager cannot open an SSH workspace.");
      }
      const error = await dependencies.openPath(cwd);
      if (error.length > 0) throw new Error(error);
      return { ok: true };
    }
    const editor = (await resolveEditors(dependencies)).find(
      (candidate) => candidate.id === request.editor,
    );
    if (editor === undefined) throw new Error(`${String(request.editor)} is not installed.`);
    await dependencies.spawnDetached(editor.executable, editorArguments(profile, cwd, editor.id));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export const registerWorkspaceLauncherIpc = Effect.fn(
  "desktop.appServer.registerWorkspaceLauncherIpc",
)(function* (ipcMain: IpcMain) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);
  const dependencies: WorkspaceLauncherDependencies = {
    platform: process.platform,
    environment: process.env,
    openPath: (target) => shell.openPath(target),
    joinPath: path.join,
    canExecute: (target) =>
      runPromise(
        fileSystem.access(target).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        ),
      ),
    spawnDetached: (command, args) =>
      runPromise(
        spawner
          .spawn(
            ChildProcess.make(command, args, {
              detached: true,
              stdin: "ignore",
              stdout: "ignore",
              stderr: "ignore",
            }),
          )
          .pipe(
            Effect.flatMap((handle) => handle.unref),
            Effect.asVoid,
            Effect.scoped,
          ),
      ),
  };
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      ipcMain.handle(APP_SERVER_WORKSPACE_OPENERS_CHANNEL, (_event, value) =>
        listWorkspaceOpeners(value, dependencies),
      );
      ipcMain.handle(APP_SERVER_WORKSPACE_OPEN_CHANNEL, (_event, value) =>
        openWorkspace(value, dependencies),
      );
    }),
    () =>
      Effect.sync(() => {
        ipcMain.removeHandler(APP_SERVER_WORKSPACE_OPENERS_CHANNEL);
        ipcMain.removeHandler(APP_SERVER_WORKSPACE_OPEN_CHANNEL);
      }),
  );
});
