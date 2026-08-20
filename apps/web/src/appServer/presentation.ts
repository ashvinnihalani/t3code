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
}

export interface ModelOption {
  readonly id: string;
  readonly model: string;
  readonly displayName: string;
  readonly isDefault: boolean;
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
  const items = Array.isArray(value.items)
    ? value.items.map(projectTimelineItem).filter((item): item is TimelineItem => item !== null)
    : [];
  const rawError = value.error;
  return {
    id,
    status,
    items,
    startedAt: numberValue(value.startedAt),
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

export function projectModels(value: unknown): ReadonlyArray<ModelOption> {
  if (!isRecord(value) || !Array.isArray(value.data)) return [];
  return value.data.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = stringValue(entry.id);
    const model = stringValue(entry.model);
    const displayName = stringValue(entry.displayName);
    if (id === null || model === null || displayName === null || entry.hidden === true) return [];
    return [{ id, model, displayName, isDefault: entry.isDefault === true }];
  });
}

export function upsertTurn(detail: ThreadDetail, value: unknown): ThreadDetail {
  const turn = projectTurn(value);
  if (turn === null) return detail;
  const index = detail.turns.findIndex((candidate) => candidate.id === turn.id);
  const turns = [...detail.turns];
  if (index === -1) turns.push(turn);
  else turns[index] = turn;
  return { ...detail, status: turn.status === "inProgress" ? "active" : "idle", turns };
}

export function upsertTimelineItem(
  detail: ThreadDetail,
  turnId: string,
  value: unknown,
): ThreadDetail {
  const item = projectTimelineItem(value);
  if (item === null) return detail;
  return {
    ...detail,
    turns: detail.turns.map((turn) => {
      if (turn.id !== turnId) return turn;
      const index = turn.items.findIndex((candidate) => candidate.id === item.id);
      const items = [...turn.items];
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
