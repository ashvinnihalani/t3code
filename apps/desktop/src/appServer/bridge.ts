import * as NodeChildProcess from "node:child_process";
import { homedir } from "node:os";

import type { IpcMain, IpcMainEvent, MessagePortMain } from "electron";
import { MessageChannelMain } from "electron";
import type { AppServerConnectionProfile } from "../../../../packages/effect-codex-app-server/src/connection.ts";

import {
  APP_SERVER_CONNECT_CHANNEL,
  APP_SERVER_ERROR_CHANNEL,
  APP_SERVER_PORT_CHANNEL,
} from "../ipc/channels.ts";
import {
  parseAppServerConnectionProfile,
  resolveConfiguredAppServerProcess,
} from "./configuration.ts";

interface AppServerConnection {
  readonly close: () => void;
}

function messageBytes(value: unknown): string | Uint8Array | undefined {
  if (typeof value === "string" || value instanceof Uint8Array) {
    return value;
  }
  return undefined;
}

function writeDiagnostic(message: string): void {
  process.stderr.write(`[app-server] ${message}\n`);
}

function forwardOutput(port: MessagePortMain, chunk: Buffer): void {
  try {
    port.postMessage(new Uint8Array(chunk));
  } catch {
    // The renderer closed between the child output event and this delivery.
  }
}

function openConnection(
  event: IpcMainEvent,
  profile: AppServerConnectionProfile,
  onClosed: () => void,
): AppServerConnection {
  const configuration = resolveConfiguredAppServerProcess(
    profile.connection,
    process.env,
    homedir(),
  );
  const child = NodeChildProcess.spawn(configuration.executable, [...configuration.args], {
    cwd: configuration.cwd,
    env: configuration.env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const { port1, port2 } = new MessageChannelMain();
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    port1.close();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
    onClosed();
  };

  child.stdout.on("data", (chunk: Buffer) => forwardOutput(port1, chunk));
  child.stderr.on("data", (chunk: Buffer) => writeDiagnostic(chunk.toString().trimEnd()));
  child.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") writeDiagnostic(error.message);
  });
  child.on("error", (error) => {
    event.sender.send(APP_SERVER_ERROR_CHANNEL, {
      connectionId: profile.id,
      message: error.message,
    });
    close();
  });
  child.on("close", (code, signal) => {
    if (!closed) {
      const detail = signal === null ? `exit code ${String(code)}` : `signal ${signal}`;
      event.sender.send(APP_SERVER_ERROR_CHANNEL, {
        connectionId: profile.id,
        message: `App-server connection closed with ${detail}.`,
      });
    }
    close();
  });
  port1.on("message", ({ data }) => {
    const bytes = messageBytes(data);
    if (bytes !== undefined && !child.stdin.destroyed) {
      child.stdin.write(bytes);
    }
  });
  port1.on("close", close);
  port1.start();

  event.sender.postMessage(APP_SERVER_PORT_CHANNEL, { connectionId: profile.id }, [port2]);
  return { close };
}

export function registerAppServerBridge(ipcMain: IpcMain): () => void {
  const connections = new Map<string, AppServerConnection>();

  const handleConnect = (event: IpcMainEvent, value: unknown) => {
    try {
      const profile = parseAppServerConnectionProfile(value);
      const key = `${event.sender.id}:${profile.id}`;
      connections.get(key)?.close();
      let connection: AppServerConnection | undefined;
      connection = openConnection(event, profile, () => {
        if (connection !== undefined && connections.get(key) === connection) {
          connections.delete(key);
        }
      });
      connections.set(key, connection);
      event.sender.once("destroyed", () => {
        connection.close();
        if (connections.get(key) === connection) connections.delete(key);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const connectionId =
        typeof value === "object" && value !== null && "id" in value && typeof value.id === "string"
          ? value.id
          : null;
      event.sender.send(APP_SERVER_ERROR_CHANNEL, { connectionId, message });
    }
  };

  ipcMain.on(APP_SERVER_CONNECT_CHANNEL, handleConnect);
  return () => {
    ipcMain.removeListener(APP_SERVER_CONNECT_CHANNEL, handleConnect);
    for (const connection of connections.values()) connection.close();
    connections.clear();
  };
}
