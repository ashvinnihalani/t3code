import * as NodeFS from "node:fs/promises";
import * as NodePath from "node:path";

import { app, BrowserWindow, dialog, ipcMain, protocol } from "electron";

import { registerAppServerBridge } from "./appServer/bridge.ts";
import { registerAppServerSettingsIpc } from "./appServer/settingsIpc.ts";
import { makeAppServerSettingsStore } from "./appServer/settingsStore.ts";

const APP_SCHEME = "t3codex";
const APP_HOST = "app";
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
].join("; ");

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

app.setName("T3 Codex");

function rendererRoot(): string {
  return NodePath.resolve(__dirname, "../../web/dist");
}

async function existingAsset(root: string, pathname: string): Promise<string> {
  const relativePath = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidate = NodePath.resolve(root, relativePath || "index.html");
  const rootPrefix = `${root}${NodePath.sep}`;

  if (candidate !== root && !candidate.startsWith(rootPrefix)) {
    return NodePath.join(root, "index.html");
  }

  try {
    const stats = await NodeFS.stat(candidate);
    if (stats.isFile()) return candidate;
  } catch {
    // Client-side routes fall back to the renderer entry point.
  }
  return NodePath.join(root, "index.html");
}

async function serveRenderer(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.host !== APP_HOST || (request.method !== "GET" && request.method !== "HEAD")) {
    return new Response(null, { status: 404 });
  }

  const assetPath = await existingAsset(rendererRoot(), url.pathname);
  try {
    const body = request.method === "HEAD" ? null : await NodeFS.readFile(assetPath);
    return new Response(body, {
      headers: {
        "Content-Security-Policy": CONTENT_SECURITY_POLICY,
        "Content-Type":
          CONTENT_TYPES[NodePath.extname(assetPath).toLowerCase()] ?? "application/octet-stream",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`T3 Codex renderer is unavailable: ${message}`, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 520,
    title: "T3 Codex",
    backgroundColor: "#111210",
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 18 } }
      : { titleBarStyle: "hidden" as const }),
    webPreferences: {
      preload: NodePath.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    const developmentUrl = process.env.VITE_DEV_SERVER_URL?.trim();
    const allowedOrigin = developmentUrl
      ? new URL(developmentUrl).origin
      : `${APP_SCHEME}://${APP_HOST}`;
    if (new URL(url).origin !== allowedOrigin) event.preventDefault();
  });

  const developmentUrl = process.env.VITE_DEV_SERVER_URL?.trim();
  if (developmentUrl) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadURL(`${APP_SCHEME}://${APP_HOST}/`);
  }
  return window;
}

let mainWindow: BrowserWindow | undefined;
let closeAppServerBridge: (() => void) | undefined;
let closeSettingsIpc: (() => void) | undefined;

void app
  .whenReady()
  .then(() => {
    if (!process.env.VITE_DEV_SERVER_URL?.trim()) {
      protocol.handle(APP_SCHEME, serveRenderer);
    }
    const settingsStore = makeAppServerSettingsStore(
      app.getPath("userData"),
      process.env,
      app.getPath("home"),
    );
    closeSettingsIpc = registerAppServerSettingsIpc(ipcMain, settingsStore);
    closeAppServerBridge = registerAppServerBridge(ipcMain);
    mainWindow = createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("T3 Codex failed to start", message);
    app.quit();
  });

app.once("will-quit", () => {
  closeAppServerBridge?.();
  closeSettingsIpc?.();
  if (protocol.isProtocolHandled(APP_SCHEME)) {
    void protocol.unhandle(APP_SCHEME);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
