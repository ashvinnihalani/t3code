import * as NodeChildProcess from "node:child_process";

import type { JsonlTransport, JsonlTransportClosed } from "../protocol/JsonlTransport.ts";

export interface ChildProcessJsonlTransportInput {
  readonly executable: string;
  readonly args?: ReadonlyArray<string>;
  readonly cwd: string;
  readonly environment?: Readonly<Record<string, string>>;
}

const textChunks = async function* (
  stream: NodeJS.ReadableStream & AsyncIterable<Buffer | string>,
  capture: string[],
): AsyncGenerator<string> {
  for await (const chunk of stream) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    capture.push(text);
    yield text;
  }
};

export class ChildProcessJsonlTransport implements JsonlTransport {
  readonly #child: NodeChildProcess.ChildProcessWithoutNullStreams;
  readonly #stdout: string[] = [];
  readonly #stderr: string[] = [];
  #closing = false;

  readonly incoming: AsyncIterable<string>;
  readonly closed: Promise<JsonlTransportClosed>;

  constructor(child: NodeChildProcess.ChildProcessWithoutNullStreams) {
    this.#child = child;
    this.incoming = textChunks(child.stdout, this.#stdout);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => this.#stderr.push(chunk));
    this.closed = new Promise<JsonlTransportClosed>((resolve) => {
      child.once("error", (error) => resolve({ reason: error.message }));
      child.once("exit", (code, signal) =>
        resolve({
          ...(code === null ? {} : { code }),
          ...(signal === null ? {} : { reason: `terminated by ${signal}` }),
        }),
      );
    });
  }

  get pid(): number | undefined {
    return this.#child.pid;
  }

  get stdout(): string {
    return this.#stdout.join("");
  }

  get stderr(): string {
    return this.#stderr.join("");
  }

  send = (text: string): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      this.#child.stdin.write(text, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

  close = async (): Promise<void> => {
    if (this.#closing) return;
    this.#closing = true;
    this.#child.stdin.end();

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const exited = await Promise.race([
      this.closed.then(() => true),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), 2_000);
      }),
    ]);
    if (timeout !== undefined) clearTimeout(timeout);
    if (!exited) this.#child.kill("SIGTERM");
    await this.closed;
  };
}

export const spawnChildProcessJsonlTransport = (
  input: ChildProcessJsonlTransportInput,
): ChildProcessJsonlTransport => {
  const child = NodeChildProcess.spawn(input.executable, [...(input.args ?? [])], {
    cwd: input.cwd,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...input.environment },
  });
  return new ChildProcessJsonlTransport(child);
};
