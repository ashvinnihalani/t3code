/// <reference types="vite-plus/client" />

import type {
  AppServerConnectionProfile,
  AppServerDesktopSettings,
  DiscoveredSshHost,
  WorkspaceOpenRequest,
  WorkspaceOpenResult,
  WorkspaceOpener,
} from "effect-codex-app-server/connection";

interface ImportMetaEnv {
  readonly APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface AppServerDesktopBridge {
  readonly appServerPortMessage: string;
  readonly getAppServerSettings: () => Promise<AppServerDesktopSettings>;
  readonly saveAppServerSettings: (
    settings: AppServerDesktopSettings,
  ) => Promise<AppServerDesktopSettings>;
  readonly discoverSshHosts: () => Promise<ReadonlyArray<DiscoveredSshHost>>;
  readonly selectProjectDirectory: (defaultPath: string) => Promise<string | null>;
  readonly listWorkspaceOpeners: (
    profile: AppServerConnectionProfile,
  ) => Promise<ReadonlyArray<WorkspaceOpener>>;
  readonly openWorkspace: (request: WorkspaceOpenRequest) => Promise<WorkspaceOpenResult>;
  readonly showContextMenu: <T extends string>(
    items: ReadonlyArray<{
      readonly id: T;
      readonly label: string;
      readonly destructive?: boolean;
      readonly disabled?: boolean;
      readonly separatorBefore?: boolean;
    }>,
    position?: { readonly x: number; readonly y: number },
  ) => Promise<T | null>;
  readonly connectAppServer: (
    profile: AppServerConnectionProfile,
    onError: (message: string) => void,
  ) => () => void;
}

declare global {
  interface Window {
    desktopBridge?: AppServerDesktopBridge;
  }
}
