export const DESKTOP_APP_SERVER_PORT_MESSAGE_TYPE = "t3-codex:app-server-port";

export interface DesktopAppServerPortMessage {
  readonly type: typeof DESKTOP_APP_SERVER_PORT_MESSAGE_TYPE;
  readonly connectionId: string;
}
