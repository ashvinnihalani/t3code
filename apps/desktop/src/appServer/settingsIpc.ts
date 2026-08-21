import type { IpcMain } from "electron";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import {
  APP_SERVER_SETTINGS_GET_CHANNEL,
  APP_SERVER_SETTINGS_SET_CHANNEL,
  APP_SERVER_SSH_HOSTS_CHANNEL,
} from "../ipc/channels.ts";
import { defaultAppServerDesktopSettings } from "./configuration.ts";
import { makeAppServerSettingsStore } from "./settingsStore.ts";
import { discoverSshHosts } from "./sshDiscovery.ts";

export const registerAppServerSettingsIpc = Effect.fn("desktop.appServer.registerSettingsIpc")(
  function* (ipcMain: IpcMain) {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const processEnvironment = yield* HostProcessEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const context = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(context);
    const store = makeAppServerSettingsStore({
      fileSystem,
      path,
      settingsPath: path.join(environment.stateDir, "app-server-settings.json"),
      defaults: defaultAppServerDesktopSettings(processEnvironment, environment.homeDirectory),
    });

    const getSettings = () => runPromise(store.read);
    const setSettings = (_event: Electron.IpcMainInvokeEvent, value: unknown) =>
      runPromise(store.write(value));
    const findSshHosts = () =>
      runPromise(discoverSshHosts({ fileSystem, path, homeDirectory: environment.homeDirectory }));

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        ipcMain.handle(APP_SERVER_SETTINGS_GET_CHANNEL, getSettings);
        ipcMain.handle(APP_SERVER_SETTINGS_SET_CHANNEL, setSettings);
        ipcMain.handle(APP_SERVER_SSH_HOSTS_CHANNEL, findSshHosts);
      }),
      () =>
        Effect.sync(() => {
          ipcMain.removeHandler(APP_SERVER_SETTINGS_GET_CHANNEL);
          ipcMain.removeHandler(APP_SERVER_SETTINGS_SET_CHANNEL);
          ipcMain.removeHandler(APP_SERVER_SSH_HOSTS_CHANNEL);
        }),
    );
  },
);
