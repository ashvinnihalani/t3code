import type { IpcMain, IpcMainInvokeEvent, OpenDialogOptions } from "electron";
import { BrowserWindow, dialog } from "electron";

import { PROJECT_DIRECTORY_SELECT_CHANNEL } from "./ipc/channels.ts";

export function registerProjectDirectoryIpc(ipcMain: IpcMain): () => void {
  const selectDirectory = async (event: IpcMainInvokeEvent, value: unknown) => {
    const defaultPath = typeof value === "string" && value.trim() ? value.trim() : undefined;
    const options: OpenDialogOptions = {
      title: "Add project",
      buttonLabel: "Add project",
      properties: ["openDirectory", "createDirectory"],
      ...(defaultPath ? { defaultPath } : {}),
    };
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  };

  ipcMain.handle(PROJECT_DIRECTORY_SELECT_CHANNEL, selectDirectory);
  return () => ipcMain.removeHandler(PROJECT_DIRECTORY_SELECT_CHANNEL);
}
