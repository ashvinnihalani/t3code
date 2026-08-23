import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  isPinned: false,
  isSettled: false,
  isSnoozed: false,
  canSnoozeNow: true,
  supports: { settlement: true, snooze: true, pinning: true },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

function ids(state: ThreadActionMenuState): string[] {
  return buildThreadActionMenuItems(state).map((item) => item.id);
}

describe("buildThreadActionMenuItems", () => {
  it("hides lifecycle items when the environment lacks the capabilities", () => {
    expect(
      ids({
        ...baseState,
        supports: { settlement: false, snooze: false, pinning: false },
      }),
    ).toEqual(["rename", "mark-unread", "copy", "archive"]);
  });

  it("flips lifecycle labels with thread state", () => {
    expect(ids({ ...baseState, isPinned: true, isSettled: true, isSnoozed: true })).toEqual(
      expect.arrayContaining(["unpin", "unsettle", "unsnooze"]),
    );
    expect(ids(baseState)).toEqual(expect.arrayContaining(["pin", "settle", "snooze"]));
  });

  it("disables snooze when the thread cannot snooze, keeping presets visible", () => {
    const snooze = buildThreadActionMenuItems({ ...baseState, canSnoozeNow: false }).find(
      (item) => item.id === "snooze",
    );
    expect(snooze?.disabled).toBe(true);
    expect(snooze?.children?.map((child) => child.id)).toEqual(["snooze:hour"]);
  });

  it("matches upstream's copy submenu", () => {
    const copy = buildThreadActionMenuItems(baseState).find((item) => item.id === "copy");
    expect(copy?.children?.map((child) => child.id)).toEqual(["copy-path", "copy-thread-id"]);
  });

  it("keeps archive as the final lifecycle action", () => {
    const items = buildThreadActionMenuItems(baseState);
    expect(items.at(-1)).toMatchObject({ id: "archive", label: "Archive thread" });
  });
});
