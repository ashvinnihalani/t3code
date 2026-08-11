import type {
  AppServerDesktopSettings,
  DiscoveredSshHost,
} from "../../../packages/effect-codex-app-server/src/connection.ts";
import { contextBridge, ipcRenderer } from "electron";

import * as IpcChannels from "./ipc/channels.ts";

export interface AppServerDesktopBridge {
  readonly getAppServerSettings: () => Promise<AppServerDesktopSettings>;
  readonly saveAppServerSettings: (
    settings: AppServerDesktopSettings,
  ) => Promise<AppServerDesktopSettings>;
  readonly discoverSshHosts: () => Promise<ReadonlyArray<DiscoveredSshHost>>;
  readonly connectAppServer: (
    settings: AppServerDesktopSettings,
    onPort: (port: MessagePort) => void,
    onError: (message: string) => void,
  ) => () => void;
}

const bridge: AppServerDesktopBridge = {
  getAppServerSettings: () => ipcRenderer.invoke(IpcChannels.APP_SERVER_SETTINGS_GET_CHANNEL),
  saveAppServerSettings: (settings) =>
    ipcRenderer.invoke(IpcChannels.APP_SERVER_SETTINGS_SET_CHANNEL, settings),
  discoverSshHosts: () => ipcRenderer.invoke(IpcChannels.SSH_HOSTS_DISCOVER_CHANNEL),
  connectAppServer: (settings, onPort, onError) => {
    const handlePort = (event: Electron.IpcRendererEvent) => {
      const port = event.ports[0];
      if (port !== undefined) onPort(port);
    };
    const handleError = (_event: Electron.IpcRendererEvent, message: unknown) => {
      onError(typeof message === "string" ? message : "The app-server process failed.");
    };

    ipcRenderer.once(IpcChannels.APP_SERVER_PORT_CHANNEL, handlePort);
    ipcRenderer.on(IpcChannels.APP_SERVER_ERROR_CHANNEL, handleError);
    ipcRenderer.send(IpcChannels.APP_SERVER_CONNECT_CHANNEL, settings);

    return () => {
      ipcRenderer.removeListener(IpcChannels.APP_SERVER_PORT_CHANNEL, handlePort);
      ipcRenderer.removeListener(IpcChannels.APP_SERVER_ERROR_CHANNEL, handleError);
    };
  },
};

contextBridge.exposeInMainWorld("desktopBridge", bridge);
