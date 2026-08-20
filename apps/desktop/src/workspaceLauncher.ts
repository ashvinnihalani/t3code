import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import * as NodePath from "node:path";

import type { IpcMain } from "electron";
import { shell } from "electron";

import type {
  AppServerConnectionSettings,
  AppServerConnectionProfile,
  WorkspaceOpenRequest,
  WorkspaceOpenResult,
  WorkspaceOpener,
  WorkspaceOpenerId,
} from "../../../packages/effect-codex-app-server/src/connection.ts";
import { WORKSPACE_OPENER_IDS } from "../../../packages/effect-codex-app-server/src/connection.ts";
import {
  parseAppServerConnectionProfile,
  parseAppServerConnectionSettings,
} from "./appServer/configuration.ts";
import { WORKSPACE_OPEN_CHANNEL, WORKSPACE_OPENERS_LIST_CHANNEL } from "./ipc/channels.ts";

interface EditorDefinition {
  readonly id: Exclude<WorkspaceOpenerId, "file-manager">;
  readonly label: string;
  readonly commands: ReadonlyArray<string>;
  readonly macApplicationCommands: ReadonlyArray<string>;
}

const EDITORS: ReadonlyArray<EditorDefinition> = [
  {
    id: "cursor",
    label: "Cursor",
    commands: ["cursor"],
    macApplicationCommands: ["/Applications/Cursor.app/Contents/Resources/app/bin/cursor"],
  },
  {
    id: "vscode",
    label: "VS Code",
    commands: ["code"],
    macApplicationCommands: [
      "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    ],
  },
  {
    id: "zed",
    label: "Zed",
    commands: ["zed", "zeditor"],
    macApplicationCommands: ["/Applications/Zed.app/Contents/MacOS/cli"],
  },
];

const FILE_MANAGER_LABEL: Readonly<Record<NodeJS.Platform, string>> = {
  aix: "Files",
  android: "Files",
  darwin: "Finder",
  freebsd: "Files",
  haiku: "Files",
  linux: "Files",
  openbsd: "Files",
  sunos: "Files",
  win32: "Explorer",
  cygwin: "Explorer",
  netbsd: "Files",
};

interface ResolvedEditor extends WorkspaceOpener {
  readonly executable: string;
}

interface WorkspaceLauncherDependencies {
  readonly platform: NodeJS.Platform;
  readonly environment: NodeJS.ProcessEnv;
  readonly openPath: (path: string) => Promise<string>;
  readonly spawnDetached: (command: string, args: ReadonlyArray<string>) => Promise<void>;
  readonly canExecute: (path: string) => Promise<boolean>;
}

function executableSearchPaths(environment: NodeJS.ProcessEnv): ReadonlyArray<string> {
  return environment.PATH?.split(NodePath.delimiter).filter(Boolean) ?? [];
}

async function canExecute(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function spawnDetached(command: string, args: ReadonlyArray<string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function defaultDependencies(): WorkspaceLauncherDependencies {
  return {
    platform: process.platform,
    environment: process.env,
    openPath: (path) => shell.openPath(path),
    spawnDetached,
    canExecute,
  };
}

async function resolveEditor(
  editor: EditorDefinition,
  dependencies: WorkspaceLauncherDependencies,
): Promise<ResolvedEditor | null> {
  const pathCandidates = editor.commands.flatMap((command) =>
    executableSearchPaths(dependencies.environment).map((directory) =>
      NodePath.join(directory, command),
    ),
  );
  const candidates = [
    ...(dependencies.platform === "darwin" ? editor.macApplicationCommands : []),
    ...pathCandidates,
  ];
  const availability = await Promise.all(candidates.map(dependencies.canExecute));
  const executable = candidates.find((_candidate, index) => availability[index]);
  return executable ? { id: editor.id, label: editor.label, executable } : null;
}

async function resolveEditors(
  dependencies: WorkspaceLauncherDependencies,
): Promise<ReadonlyArray<ResolvedEditor>> {
  const resolved = await Promise.all(EDITORS.map((editor) => resolveEditor(editor, dependencies)));
  return resolved.filter((editor): editor is ResolvedEditor => editor !== null);
}

export async function listWorkspaceOpeners(
  connection: AppServerConnectionSettings,
  dependencies: WorkspaceLauncherDependencies = defaultDependencies(),
): Promise<ReadonlyArray<WorkspaceOpener>> {
  const editors = (await resolveEditors(dependencies)).map(({ id, label }) => ({ id, label }));
  return connection.kind === "local"
    ? [
        ...editors,
        {
          id: "file-manager" as const,
          label: FILE_MANAGER_LABEL[dependencies.platform] ?? "Files",
        },
      ]
    : editors;
}

function remoteHost(connection: Extract<AppServerConnectionSettings, { kind: "ssh" }>): string {
  return connection.username ? `${connection.username}@${connection.host}` : connection.host;
}

export function editorArguments(
  request: WorkspaceOpenRequest,
  opener: Exclude<WorkspaceOpenerId, "file-manager">,
): ReadonlyArray<string> {
  if (request.connection.kind === "local") return [request.cwd];
  const host = remoteHost(request.connection);
  if (opener === "zed") return [`ssh://${host}${request.cwd}`];
  const path = request.cwd.endsWith("/") ? request.cwd : `${request.cwd}/`;
  return ["--remote", `ssh-remote+${host}`, path];
}

function isWorkspaceOpenerId(value: unknown): value is WorkspaceOpenerId {
  return WORKSPACE_OPENER_IDS.some((candidate) => candidate === value);
}

function parseRequest(value: unknown): WorkspaceOpenRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Workspace open request must be an object.");
  }
  const request = value as Partial<WorkspaceOpenRequest>;
  const cwd = typeof request.cwd === "string" ? request.cwd.trim() : "";
  if (!cwd) throw new Error("Workspace path must be a non-empty string.");
  const opener = request.opener;
  if (!isWorkspaceOpenerId(opener)) {
    throw new Error("Unknown workspace opener.");
  }
  return {
    connection: parseAppServerConnectionSettings(request.connection),
    cwd,
    opener,
  };
}

export async function openWorkspace(
  value: unknown,
  dependencies: WorkspaceLauncherDependencies = defaultDependencies(),
): Promise<WorkspaceOpenResult> {
  try {
    const request = parseRequest(value);
    if (request.opener === "file-manager") {
      if (request.connection.kind !== "local") {
        throw new Error("The file manager cannot open an SSH workspace.");
      }
      const error = await dependencies.openPath(request.cwd);
      if (error) throw new Error(error);
      return { ok: true };
    }

    const editor = (await resolveEditors(dependencies)).find(
      (candidate) => candidate.id === request.opener,
    );
    if (editor === undefined) throw new Error(`${request.opener} is not installed.`);
    await dependencies.spawnDetached(editor.executable, editorArguments(request, request.opener));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function registerWorkspaceLauncherIpc(
  ipcMain: IpcMain,
  dependencies: WorkspaceLauncherDependencies = defaultDependencies(),
): () => void {
  ipcMain.handle(WORKSPACE_OPENERS_LIST_CHANNEL, async (_event, value: unknown) => {
    const profile: AppServerConnectionProfile = parseAppServerConnectionProfile(value);
    return listWorkspaceOpeners(profile.connection, dependencies);
  });
  ipcMain.handle(WORKSPACE_OPEN_CHANNEL, (_event, value: unknown) =>
    openWorkspace(value, dependencies),
  );
  return () => {
    ipcMain.removeHandler(WORKSPACE_OPENERS_LIST_CHANNEL);
    ipcMain.removeHandler(WORKSPACE_OPEN_CHANNEL);
  };
}
