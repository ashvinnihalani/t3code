export interface JsonlTransportClosed {
  readonly code?: number;
  readonly reason?: string;
}

export interface JsonlTransport {
  readonly incoming: AsyncIterable<string>;
  readonly closed: Promise<JsonlTransportClosed>;
  readonly send: (text: string) => Promise<void>;
  readonly close: () => Promise<void>;
}
