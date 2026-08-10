import * as Schema from "effect/Schema";

export const TraceDirection = Schema.Literals(["client-to-server", "server-to-client"]);
export type TraceDirection = typeof TraceDirection.Type;

export const TraceKind = Schema.Literals(["request", "response", "notification", "error"]);
export type TraceKind = typeof TraceKind.Type;

export interface TraceEntry {
  readonly sequence: number;
  readonly direction: TraceDirection;
  readonly kind: TraceKind;
  readonly method?: string;
  readonly id?: string | number;
  readonly payload: unknown;
}

export interface RecordedProtocolMessage {
  readonly id?: string | number;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

const classifyMessage = (message: RecordedProtocolMessage): TraceKind => {
  if (message.method !== undefined) {
    return message.id === undefined ? "notification" : "request";
  }
  return message.error === undefined ? "response" : "error";
};

export class MessageRecorder {
  readonly #entries: TraceEntry[] = [];

  record(direction: TraceDirection, message: RecordedProtocolMessage): void {
    this.#entries.push({
      sequence: this.#entries.length + 1,
      direction,
      kind: classifyMessage(message),
      ...(message.method === undefined ? {} : { method: message.method }),
      ...(message.id === undefined ? {} : { id: message.id }),
      payload: message,
    });
  }

  snapshot(): ReadonlyArray<TraceEntry> {
    return this.#entries.map((entry) => ({ ...entry }));
  }
}
