import * as Schema from "effect/Schema";

import type { JsonlTransport, JsonlTransportClosed } from "./JsonlTransport.ts";
import { MessageRecorder, type RecordedProtocolMessage } from "./MessageRecorder.ts";

export const JsonRpcId = Schema.Union([Schema.String, Schema.Number]);
export type JsonRpcId = typeof JsonRpcId.Type;

export const JsonRpcErrorShape = Schema.Struct({
  code: Schema.Number,
  message: Schema.String,
  data: Schema.optionalKey(Schema.Unknown),
});
export type JsonRpcErrorShape = typeof JsonRpcErrorShape.Type;

export const JsonRpcRequest = Schema.Struct({
  id: JsonRpcId,
  method: Schema.String,
  params: Schema.optionalKey(Schema.Unknown),
});
export type JsonRpcRequest = typeof JsonRpcRequest.Type;

export const JsonRpcNotification = Schema.Struct({
  method: Schema.String,
  params: Schema.optionalKey(Schema.Unknown),
});
export type JsonRpcNotification = typeof JsonRpcNotification.Type;

const JsonRpcSuccessResponse = Schema.Struct({
  id: JsonRpcId,
  result: Schema.Unknown,
});

const JsonRpcErrorResponse = Schema.Struct({
  id: JsonRpcId,
  error: JsonRpcErrorShape,
});

export const JsonRpcResponse = Schema.Union([JsonRpcSuccessResponse, JsonRpcErrorResponse]);
export type JsonRpcResponse = typeof JsonRpcResponse.Type;

const JsonRpcEnvelope = Schema.Union([JsonRpcRequest, JsonRpcNotification, JsonRpcResponse]);
type JsonRpcEnvelope = typeof JsonRpcEnvelope.Type;

export class JsonRpcProtocolError extends Error {
  override readonly name = "JsonRpcProtocolError";
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.cause = cause;
  }
}

export class JsonRpcResponseError extends Error {
  override readonly name = "JsonRpcResponseError";
  readonly method: string;
  readonly requestId: JsonRpcId;
  readonly responseError: JsonRpcErrorShape;

  constructor(method: string, requestId: JsonRpcId, responseError: JsonRpcErrorShape) {
    super(`${method} failed with JSON-RPC error ${responseError.code}: ${responseError.message}`);
    this.method = method;
    this.requestId = requestId;
    this.responseError = responseError;
  }
}

interface PendingRequest {
  readonly method: string;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: unknown) => void;
}

class AsyncMessageQueue<A> {
  readonly #values: A[] = [];
  readonly #waiters: Array<{
    readonly resolve: (value: A) => void;
    readonly reject: (error: unknown) => void;
  }> = [];
  #failure: unknown | undefined;

  offer(value: A): void {
    const waiter = this.#waiters.shift();
    if (waiter) {
      waiter.resolve(value);
      return;
    }
    this.#values.push(value);
  }

  take(): Promise<A> {
    const value = this.#values.shift();
    if (value !== undefined) {
      return Promise.resolve(value);
    }
    if (this.#failure !== undefined) {
      return Promise.reject(this.#failure);
    }
    return new Promise<A>((resolve, reject) => {
      this.#waiters.push({ resolve, reject });
    });
  }

  fail(error: unknown): void {
    if (this.#failure !== undefined) return;
    this.#failure = error;
    for (const waiter of this.#waiters.splice(0)) {
      waiter.reject(error);
    }
  }
}

const decodeEnvelope = (line: string): JsonRpcEnvelope => {
  try {
    return Schema.decodeUnknownSync(JsonRpcEnvelope)(JSON.parse(line));
  } catch (cause) {
    throw new JsonRpcProtocolError("Received an invalid JSON-RPC message.", cause);
  }
};

const isRequest = Schema.is(JsonRpcRequest);
const isNotification = Schema.is(JsonRpcNotification);
const isErrorResponse = Schema.is(JsonRpcErrorResponse);

export class JsonRpcDriver {
  readonly #pending = new Map<string, PendingRequest>();
  readonly #notifications = new AsyncMessageQueue<JsonRpcNotification>();
  readonly #serverRequests = new AsyncMessageQueue<JsonRpcRequest>();
  readonly #reader: Promise<void>;
  readonly #recorder: MessageRecorder;
  readonly transport: JsonlTransport;
  #nextRequestId = 1;
  #closed = false;

  readonly closed: Promise<JsonlTransportClosed>;

  constructor(transport: JsonlTransport, recorder = new MessageRecorder()) {
    this.transport = transport;
    this.#recorder = recorder;
    this.#reader = this.#readIncoming();
    this.closed = this.#reader.then(
      () => transport.closed,
      (error) =>
        Promise.resolve({ reason: error instanceof Error ? error.message : String(error) }),
    );
  }

  get trace(): MessageRecorder {
    return this.#recorder;
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    this.#assertOpen();
    const id = this.#nextRequestId;
    this.#nextRequestId += 1;
    const message = { id, method, ...(params === undefined ? {} : { params }) };
    const result = new Promise<unknown>((resolve, reject) => {
      this.#pending.set(String(id), { method, resolve, reject });
    });

    try {
      await this.#send(message);
    } catch (error) {
      this.#pending.delete(String(id));
      throw error;
    }

    return result;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    this.#assertOpen();
    await this.#send({ method, ...(params === undefined ? {} : { params }) });
  }

  nextNotification(): Promise<JsonRpcNotification> {
    return this.#notifications.take();
  }

  nextServerRequest(): Promise<JsonRpcRequest> {
    return this.#serverRequests.take();
  }

  async respond(id: JsonRpcId, result: unknown): Promise<void> {
    this.#assertOpen();
    await this.#send({ id, result });
  }

  async respondError(id: JsonRpcId, error: JsonRpcErrorShape): Promise<void> {
    this.#assertOpen();
    await this.#send({ id, error });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const error = new JsonRpcProtocolError("JSON-RPC connection closed.");
    this.#failPending(error);
    this.#notifications.fail(error);
    this.#serverRequests.fail(error);
    await this.transport.close();
    await this.#reader.catch(() => undefined);
  }

  async #send(message: RecordedProtocolMessage): Promise<void> {
    this.#recorder.record("client-to-server", message);
    await this.transport.send(`${JSON.stringify(message)}\n`);
  }

  async #readIncoming(): Promise<void> {
    let remainder = "";
    try {
      for await (const chunk of this.transport.incoming) {
        remainder += chunk;
        const lines = remainder.split("\n");
        remainder = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim().length > 0) this.#route(decodeEnvelope(line));
        }
      }
      if (remainder.trim().length > 0) this.#route(decodeEnvelope(remainder));
      if (!this.#closed) {
        throw new JsonRpcProtocolError("JSON-RPC input ended before the connection was closed.");
      }
    } catch (error) {
      this.#closed = true;
      this.#failPending(error);
      this.#notifications.fail(error);
      this.#serverRequests.fail(error);
      throw error;
    }
  }

  #route(message: JsonRpcEnvelope): void {
    this.#recorder.record("server-to-client", message);

    if (isRequest(message)) {
      this.#serverRequests.offer(message);
      return;
    }
    if (isNotification(message)) {
      this.#notifications.offer(message);
      return;
    }

    const pending = this.#pending.get(String(message.id));
    if (!pending) return;
    this.#pending.delete(String(message.id));
    if (isErrorResponse(message)) {
      pending.reject(new JsonRpcResponseError(pending.method, message.id, message.error));
      return;
    }
    pending.resolve(message.result);
  }

  #failPending(error: unknown): void {
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new JsonRpcProtocolError("JSON-RPC connection is closed.");
    }
  }
}
