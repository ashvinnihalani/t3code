import type * as CodexClient from "./client.ts";
import type * as CodexError from "./errors.ts";
import * as Effect from "effect/Effect";

export type RemoteControlConnectionStatus = "disabled" | "connecting" | "connected" | "errored";

export interface RemoteControlStatus {
  readonly environmentId: string | null;
  readonly installationId: string;
  readonly serverName: string;
  readonly status: RemoteControlConnectionStatus;
}

export interface RemoteControlPairing {
  readonly environmentId: string;
  readonly expiresAt: number;
  readonly pairingCode: string;
  readonly manualPairingCode: string | null;
}

export interface RemoteControlClient {
  readonly clientId: string;
  readonly displayName?: string | null;
  readonly deviceType?: string | null;
  readonly deviceModel?: string | null;
  readonly platform?: string | null;
  readonly osVersion?: string | null;
  readonly appVersion?: string | null;
  readonly lastSeenAt?: number | null;
}

export interface RemoteControlClientsPage {
  readonly data: ReadonlyArray<RemoteControlClient>;
  readonly nextCursor?: string | null;
}

export class RemoteControlResponseError extends Error {
  override readonly name = "RemoteControlResponseError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeStatus(value: unknown): RemoteControlStatus {
  if (
    !isRecord(value) ||
    typeof value.installationId !== "string" ||
    typeof value.serverName !== "string" ||
    !["disabled", "connecting", "connected", "errored"].includes(String(value.status)) ||
    !(value.environmentId === null || typeof value.environmentId === "string")
  ) {
    throw new RemoteControlResponseError("App-server returned an invalid Remote status.");
  }
  return value as unknown as RemoteControlStatus;
}

function decodePairing(value: unknown): RemoteControlPairing {
  if (
    !isRecord(value) ||
    typeof value.environmentId !== "string" ||
    typeof value.expiresAt !== "number" ||
    typeof value.pairingCode !== "string" ||
    !(value.manualPairingCode === null || typeof value.manualPairingCode === "string")
  ) {
    throw new RemoteControlResponseError("App-server returned an invalid Remote pairing payload.");
  }
  return value as unknown as RemoteControlPairing;
}

function decodeClients(value: unknown): RemoteControlClientsPage {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new RemoteControlResponseError("App-server returned an invalid Remote client list.");
  }
  const clients = value.data.filter(
    (entry): entry is RemoteControlClient => isRecord(entry) && typeof entry.clientId === "string",
  );
  if (clients.length !== value.data.length) {
    throw new RemoteControlResponseError("App-server returned an invalid Remote client record.");
  }
  return {
    data: clients,
    nextCursor: typeof value.nextCursor === "string" ? value.nextCursor : null,
  };
}

type Client = {
  readonly raw: Pick<CodexClient.CodexAppServerClient["Service"]["raw"], "request">;
};
type RemoteEffect<A> = Effect.Effect<
  A,
  CodexError.CodexAppServerError | RemoteControlResponseError
>;

const decode = <A>(
  effect: Effect.Effect<unknown, CodexError.CodexAppServerError>,
  f: (value: unknown) => A,
) =>
  effect.pipe(
    Effect.flatMap((value) =>
      Effect.try({ try: () => f(value), catch: (error) => error as RemoteControlResponseError }),
    ),
  );

export const readStatus = (client: Client): RemoteEffect<RemoteControlStatus> =>
  decode(client.raw.request("remoteControl/status/read"), decodeStatus);

export const enable = (client: Client): RemoteEffect<RemoteControlStatus> =>
  decode(client.raw.request("remoteControl/enable", {}), decodeStatus);

export const disable = (client: Client): RemoteEffect<RemoteControlStatus> =>
  decode(client.raw.request("remoteControl/disable", {}), decodeStatus);

export const startPairing = (
  client: Client,
  options: { readonly manualCode: boolean } = { manualCode: false },
): RemoteEffect<RemoteControlPairing> =>
  decode(client.raw.request("remoteControl/pairing/start", options), decodePairing);

export const readPairingStatus = (
  client: Client,
  pairing: Pick<RemoteControlPairing, "pairingCode" | "manualPairingCode">,
): RemoteEffect<boolean> =>
  client.raw.request("remoteControl/pairing/status", pairing).pipe(
    Effect.flatMap((value) =>
      Effect.try({
        try: () => {
          if (!isRecord(value) || typeof value.claimed !== "boolean") {
            throw new RemoteControlResponseError(
              "App-server returned an invalid Remote pairing status.",
            );
          }
          return value.claimed;
        },
        catch: (error) => error as RemoteControlResponseError,
      }),
    ),
  );

export const listClients = (
  client: Client,
  environmentId: string,
): RemoteEffect<RemoteControlClientsPage> =>
  decode(
    client.raw.request("remoteControl/client/list", {
      environmentId,
      order: "desc",
      limit: 100,
    }),
    decodeClients,
  );

export const revokeClient = (
  client: Client,
  environmentId: string,
  clientId: string,
): Effect.Effect<void, CodexError.CodexAppServerError> =>
  client.raw
    .request("remoteControl/client/revoke", { environmentId, clientId })
    .pipe(Effect.asVoid);
