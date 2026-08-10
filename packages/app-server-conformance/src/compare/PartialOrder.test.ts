import { describe, expect, it } from "@effect/vitest";

import type { TraceEntry } from "../protocol/MessageRecorder.ts";
import { validateCoreLifecycleOrder } from "./PartialOrder.ts";

const notification = (sequence: number, method: string, params: unknown): TraceEntry => ({
  sequence,
  direction: "server-to-client",
  kind: "notification",
  method,
  payload: { method, params },
});

describe("validateCoreLifecycleOrder", () => {
  it("accepts interleaved notifications that preserve per-item lifecycle order", () => {
    expect(
      validateCoreLifecycleOrder([
        notification(1, "thread/started", {}),
        notification(2, "account/updated", {}),
        notification(3, "turn/started", {}),
        notification(4, "item/started", { item: { id: "item-1" } }),
        notification(5, "item/agentMessage/delta", { itemId: "item-1" }),
        notification(6, "item/completed", { item: { id: "item-1" } }),
        notification(7, "turn/completed", {}),
      ]),
    ).toEqual([]);
  });

  it("reports deltas and completion emitted before their prerequisites", () => {
    expect(
      validateCoreLifecycleOrder([
        notification(1, "item/agentMessage/delta", { itemId: "item-1" }),
        notification(2, "turn/completed", {}),
      ]).map((issue) => issue.detail),
    ).toEqual([
      "item/agentMessage/delta did not follow a matching item/started.",
      "turn/completed preceded turn/started.",
      "thread/started was not observed.",
      "turn/started was not observed.",
    ]);
  });
});
