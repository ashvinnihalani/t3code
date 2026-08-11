import type { DesktopBridge } from "@t3tools/contracts";
import { contextBridge, ipcRenderer } from "electron";

import * as IpcChannels from "./ipc/channels.ts";

const bridge = {
  connectAppServer: (onPort, onError) => {
    const handlePort = (event: Electron.IpcRendererEvent) => {
      const port = event.ports[0];
      if (port !== undefined) onPort(port);
    };
    const handleError = (_event: Electron.IpcRendererEvent, message: unknown) => {
      onError(typeof message === "string" ? message : "The app-server process failed.");
    };

    ipcRenderer.once(IpcChannels.APP_SERVER_PORT_CHANNEL, handlePort);
    ipcRenderer.on(IpcChannels.APP_SERVER_ERROR_CHANNEL, handleError);
    ipcRenderer.send(IpcChannels.APP_SERVER_CONNECT_CHANNEL);

    return () => {
      ipcRenderer.removeListener(IpcChannels.APP_SERVER_PORT_CHANNEL, handlePort);
      ipcRenderer.removeListener(IpcChannels.APP_SERVER_ERROR_CHANNEL, handleError);
    };
  },
} satisfies Pick<DesktopBridge, "connectAppServer">;

contextBridge.exposeInMainWorld("desktopBridge", bridge);
