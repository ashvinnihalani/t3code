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
