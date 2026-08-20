import type {
  AppServerConnectionProfile,
  AppServerDesktopSettings,
  DiscoveredSshHost,
} from "../../../packages/effect-codex-app-server/src/connection.ts";
import { contextBridge, ipcRenderer } from "electron";

import * as IpcChannels from "./ipc/channels.ts";

export interface AppServerDesktopBridge {
  readonly appServerPortMessage: string;
  readonly getAppServerSettings: () => Promise<AppServerDesktopSettings>;
  readonly saveAppServerSettings: (
    settings: AppServerDesktopSettings,
  ) => Promise<AppServerDesktopSettings>;
  readonly discoverSshHosts: () => Promise<ReadonlyArray<DiscoveredSshHost>>;
  readonly selectProjectDirectory: (defaultPath: string) => Promise<string | null>;
  readonly connectAppServer: (
    profile: AppServerConnectionProfile,
    onError: (message: string) => void,
  ) => () => void;
}

const bridge: AppServerDesktopBridge = {
  appServerPortMessage: IpcChannels.APP_SERVER_PORT_CHANNEL,
  getAppServerSettings: () => ipcRenderer.invoke(IpcChannels.APP_SERVER_SETTINGS_GET_CHANNEL),
  saveAppServerSettings: (settings) =>
    ipcRenderer.invoke(IpcChannels.APP_SERVER_SETTINGS_SET_CHANNEL, settings),
  discoverSshHosts: () => ipcRenderer.invoke(IpcChannels.SSH_HOSTS_DISCOVER_CHANNEL),
  selectProjectDirectory: (defaultPath) =>
    ipcRenderer.invoke(IpcChannels.PROJECT_DIRECTORY_SELECT_CHANNEL, defaultPath),
  connectAppServer: (profile, onError) => {
    const handlePort = (event: Electron.IpcRendererEvent, value: unknown) => {
      if (
        typeof value !== "object" ||
        value === null ||
        !("connectionId" in value) ||
        value.connectionId !== profile.id
      ) {
        return;
      }
      const port = event.ports[0];
      if (port !== undefined) {
        ipcRenderer.removeListener(IpcChannels.APP_SERVER_PORT_CHANNEL, handlePort);
        window.postMessage(
          { type: IpcChannels.APP_SERVER_PORT_CHANNEL, connectionId: profile.id },
          "*",
          [port],
        );
      }
    };
    const handleError = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (
        typeof value !== "object" ||
        value === null ||
        !("connectionId" in value) ||
        value.connectionId !== profile.id
      ) {
        return;
      }
      onError(
        "message" in value && typeof value.message === "string"
          ? value.message
          : "The app-server process failed.",
      );
    };

    ipcRenderer.on(IpcChannels.APP_SERVER_PORT_CHANNEL, handlePort);
    ipcRenderer.on(IpcChannels.APP_SERVER_ERROR_CHANNEL, handleError);
    ipcRenderer.send(IpcChannels.APP_SERVER_CONNECT_CHANNEL, profile);

    return () => {
      ipcRenderer.removeListener(IpcChannels.APP_SERVER_PORT_CHANNEL, handlePort);
      ipcRenderer.removeListener(IpcChannels.APP_SERVER_ERROR_CHANNEL, handleError);
    };
  },
};

contextBridge.exposeInMainWorld("desktopBridge", bridge);
