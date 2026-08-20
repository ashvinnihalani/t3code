import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { listClients, readStatus, startPairing } from "./remote.ts";

function clientWithResponses(responses: Readonly<Record<string, unknown>>) {
  return {
    raw: {
      request: (method: string) => Effect.succeed(responses[method]),
    },
  } as Parameters<typeof readStatus>[0];
}

describe("app-server Remote client", () => {
  it.effect("uses official Remote methods and decodes app-server presentation data", () =>
    Effect.gen(function* () {
      const client = clientWithResponses({
        "remoteControl/status/read": {
          status: "connected",
          environmentId: "environment-1",
          installationId: "installation-1",
          serverName: "Workstation",
        },
        "remoteControl/pairing/start": {
          environmentId: "environment-1",
          expiresAt: 2_000_000_000,
          pairingCode: "app-server-owned-pairing-payload",
          manualPairingCode: "ABCD-EFGH",
        },
        "remoteControl/client/list": {
          data: [{ clientId: "phone-1", displayName: "Phone" }],
          nextCursor: null,
        },
      });

      expect(yield* readStatus(client)).toMatchObject({
        status: "connected",
        environmentId: "environment-1",
      });
      expect(yield* startPairing(client, { manualCode: true })).toMatchObject({
        pairingCode: "app-server-owned-pairing-payload",
        manualPairingCode: "ABCD-EFGH",
      });
      expect((yield* listClients(client, "environment-1")).data).toEqual([
        { clientId: "phone-1", displayName: "Phone" },
      ]);
    }),
  );

  it.effect("rejects malformed Remote responses", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        readStatus(clientWithResponses({ "remoteControl/status/read": { status: "connected" } })),
      );
      expect(result._tag).toBe("Failure");
    }),
  );
});
