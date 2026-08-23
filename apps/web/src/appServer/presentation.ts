export interface ThreadSummary {
  readonly id: string;
  readonly cwd: string;
  readonly name: string | null;
  readonly preview: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly status: "notLoaded" | "idle" | "systemError" | "active";
}

export interface TimelineItem {
  readonly id: string;
  readonly type: string;
  readonly text: string;
  readonly title: string | null;
  readonly detail: string | null;
  readonly status: string | null;
  readonly startedAtMs?: number;
}

export interface ThreadTurn {
  readonly id: string;
  readonly status: "completed" | "interrupted" | "failed" | "inProgress";
  readonly items: ReadonlyArray<TimelineItem>;
  readonly startedAt: number | null;
  readonly completedAt: number | null;
  readonly error: string | null;
}

export interface ThreadDetail extends ThreadSummary {
  readonly turns: ReadonlyArray<ThreadTurn>;
  readonly settings?: ThreadSettings | null;
}

export interface ThreadSettings {
  readonly model: string;
  readonly effort: string | null;
  readonly serviceTier: string | null;
  readonly runtimeMode: "approval-required" | "auto-accept-edits" | "auto" | "full-access";
  readonly interactionMode: "default" | "plan";
}

export interface ModelOption {
  readonly id: string;
  readonly model: string;
  readonly displayName: string;
  readonly isDefault: boolean;
  readonly description: string;
  readonly defaultReasoningEffort: string;
  readonly supportedReasoningEfforts: ReadonlyArray<{
    readonly reasoningEffort: string;
    readonly description: string;
  }>;
  readonly defaultServiceTier: string | null;
  readonly serviceTiers: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly description: string;
  }>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function timestampMilliseconds(value: number | null): number | null {
  if (value === null) return null;
  return value > 0 && value < 10_000_000_000 ? value * 1_000 : value;
}

function threadStatus(value: unknown): ThreadSummary["status"] {
  if (!isRecord(value)) return "notLoaded";
  switch (value.type) {
    case "idle":
    case "systemError":
    case "active":
    case "notLoaded":
      return value.type;
    default:
      return "notLoaded";
  }
}

export function projectThreadSummary(value: unknown): ThreadSummary | null {
  if (!isRecord(value)) return null;
  if (
    value.ephemeral === true ||
    typeof value.parentThreadId === "string" ||
    (isRecord(value.source) && "subAgent" in value.source)
  ) {
    return null;
  }
  const id = stringValue(value.id);
  const cwd = stringValue(value.cwd);
  if (id === null || cwd === null) return null;
  return {
    id,
    cwd,
    name: stringValue(value.name),
    preview: stringValue(value.preview) ?? "",
    createdAt: numberValue(value.createdAt) ?? 0,
    updatedAt: numberValue(value.updatedAt) ?? 0,
    status: threadStatus(value.status),
  };
}

function textFromUserContent(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((entry) => {
      if (!isRecord(entry)) return "";
      if (entry.type === "text") return stringValue(entry.text) ?? "";
      if (entry.type === "localImage" || entry.type === "image") return "[Image]";
      if (entry.type === "mention") return stringValue(entry.name) ?? "[Mention]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function stringList(value: unknown): string {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").join("\n")
    : "";
}

export function projectTimelineItem(value: unknown): TimelineItem | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const type = stringValue(value.type);
  if (id === null || type === null) return null;

  switch (type) {
    case "userMessage":
      return {
        id,
        type,
        text: textFromUserContent(value.content),
        title: null,
        detail: null,
        status: null,
      };
    case "agentMessage":
    case "plan":
      return {
        id,
        type,
        text: stringValue(value.text) ?? "",
        title: null,
        detail: null,
        status: null,
      };
    case "reasoning":
      return {
        id,
        type,
        text: stringList(value.summary) || stringList(value.content),
        title: "Worked for a moment",
        detail: null,
        status: null,
      };
    case "commandExecution":
      return {
        id,
        type,
        text: stringValue(value.aggregatedOutput) ?? "",
        title: stringValue(value.command) ?? "Command",
        detail: stringValue(value.cwd),
        status: stringValue(value.status),
      };
    case "fileChange": {
      const count = Array.isArray(value.changes) ? value.changes.length : 0;
      return {
        id,
        type,
        text: "",
        title: `${count} file ${count === 1 ? "change" : "changes"}`,
        detail: null,
        status: stringValue(value.status),
      };
    }
    case "mcpToolCall":
      return {
        id,
        type,
        text: "",
        title: `${stringValue(value.server) ?? "MCP"} · ${stringValue(value.tool) ?? "tool"}`,
        detail: null,
        status: stringValue(value.status),
      };
    case "dynamicToolCall":
      return {
        id,
        type,
        text: "",
        title: stringValue(value.tool) ?? "Tool call",
        detail: stringValue(value.namespace),
        status: stringValue(value.status),
      };
    case "webSearch":
      return {
        id,
        type,
        text: "",
        title: "Searched the web",
        detail: stringValue(value.query),
        status: null,
      };
    case "imageView":
      return {
        id,
        type,
        text: "",
        title: "Viewed image",
        detail: stringValue(value.path),
        status: null,
      };
    case "contextCompaction":
      return { id, type, text: "", title: "Conversation compacted", detail: null, status: null };
    default:
      return { id, type, text: "", title: type, detail: null, status: stringValue(value.status) };
  }
}

export function projectTurn(value: unknown): ThreadTurn | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  if (id === null) return null;
  const rawStatus = stringValue(value.status);
  const status: ThreadTurn["status"] =
    rawStatus === "completed" || rawStatus === "interrupted" || rawStatus === "failed"
      ? rawStatus
      : "inProgress";
  const startedAt = numberValue(value.startedAt);
  const startedAtMs = timestampMilliseconds(startedAt);
  const items = Array.isArray(value.items)
    ? value.items.flatMap((rawItem, index) => {
        const item = projectTimelineItem(rawItem);
        if (item === null) return [];
        return [startedAtMs === null ? item : { ...item, startedAtMs: startedAtMs + index }];
      })
    : [];
  const rawError = value.error;
  return {
    id,
    status,
    items,
    startedAt,
    completedAt: numberValue(value.completedAt),
    error: isRecord(rawError) ? stringValue(rawError.message) : stringValue(rawError),
  };
}

export function projectThreadDetail(value: unknown): ThreadDetail | null {
  const summary = projectThreadSummary(value);
  if (summary === null || !isRecord(value)) return null;
  const turns = Array.isArray(value.turns)
    ? value.turns.map(projectTurn).filter((turn): turn is ThreadTurn => turn !== null)
    : [];
  return { ...summary, turns };
}

function runtimeModeFromThreadSettings(
  approvalPolicy: unknown,
  sandboxPolicy: unknown,
): ThreadSettings["runtimeMode"] {
  const sandboxType = isRecord(sandboxPolicy) ? stringValue(sandboxPolicy.type) : null;
  if (sandboxType === "dangerFullAccess") return "full-access";
  if (sandboxType === "workspaceWrite") {
    return approvalPolicy === "untrusted" ? "auto" : "auto-accept-edits";
  }
  return "approval-required";
}

export function applyThreadSettings(detail: ThreadDetail, value: unknown): ThreadDetail {
  if (!isRecord(value)) return detail;
  const model = stringValue(value.model);
  if (model === null) return detail;
  const collaborationMode = isRecord(value.collaborationMode) ? value.collaborationMode : null;
  const collaborationSettings =
    collaborationMode !== null && isRecord(collaborationMode.settings)
      ? collaborationMode.settings
      : null;
  const effort =
    stringValue(value.effort) ??
    stringValue(value.reasoningEffort) ??
    (collaborationSettings === null ? null : stringValue(collaborationSettings.reasoning_effort));
  const sandboxPolicy = value.sandboxPolicy ?? value.sandbox;
  return {
    ...detail,
    settings: {
      model,
      effort,
      serviceTier: stringValue(value.serviceTier),
      runtimeMode: runtimeModeFromThreadSettings(value.approvalPolicy, sandboxPolicy),
      interactionMode:
        collaborationMode?.mode === "plan"
          ? "plan"
          : collaborationMode?.mode === "default"
            ? "default"
            : (detail.settings?.interactionMode ?? "default"),
    },
  };
}

export function projectModels(value: unknown): ReadonlyArray<ModelOption> {
  if (!isRecord(value) || !Array.isArray(value.data)) return [];
  return value.data.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = stringValue(entry.id);
    const model = stringValue(entry.model);
    const displayName = stringValue(entry.displayName);
    if (id === null || model === null || displayName === null || entry.hidden === true) return [];
    const supportedReasoningEfforts = Array.isArray(entry.supportedReasoningEfforts)
      ? entry.supportedReasoningEfforts.flatMap((option) => {
          if (!isRecord(option)) return [];
          const reasoningEffort = stringValue(option.reasoningEffort);
          const description = stringValue(option.description);
          return reasoningEffort === null || description === null
            ? []
            : [{ reasoningEffort, description }];
        })
      : [];
    const serviceTiers = Array.isArray(entry.serviceTiers)
      ? entry.serviceTiers.flatMap((tier) => {
          if (!isRecord(tier)) return [];
          const tierId = stringValue(tier.id);
          const name = stringValue(tier.name);
          const description = stringValue(tier.description);
          return tierId === null || name === null || description === null
            ? []
            : [{ id: tierId, name, description }];
        })
      : [];
    return [
      {
        id,
        model,
        displayName,
        isDefault: entry.isDefault === true,
        description: stringValue(entry.description) ?? "",
        defaultReasoningEffort: stringValue(entry.defaultReasoningEffort) ?? "medium",
        supportedReasoningEfforts,
        defaultServiceTier: stringValue(entry.defaultServiceTier),
        serviceTiers,
      },
    ];
  });
}

function mergeTurnItems(
  existingItems: ReadonlyArray<TimelineItem>,
  incomingItems: ReadonlyArray<TimelineItem>,
): ReadonlyArray<TimelineItem> {
  const items = [...existingItems];
  const incomingUserMessages = incomingItems.filter((item) => item.type === "userMessage");
  for (const item of incomingItems) {
    let itemIndex = items.findIndex((candidate) => candidate.id === item.id);
    if (itemIndex === -1 && item.type === "userMessage" && incomingUserMessages.length === 1) {
      const contentMatches = items
        .map((candidate, index) => ({ candidate, index }))
        .filter(
          ({ candidate }) => candidate.type === "userMessage" && candidate.text === item.text,
        );
      if (contentMatches.length === 1) {
        itemIndex = contentMatches[0]!.index;
        items[itemIndex] = { ...item, id: items[itemIndex]!.id };
        continue;
      }
    }
    if (itemIndex === -1) {
      items.push(item);
    } else {
      const existingStartedAtMs = items[itemIndex]?.startedAtMs;
      items[itemIndex] =
        existingStartedAtMs === undefined ? item : { ...item, startedAtMs: existingStartedAtMs };
    }
  }
  return items.toSorted((left, right) => {
    if (left.startedAtMs === undefined && right.startedAtMs === undefined) return 0;
    if (left.startedAtMs === undefined) return 1;
    if (right.startedAtMs === undefined) return -1;
    return left.startedAtMs - right.startedAtMs;
  });
}

export function upsertTurn(detail: ThreadDetail, value: unknown): ThreadDetail {
  const incoming = projectTurn(value);
  if (incoming === null) return detail;
  const index = detail.turns.findIndex((candidate) => candidate.id === incoming.id);
  const turns = [...detail.turns];
  if (index === -1) {
    turns.push(incoming);
  } else {
    const existing = turns[index]!;
    const items = mergeTurnItems(existing.items, incoming.items);
    turns[index] = {
      ...existing,
      ...incoming,
      items,
      startedAt: incoming.startedAt ?? existing.startedAt,
      completedAt: incoming.completedAt ?? existing.completedAt,
      error: incoming.error ?? existing.error,
    };
  }
  return { ...detail, status: incoming.status === "inProgress" ? "active" : "idle", turns };
}

export function mergeThreadDetails(current: ThreadDetail, incoming: ThreadDetail): ThreadDetail {
  let merged: ThreadDetail = { ...current, ...incoming, turns: current.turns };
  for (const incomingTurn of incoming.turns) {
    const index = merged.turns.findIndex((turn) => turn.id === incomingTurn.id);
    if (index === -1) {
      merged = { ...merged, turns: [...merged.turns, incomingTurn] };
      continue;
    }
    const existingTurn = merged.turns[index]!;
    const items = mergeTurnItems(existingTurn.items, incomingTurn.items);
    const turns = [...merged.turns];
    turns[index] = {
      ...existingTurn,
      ...incomingTurn,
      items,
      startedAt: incomingTurn.startedAt ?? existingTurn.startedAt,
      completedAt: incomingTurn.completedAt ?? existingTurn.completedAt,
      error: incomingTurn.error ?? existingTurn.error,
    };
    merged = { ...merged, turns };
  }
  return merged;
}

/**
 * Replace an app-server user item id with the id of the optimistic message
 * already rendered by the upstream chat view. Later snapshots can continue
 * using the server id; `mergeTurnItems` preserves this client-facing alias.
 */
export function aliasTurnUserMessage(
  detail: ThreadDetail,
  turnId: string,
  serverMessageId: string,
  clientMessageId: string,
): ThreadDetail {
  return {
    ...detail,
    turns: detail.turns.map((turn) => {
      if (turn.id !== turnId) return turn;
      const serverMessage = turn.items.find((item) => item.id === serverMessageId);
      if (serverMessage?.type !== "userMessage") return turn;
      const clientMessageIndex = turn.items.findIndex((item) => item.id === clientMessageId);
      const items = turn.items.flatMap((item, index) => {
        if (item.id === serverMessageId) {
          return clientMessageIndex === -1 ? [{ ...item, id: clientMessageId }] : [];
        }
        if (index === clientMessageIndex) return [{ ...serverMessage, id: clientMessageId }];
        return [item];
      });
      return { ...turn, items };
    }),
  };
}

export function upsertTimelineItem(
  detail: ThreadDetail,
  turnId: string,
  value: unknown,
  timing: { readonly startedAtMs?: number; readonly completedAtMs?: number } = {},
): ThreadDetail {
  const projected = projectTimelineItem(value);
  if (projected === null) return detail;
  return {
    ...detail,
    turns: detail.turns.map((turn) => {
      if (turn.id !== turnId) return turn;
      const index = turn.items.findIndex((candidate) => candidate.id === projected.id);
      const items = [...turn.items];
      const existingStartedAtMs = index === -1 ? undefined : items[index]?.startedAtMs;
      const turnStartedAtMs = timestampMilliseconds(turn.startedAt);
      const startedAtMs =
        timing.startedAtMs ??
        existingStartedAtMs ??
        timing.completedAtMs ??
        (turnStartedAtMs === null ? undefined : turnStartedAtMs + Math.max(index, items.length));
      const item = startedAtMs === undefined ? projected : { ...projected, startedAtMs };
      if (index === -1) items.push(item);
      else items[index] = item;
      return { ...turn, items };
    }),
  };
}

export function appendAgentMessageDelta(
  detail: ThreadDetail,
  turnId: string,
  itemId: string,
  delta: string,
): ThreadDetail {
  return {
    ...detail,
    turns: detail.turns.map((turn) => {
      if (turn.id !== turnId) return turn;
      const index = turn.items.findIndex((item) => item.id === itemId);
      const turnStartedAtMs = timestampMilliseconds(turn.startedAt);
      if (index === -1) {
        return {
          ...turn,
          items: [
            ...turn.items,
            {
              id: itemId,
              type: "agentMessage",
              text: delta,
              title: null,
              detail: null,
              status: null,
              ...(turnStartedAtMs === null
                ? {}
                : { startedAtMs: turnStartedAtMs + turn.items.length }),
            },
          ],
        };
      }
      return {
        ...turn,
        items: turn.items.map((item, itemIndex) =>
          itemIndex === index ? { ...item, text: `${item.text}${delta}` } : item,
        ),
      };
    }),
  };
}
