import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import {
  fromMessagePort,
  type CodexAppServerMessageEvent,
  type CodexAppServerMessagePort,
} from "./transport.ts";

class TestMessagePort implements CodexAppServerMessagePort {
  readonly sent: Array<string | Uint8Array> = [];
  readonly initialMessages: ReadonlyArray<unknown>;
  started = false;
  readonly listeners = new Set<(event: CodexAppServerMessageEvent) => void>();

  constructor(initialMessages: ReadonlyArray<unknown>) {
    this.initialMessages = initialMessages;
  }

  postMessage(message: string | Uint8Array): void {
    this.sent.push(message);
  }

  start(): void {
    this.started = true;
  }

  addEventListener(_event: string, listener: (event: CodexAppServerMessageEvent) => void): void {
    this.listeners.add(listener);
    for (const data of this.initialMessages) {
      listener({ data });
    }
  }

  removeEventListener(_event: string, listener: (event: CodexAppServerMessageEvent) => void): void {
    this.listeners.delete(listener);
  }
}

it.effect("bridges MessagePort strings and bytes without exposing invalid payloads", () =>
  Effect.gen(function* () {
    const port = new TestMessagePort([
      "one\n",
      { ignored: true },
      new TextEncoder().encode("two\n"),
    ]);
    const transport = fromMessagePort(port);
    const chunks = yield* transport.incoming.pipe(Stream.take(2), Stream.runCollect);
    assert.isTrue(port.started);
    assert.deepEqual(
      chunks.map((chunk) => new TextDecoder().decode(chunk)),
      ["one\n", "two\n"],
    );

    yield* Stream.fromIterable<string | Uint8Array>(["outgoing\n"]).pipe(
      Stream.run(transport.outgoing),
    );
    assert.deepEqual(port.sent, ["outgoing\n"]);
  }),
);
