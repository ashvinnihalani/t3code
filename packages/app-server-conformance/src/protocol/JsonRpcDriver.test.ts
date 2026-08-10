import { describe, expect, it } from "@effect/vitest";

import { JsonRpcDriver, JsonRpcResponseError } from "./JsonRpcDriver.ts";
import type { JsonlTransport } from "./JsonlTransport.ts";

class AsyncTextQueue implements AsyncIterable<string> {
  readonly #values: string[] = [];
  readonly #waiters: Array<(value: IteratorResult<string>) => void> = [];
  #ended = false;

  push(value: string): void {
    const waiter = this.#waiters.shift();
    if (waiter) {
      waiter({ done: false, value });
      return;
    }
    this.#values.push(value);
  }

  end(): void {
    this.#ended = true;
    for (const waiter of this.#waiters.splice(0)) {
      waiter({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return {
      next: () => {
        const value = this.#values.shift();
        if (value !== undefined) return Promise.resolve({ done: false, value });
        if (this.#ended) return Promise.resolve({ done: true, value: undefined });
        return new Promise<IteratorResult<string>>((resolve) => this.#waiters.push(resolve));
      },
    };
  }
}

const makeTransportPair = (): readonly [JsonlTransport, JsonlTransport] => {
  const leftIncoming = new AsyncTextQueue();
  const rightIncoming = new AsyncTextQueue();
  let closed = false;
  let resolveClosed!: (value: {}) => void;
  const closedPromise = new Promise<{}>((resolve) => {
    resolveClosed = resolve;
  });

  const close = async () => {
    if (closed) return;
    closed = true;
    leftIncoming.end();
    rightIncoming.end();
    resolveClosed({});
  };

  return [
    {
      incoming: leftIncoming,
      closed: closedPromise,
      send: async (text) => rightIncoming.push(text),
      close,
    },
    {
      incoming: rightIncoming,
      closed: closedPromise,
      send: async (text) => leftIncoming.push(text),
      close,
    },
  ];
};

const readMessage = async (iterator: AsyncIterator<string>) => {
  const next = await iterator.next();
  if (next.done) throw new Error("Transport closed before a message arrived.");
  return JSON.parse(next.value.trim()) as Record<string, unknown>;
};

describe("JsonRpcDriver", () => {
  it("correlates concurrent responses and records both protocol directions", async () => {
    const [clientTransport, serverTransport] = makeTransportPair();
    const driver = new JsonRpcDriver(clientTransport);
    const serverIncoming = serverTransport.incoming[Symbol.asyncIterator]();

    const accountResult = driver.request("account/read", {});
    const modelResult = driver.request("model/list", { limit: 10 });
    const accountRequest = await readMessage(serverIncoming);
    const modelRequest = await readMessage(serverIncoming);

    await serverTransport.send(
      `${JSON.stringify({ id: modelRequest.id, result: { data: ["model-a"] } })}\n`,
    );
    await serverTransport.send(
      `${JSON.stringify({ id: accountRequest.id, result: { account: null } })}\n`,
    );

    await expect(accountResult).resolves.toEqual({ account: null });
    await expect(modelResult).resolves.toEqual({ data: ["model-a"] });
    expect(
      driver.trace.snapshot().map(({ direction, kind, method }) => ({
        direction,
        kind,
        method,
      })),
    ).toEqual([
      { direction: "client-to-server", kind: "request", method: "account/read" },
      { direction: "client-to-server", kind: "request", method: "model/list" },
      { direction: "server-to-client", kind: "response", method: undefined },
      { direction: "server-to-client", kind: "response", method: undefined },
    ]);

    await driver.close();
  });

  it("surfaces notifications, server requests, and JSON-RPC failures", async () => {
    const [clientTransport, serverTransport] = makeTransportPair();
    const driver = new JsonRpcDriver(clientTransport);
    const serverIncoming = serverTransport.incoming[Symbol.asyncIterator]();

    await serverTransport.send(`${JSON.stringify({ method: "skills/changed", params: {} })}\n`);
    await serverTransport.send(
      `${JSON.stringify({ id: "approval-1", method: "item/tool/requestUserInput", params: {} })}\n`,
    );

    await expect(driver.nextNotification()).resolves.toEqual({
      method: "skills/changed",
      params: {},
    });
    const request = await driver.nextServerRequest();
    expect(request.id).toBe("approval-1");
    await driver.respond(request.id, { answers: {} });
    expect(await readMessage(serverIncoming)).toEqual({
      id: "approval-1",
      result: { answers: {} },
    });

    const failed = driver.request("thread/read", { threadId: "missing" });
    const failedRequest = await readMessage(serverIncoming);
    await serverTransport.send(
      `${JSON.stringify({
        id: failedRequest.id,
        error: { code: -32_001, message: "Thread not found" },
      })}\n`,
    );
    await expect(failed).rejects.toBeInstanceOf(JsonRpcResponseError);

    await driver.close();
  });

  it("accepts messages split across transport chunks", async () => {
    const [clientTransport, serverTransport] = makeTransportPair();
    const driver = new JsonRpcDriver(clientTransport);
    const serverIncoming = serverTransport.incoming[Symbol.asyncIterator]();

    const result = driver.request("initialize", {});
    const request = await readMessage(serverIncoming);
    const response = `${JSON.stringify({ id: request.id, result: { userAgent: "test" } })}\n`;
    await serverTransport.send(response.slice(0, 8));
    await serverTransport.send(response.slice(8));

    await expect(result).resolves.toEqual({ userAgent: "test" });
    await driver.close();
  });
});
