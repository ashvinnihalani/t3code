import type { TraceEntry } from "../protocol/MessageRecorder.ts";

export interface PartialOrderIssue {
  readonly sequence?: number;
  readonly detail: string;
}

interface ItemState {
  readonly startedAt: number;
  completedAt?: number;
}

const paramsOf = (entry: TraceEntry): Record<string, unknown> | undefined => {
  if (entry.payload === null || typeof entry.payload !== "object") return undefined;
  const params = (entry.payload as Record<string, unknown>).params;
  return params !== null && typeof params === "object"
    ? (params as Record<string, unknown>)
    : undefined;
};

const itemIdOf = (entry: TraceEntry): string | undefined => {
  const params = paramsOf(entry);
  if (params === undefined) return undefined;
  if (typeof params.itemId === "string") return params.itemId;
  if (params.item === null || typeof params.item !== "object") return undefined;
  const id = (params.item as Record<string, unknown>).id;
  return typeof id === "string" ? id : undefined;
};

const notificationEntries = (trace: ReadonlyArray<TraceEntry>): ReadonlyArray<TraceEntry> =>
  trace.filter((entry) => entry.direction === "server-to-client" && entry.kind === "notification");

export const validateCoreLifecycleOrder = (
  trace: ReadonlyArray<TraceEntry>,
): ReadonlyArray<PartialOrderIssue> => {
  const issues: PartialOrderIssue[] = [];
  const items = new Map<string, ItemState>();
  let threadStartedAt: number | undefined;
  let turnStartedAt: number | undefined;
  let turnCompletedAt: number | undefined;

  for (const entry of notificationEntries(trace)) {
    switch (entry.method) {
      case "thread/started":
        threadStartedAt ??= entry.sequence;
        break;
      case "turn/started":
        turnStartedAt ??= entry.sequence;
        if (threadStartedAt === undefined) {
          issues.push({
            sequence: entry.sequence,
            detail: "turn/started preceded thread/started.",
          });
        }
        break;
      case "item/started": {
        const itemId = itemIdOf(entry);
        if (turnStartedAt === undefined) {
          issues.push({ sequence: entry.sequence, detail: "item/started preceded turn/started." });
        }
        if (itemId === undefined) {
          issues.push({
            sequence: entry.sequence,
            detail: "item/started did not identify an item.",
          });
        } else {
          items.set(itemId, { startedAt: entry.sequence });
        }
        break;
      }
      case "item/completed": {
        const itemId = itemIdOf(entry);
        const item = itemId === undefined ? undefined : items.get(itemId);
        if (item === undefined) {
          issues.push({
            sequence: entry.sequence,
            detail: "item/completed did not follow a matching item/started.",
          });
        } else {
          item.completedAt = entry.sequence;
        }
        break;
      }
      case "turn/completed":
        turnCompletedAt ??= entry.sequence;
        if (turnStartedAt === undefined) {
          issues.push({
            sequence: entry.sequence,
            detail: "turn/completed preceded turn/started.",
          });
        }
        for (const [itemId, item] of items) {
          if (item.completedAt === undefined) {
            issues.push({
              sequence: entry.sequence,
              detail: `turn/completed preceded completion of item ${itemId}.`,
            });
          }
        }
        break;
      default: {
        if (entry.method?.toLowerCase().endsWith("delta") !== true) break;
        const itemId = itemIdOf(entry);
        const item = itemId === undefined ? undefined : items.get(itemId);
        if (item === undefined) {
          issues.push({
            sequence: entry.sequence,
            detail: `${entry.method} did not follow a matching item/started.`,
          });
        } else if (item.completedAt !== undefined) {
          issues.push({
            sequence: entry.sequence,
            detail: `${entry.method} followed item/completed for ${itemId}.`,
          });
        }
      }
    }
  }

  if (threadStartedAt === undefined) issues.push({ detail: "thread/started was not observed." });
  if (turnStartedAt === undefined) issues.push({ detail: "turn/started was not observed." });
  if (turnCompletedAt === undefined) issues.push({ detail: "turn/completed was not observed." });
  return issues;
};
