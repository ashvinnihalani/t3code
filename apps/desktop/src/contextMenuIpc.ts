import type { IpcMain, IpcMainInvokeEvent, MenuItemConstructorOptions } from "electron";
import { BrowserWindow, Menu } from "electron";

import { CONTEXT_MENU_CHANNEL } from "./ipc/channels.ts";

export interface DesktopContextMenuItem<T extends string = string> {
  readonly id: T;
  readonly label: string;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly separatorBefore?: boolean;
  readonly children?: ReadonlyArray<DesktopContextMenuItem<T>>;
}

interface ContextMenuRequest {
  readonly items: ReadonlyArray<DesktopContextMenuItem>;
  readonly position?: { readonly x: number; readonly y: number };
}

function parseItem(value: unknown): DesktopContextMenuItem {
  if (typeof value !== "object" || value === null) {
    throw new Error("Context menu items must be objects.");
  }
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.label !== "string") {
    throw new Error("Context menu items require string ids and labels.");
  }
  return {
    id: item.id,
    label: item.label,
    ...(item.destructive === true ? { destructive: true } : {}),
    ...(item.disabled === true ? { disabled: true } : {}),
    ...(item.separatorBefore === true ? { separatorBefore: true } : {}),
    ...(Array.isArray(item.children) ? { children: item.children.map(parseItem) } : {}),
  };
}

function parseRequest(value: unknown): ContextMenuRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Context menu request must be an object.");
  }
  const request = value as Record<string, unknown>;
  if (!Array.isArray(request.items)) {
    throw new Error("Context menu request requires items.");
  }
  const position = request.position;
  if (position === undefined) return { items: request.items.map(parseItem) };
  if (
    typeof position !== "object" ||
    position === null ||
    typeof (position as Record<string, unknown>).x !== "number" ||
    typeof (position as Record<string, unknown>).y !== "number"
  ) {
    throw new Error("Context menu position requires numeric x and y coordinates.");
  }
  return {
    items: request.items.map(parseItem),
    position: {
      x: Math.round((position as { x: number }).x),
      y: Math.round((position as { y: number }).y),
    },
  };
}

function buildTemplate(
  items: ReadonlyArray<DesktopContextMenuItem>,
  select: (id: string) => void,
): ReadonlyArray<MenuItemConstructorOptions> {
  return items.flatMap((item) => {
    const menuItem: MenuItemConstructorOptions = {
      id: item.id,
      label: item.label,
      enabled: item.disabled !== true,
      click: () => select(item.id),
      ...(item.children ? { submenu: [...buildTemplate(item.children, select)] } : {}),
    };
    return item.separatorBefore ? [{ type: "separator" as const }, menuItem] : [menuItem];
  });
}

export function registerContextMenuIpc(ipcMain: IpcMain): () => void {
  const showContextMenu = (event: IpcMainInvokeEvent, value: unknown) => {
    const request = parseRequest(value);
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;

    return new Promise<string | null>((resolve) => {
      let settled = false;
      const complete = (selection: string | null) => {
        if (settled) return;
        settled = true;
        resolve(selection);
      };
      const menu = Menu.buildFromTemplate([...buildTemplate(request.items, complete)]);
      menu.popup({
        ...(owner ? { window: owner } : {}),
        ...request.position,
        callback: () => complete(null),
      });
    });
  };

  ipcMain.handle(CONTEXT_MENU_CHANNEL, showContextMenu);
  return () => ipcMain.removeHandler(CONTEXT_MENU_CHANNEL);
}
