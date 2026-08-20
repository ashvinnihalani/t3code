import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import type * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import type { ChildProcessSpawner } from "effect/unstable/process";

export interface CodexAppServerWireTransport<InError = unknown, OutError = unknown> {
  readonly incoming: Stream.Stream<Uint8Array, InError>;
  readonly outgoing: Sink.Sink<void, string | Uint8Array, never, OutError>;
}

export interface CodexAppServerMessageEvent {
  readonly data: unknown;
}

export interface CodexAppServerMessagePort extends Stream.EventListener<CodexAppServerMessageEvent> {
  readonly postMessage: (message: string | Uint8Array) => void;
  readonly start: () => void;
}

export const fromStdio = (stdio: Stdio.Stdio): CodexAppServerWireTransport => ({
  incoming: stdio.stdin,
  outgoing: stdio.stdout(),
});

const encoder = new TextEncoder();
const isMessagePortPayload = Schema.is(Schema.Union([Schema.String, Schema.Uint8Array]));
const hasMessagePortPayload = (
  event: CodexAppServerMessageEvent,
): event is CodexAppServerMessageEvent & { readonly data: string | Uint8Array } =>
  isMessagePortPayload(event.data);

export const fromMessagePort = (
  port: CodexAppServerMessagePort,
): CodexAppServerWireTransport<never, never> => ({
  incoming: Stream.unwrap(
    Effect.sync(() => {
      port.start();
      return Stream.fromEventListener<CodexAppServerMessageEvent>(port, "message").pipe(
        Stream.filter(hasMessagePortPayload),
        Stream.map((event) =>
          typeof event.data === "string" ? encoder.encode(event.data) : event.data,
        ),
      );
    }),
  ),
  outgoing: Sink.forEach((message: string | Uint8Array) =>
    Effect.sync(() => port.postMessage(message)),
  ),
});

export const fromChildProcess = (
  handle: ChildProcessSpawner.ChildProcessHandle,
): CodexAppServerWireTransport => ({
  incoming: handle.stdout,
  outgoing: Sink.mapInput(handle.stdin, (chunk: string | Uint8Array) =>
    typeof chunk === "string" ? encoder.encode(chunk) : chunk,
  ),
});

export interface CodexAppServerInMemoryWireTransport {
  readonly transport: CodexAppServerWireTransport;
  readonly input: Queue.Queue<Uint8Array, Cause.Done<void>>;
  readonly output: Queue.Queue<string>;
}

export const makeInMemory = Effect.fn("CodexAppServerWireTransport.makeInMemory")(function* () {
  const input = yield* Queue.unbounded<Uint8Array, Cause.Done<void>>();
  const output = yield* Queue.unbounded<string>();
  const decoder = new TextDecoder();

  return {
    transport: {
      incoming: Stream.fromQueue(input),
      outgoing: Sink.forEach((chunk: string | Uint8Array) =>
        Queue.offer(
          output,
          typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true }),
        ),
      ),
    },
    input,
    output,
  } satisfies CodexAppServerInMemoryWireTransport;
});
