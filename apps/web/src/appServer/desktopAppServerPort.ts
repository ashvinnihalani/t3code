import type { DesktopAppServerPort } from "@t3tools/contracts";
import { DESKTOP_APP_SERVER_PORT_MESSAGE_TYPE } from "@t3tools/contracts/appServerDesktop";

interface AppServerPortMessageEvent {
  readonly source: unknown;
  readonly data: unknown;
  readonly ports: ReadonlyArray<unknown>;
}

function isDesktopAppServerPort(value: unknown): value is DesktopAppServerPort {
  return (
    typeof value === "object" &&
    value !== null &&
    "postMessage" in value &&
    typeof value.postMessage === "function" &&
    "start" in value &&
    typeof value.start === "function" &&
    "close" in value &&
    typeof value.close === "function" &&
    "addEventListener" in value &&
    typeof value.addEventListener === "function"
  );
}

export function parseDesktopAppServerPortMessage(
  event: AppServerPortMessageEvent,
  expectedSource: unknown,
): { readonly connectionId: string; readonly port: DesktopAppServerPort } | null {
  if (event.source !== expectedSource || typeof event.data !== "object" || event.data === null) {
    return null;
  }
  if (
    !("type" in event.data) ||
    event.data.type !== DESKTOP_APP_SERVER_PORT_MESSAGE_TYPE ||
    !("connectionId" in event.data) ||
    typeof event.data.connectionId !== "string"
  ) {
    return null;
  }
  const port = event.ports[0];
  return isDesktopAppServerPort(port) ? { connectionId: event.data.connectionId, port } : null;
}

export function onDesktopAppServerPort(
  listener: (connectionId: string, port: DesktopAppServerPort) => void,
): () => void {
  const handleMessage = (event: MessageEvent<unknown>) => {
    const message = parseDesktopAppServerPortMessage(event, window);
    if (message !== null) listener(message.connectionId, message.port);
  };
  window.addEventListener("message", handleMessage);
  return () => window.removeEventListener("message", handleMessage);
}
