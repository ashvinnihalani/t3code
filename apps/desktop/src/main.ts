for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") throw error;
  });
}

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeOS from "node:os";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";

import {
  HostProcessArchitecture,
  HostProcessEnvironment,
  HostProcessPlatform,
  HostProcessWorkingDirectory,
} from "@t3tools/shared/hostProcess";

import * as DesktopIpc from "./ipc/DesktopIpc.ts";
import * as ElectronApp from "./electron/ElectronApp.ts";
import * as ElectronDialog from "./electron/ElectronDialog.ts";
import * as ElectronMenu from "./electron/ElectronMenu.ts";
import * as ElectronProtocol from "./electron/ElectronProtocol.ts";
import * as ElectronShell from "./electron/ElectronShell.ts";
import * as ElectronTheme from "./electron/ElectronTheme.ts";
import * as ElectronWindow from "./electron/ElectronWindow.ts";
import * as DesktopApp from "./app/DesktopApp.ts";
import * as DesktopAppIdentity from "./app/DesktopAppIdentity.ts";
import * as DesktopApplicationMenu from "./window/DesktopApplicationMenu.ts";
import * as DesktopAssets from "./app/DesktopAssets.ts";
import * as DesktopEnvironment from "./app/DesktopEnvironment.ts";
import * as DesktopLifecycle from "./app/DesktopLifecycle.ts";
import * as DesktopShutdown from "./app/DesktopShutdown.ts";
import * as DesktopObservability from "./app/DesktopObservability.ts";
import * as DesktopClientSettings from "./settings/DesktopClientSettings.ts";
import * as DesktopAppSettings from "./settings/DesktopAppSettings.ts";
import * as DesktopPreReadyPlatform from "./app/DesktopPreReadyPlatform.ts";
import * as DesktopShellEnvironment from "./shell/DesktopShellEnvironment.ts";
import * as DesktopState from "./app/DesktopState.ts";
import * as BrowserSession from "./preview/BrowserSession.ts";
import * as PreviewManager from "./preview/Manager.ts";
import * as DesktopWindow from "./window/DesktopWindow.ts";
import { registerAppServerBridge } from "./appServer/bridge.ts";
import { registerAppServerSettingsIpc } from "./appServer/settingsIpc.ts";
import { registerWorkspaceLauncherIpc } from "./appServer/workspaceLauncher.ts";

const desktopAppServerBridgeLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* registerAppServerBridge(Electron.ipcMain, {
      cwd: yield* HostProcessWorkingDirectory,
      env: yield* HostProcessEnvironment,
      platform: yield* HostProcessPlatform,
      writeDiagnostic: (message) => process.stderr.write(`[app-server] ${message}\n`),
    });
    yield* registerAppServerSettingsIpc(Electron.ipcMain);
    yield* registerWorkspaceLauncherIpc(Electron.ipcMain);
  }),
);

const desktopEnvironmentLayer = Layer.unwrap(
  Effect.gen(function* () {
    const metadata = yield* Effect.service(ElectronApp.ElectronApp).pipe(
      Effect.flatMap((app) => app.metadata),
    );
    return DesktopEnvironment.layer({
      dirname: __dirname,
      homeDirectory: NodeOS.homedir(),
      platform: yield* HostProcessPlatform,
      processArch: yield* HostProcessArchitecture,
      ...metadata,
    });
  }),
);

const electronLayer = Layer.mergeAll(
  ElectronApp.layer,
  ElectronDialog.layer,
  ElectronMenu.layer,
  ElectronProtocol.layer,
  ElectronShell.layer,
  ElectronTheme.layer,
  ElectronWindow.layer,
  DesktopIpc.layer(Electron.ipcMain),
);

const desktopFoundationLayer = Layer.mergeAll(
  DesktopState.layer,
  DesktopShutdown.layer,
  DesktopAppSettings.layer,
  DesktopClientSettings.layer,
  DesktopAssets.layer,
  DesktopObservability.layer,
).pipe(
  Layer.provideMerge(desktopEnvironmentLayer),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(electronLayer),
);

const desktopIdentityLayer = DesktopAppIdentity.layer.pipe(
  Layer.provideMerge(desktopFoundationLayer),
  Layer.provideMerge(electronLayer),
  Layer.provideMerge(NodeServices.layer),
);

const desktopPreviewLayer = PreviewManager.layer.pipe(
  Layer.provideMerge(BrowserSession.layer),
  Layer.provideMerge(desktopFoundationLayer),
);

const desktopWindowLayer = DesktopWindow.layer.pipe(
  Layer.provideMerge(desktopPreviewLayer),
  Layer.provideMerge(desktopFoundationLayer),
  Layer.provideMerge(electronLayer),
);

const desktopApplicationLayer = Layer.mergeAll(
  DesktopLifecycle.layer,
  DesktopApplicationMenu.layer,
  DesktopShellEnvironment.layer,
  desktopAppServerBridgeLayer,
).pipe(
  Layer.provideMerge(desktopIdentityLayer),
  Layer.provideMerge(desktopWindowLayer),
  Layer.provideMerge(desktopFoundationLayer),
  Layer.provideMerge(electronLayer),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(NodeHttpClient.layerUndici),
);

const desktopRuntimeLayer = desktopApplicationLayer.pipe(
  Layer.provideMerge(DesktopPreReadyPlatform.layer),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(NodeHttpClient.layerUndici),
  Layer.provideMerge(electronLayer),
);

DesktopApp.program.pipe(Effect.provide(desktopRuntimeLayer), NodeRuntime.runMain);
