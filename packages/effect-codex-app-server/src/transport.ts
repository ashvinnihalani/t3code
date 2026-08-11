import type * as Sink from "effect/Sink";
import type * as Stdio from "effect/Stdio";
import type * as Stream from "effect/Stream";

export interface CodexAppServerWireTransport {
  readonly incoming: Stream.Stream<Uint8Array, unknown>;
  readonly outgoing: Sink.Sink<void, string | Uint8Array, never, unknown>;
}

export const fromStdio = (stdio: Stdio.Stdio): CodexAppServerWireTransport => ({
  incoming: stdio.stdin,
  outgoing: stdio.stdout(),
});
