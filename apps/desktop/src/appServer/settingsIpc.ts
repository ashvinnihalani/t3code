import type { IpcMain } from "electron";

import {
  APP_SERVER_SETTINGS_GET_CHANNEL,
  APP_SERVER_SETTINGS_SET_CHANNEL,
  SSH_HOSTS_DISCOVER_CHANNEL,
} from "../ipc/channels.ts";
import type { AppServerSettingsStore } from "./settingsStore.ts";
import { discoverSshHosts } from "./sshDiscovery.ts";

export function registerAppServerSettingsIpc(
  ipcMain: IpcMain,
  store: AppServerSettingsStore,
): () => void {
  ipcMain.handle(APP_SERVER_SETTINGS_GET_CHANNEL, () => store.read());
  ipcMain.handle(APP_SERVER_SETTINGS_SET_CHANNEL, (_event, value: unknown) => store.write(value));
  ipcMain.handle(SSH_HOSTS_DISCOVER_CHANNEL, () => discoverSshHosts());

  return () => {
    ipcMain.removeHandler(APP_SERVER_SETTINGS_GET_CHANNEL);
    ipcMain.removeHandler(APP_SERVER_SETTINGS_SET_CHANNEL);
    ipcMain.removeHandler(SSH_HOSTS_DISCOVER_CHANNEL);
  };
}
