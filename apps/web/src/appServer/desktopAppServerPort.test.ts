import { describe, expect, it, vi } from "@effect/vitest";

import { DESKTOP_APP_SERVER_PORT_MESSAGE_TYPE } from "@t3tools/contracts/appServerDesktop";
import { parseDesktopAppServerPortMessage } from "./desktopAppServerPort";

function testPort() {
  return {
    postMessage: vi.fn(),
    start: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

describe("desktop app-server port transfer", () => {
  it("accepts a transferred port from the preload window", () => {
    const source = {};
    const port = testPort();
    expect(
      parseDesktopAppServerPortMessage(
        {
          source,
          data: { type: DESKTOP_APP_SERVER_PORT_MESSAGE_TYPE, connectionId: "local" },
          ports: [port],
        },
        source,
      ),
    ).toEqual({ connectionId: "local", port });
  });

  it("rejects spoofed sources and messages without a transferred port", () => {
    const source = {};
    const data = { type: DESKTOP_APP_SERVER_PORT_MESSAGE_TYPE, connectionId: "local" };
    expect(
      parseDesktopAppServerPortMessage({ source: {}, data, ports: [testPort()] }, source),
    ).toBe(null);
    expect(parseDesktopAppServerPortMessage({ source, data, ports: [] }, source)).toBe(null);
  });
});
