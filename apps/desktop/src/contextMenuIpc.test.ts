import { describe, expect, it } from "@effect/vitest";
import { beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildFromTemplate: vi.fn(),
  fromWebContents: vi.fn(),
  popup: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  Menu: { buildFromTemplate: mocks.buildFromTemplate },
}));

import { registerContextMenuIpc } from "./contextMenuIpc.ts";
import { CONTEXT_MENU_CHANNEL } from "./ipc/channels.ts";

describe("context menu IPC", () => {
  beforeEach(() => {
    mocks.buildFromTemplate.mockReset();
    mocks.fromWebContents.mockReset();
    mocks.popup.mockReset();
    mocks.buildFromTemplate.mockReturnValue({ popup: mocks.popup });
  });

  it("shows an upstream-style native menu and returns the selected action", async () => {
    const handle = vi.fn();
    const removeHandler = vi.fn();
    const owner = {};
    mocks.fromWebContents.mockReturnValue(owner);
    const dispose = registerContextMenuIpc({ handle, removeHandler } as never);
    const handler = handle.mock.calls[0]?.[1] as (
      event: { sender: object },
      value: unknown,
    ) => Promise<string | null>;

    const selected = handler(
      { sender: {} },
      {
        items: [
          { id: "open", label: "Open thread" },
          { id: "delete", label: "Delete thread", disabled: true, separatorBefore: true },
        ],
        position: { x: 18.4, y: 32.8 },
      },
    );
    const template = mocks.buildFromTemplate.mock.calls[0]?.[0] as ReadonlyArray<{
      id?: string;
      enabled?: boolean;
      type?: string;
      click?: () => void;
    }>;
    template[0]?.click?.();
    const popupOptions = mocks.popup.mock.calls[0]?.[0] as { callback: () => void };
    popupOptions.callback();

    await expect(selected).resolves.toBe("open");
    expect(template.map(({ id, enabled, type }) => ({ id, enabled, type }))).toEqual([
      { id: "open", enabled: true, type: undefined },
      { id: undefined, enabled: undefined, type: "separator" },
      { id: "delete", enabled: false, type: undefined },
    ]);
    expect(mocks.popup).toHaveBeenCalledWith({
      window: owner,
      x: 18,
      y: 33,
      callback: expect.any(Function),
    });

    dispose();
    expect(removeHandler).toHaveBeenCalledWith(CONTEXT_MENU_CHANNEL);
  });

  it("returns null when the menu closes without a selection", async () => {
    const handle = vi.fn();
    registerContextMenuIpc({ handle, removeHandler: vi.fn() } as never);
    const handler = handle.mock.calls[0]?.[1] as (
      event: { sender: object },
      value: unknown,
    ) => Promise<string | null>;

    const selected = handler({ sender: {} }, { items: [{ id: "open", label: "Open" }] });
    const popupOptions = mocks.popup.mock.calls[0]?.[0] as { callback: () => void };
    popupOptions.callback();

    await expect(selected).resolves.toBeNull();
  });
});
