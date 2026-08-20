import { describe, expect, it } from "@effect/vitest";
import { beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
  showOpenDialog: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  dialog: { showOpenDialog: mocks.showOpenDialog },
}));

import { PROJECT_DIRECTORY_SELECT_CHANNEL } from "./ipc/channels.ts";
import { registerProjectDirectoryIpc } from "./projectDirectoryIpc.ts";

describe("project directory IPC", () => {
  beforeEach(() => {
    mocks.fromWebContents.mockReset();
    mocks.showOpenDialog.mockReset();
  });

  it("opens the native directory picker and returns its selected project", async () => {
    const handle = vi.fn();
    const removeHandler = vi.fn();
    const owner = {};
    mocks.fromWebContents.mockReturnValue(owner);
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/work/new-project"] });
    const dispose = registerProjectDirectoryIpc({ handle, removeHandler } as never);
    const handler = handle.mock.calls[0]?.[1] as (
      event: { sender: object },
      value: unknown,
    ) => Promise<string | null>;

    await expect(handler({ sender: {} }, "/work")).resolves.toBe("/work/new-project");
    expect(mocks.showOpenDialog).toHaveBeenCalledWith(owner, {
      title: "Add project",
      buttonLabel: "Add project",
      properties: ["openDirectory", "createDirectory"],
      defaultPath: "/work",
    });

    dispose();
    expect(removeHandler).toHaveBeenCalledWith(PROJECT_DIRECTORY_SELECT_CHANNEL);
  });

  it("returns null when directory selection is cancelled", async () => {
    const handle = vi.fn();
    mocks.fromWebContents.mockReturnValue(null);
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    registerProjectDirectoryIpc({ handle, removeHandler: vi.fn() } as never);
    const handler = handle.mock.calls[0]?.[1] as (
      event: { sender: object },
      value: unknown,
    ) => Promise<string | null>;

    await expect(handler({ sender: {} }, null)).resolves.toBeNull();
    expect(mocks.showOpenDialog).toHaveBeenCalledWith({
      title: "Add project",
      buttonLabel: "Add project",
      properties: ["openDirectory", "createDirectory"],
    });
  });
});
