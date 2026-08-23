import { useAtomValue } from "@effect/atom-react";
import {
  connectionCatalogDisplayUrl,
  PrimaryConnectionTarget,
  type EnvironmentPresentation as BaseEnvironmentPresentation,
} from "@t3tools/client-runtime/connection";
import { Discovery } from "@t3tools/client-runtime/relay";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useMemo } from "react";

import { environmentCatalog } from "../connection/catalog";
import { environmentPresentations, useEnvironmentPresentation } from "./presentation";
import { primaryEnvironmentIdAtom } from "./primaryEnvironment";
import { useEnvironmentQuery } from "./query";
import { relayEnvironmentDiscovery } from "./relay";
import { usePreparedConnection } from "./session";
import { useOptionalAppServerController } from "../appServer/context";
import { environmentIdFor, toServerConfig } from "../appServer/upstreamAdapter";
import { Atom } from "effect/unstable/reactivity";

const EMPTY_CATALOG_ATOM = Atom.make({
  isReady: false,
  entries: new Map<EnvironmentId, never>(),
}).pipe(Atom.withLabel("web-environments:direct-catalog-empty"));
const DIRECT_NETWORK_STATUS_ATOM = Atom.make<"online">("online").pipe(
  Atom.withLabel("web-environments:direct-network-status"),
);
const EMPTY_PRESENTATIONS_ATOM = Atom.make<ReadonlyMap<EnvironmentId, BaseEnvironmentPresentation>>(
  new Map(),
).pipe(Atom.withLabel("web-environments:direct-presentations-empty"));
const EMPTY_ENVIRONMENT_ID_ATOM = Atom.make<EnvironmentId | null>(null).pipe(
  Atom.withLabel("web-environments:direct-environment-id-empty"),
);

export interface EnvironmentPresentation extends BaseEnvironmentPresentation {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly displayUrl: string | null;
  readonly relayManaged: boolean;
}

function projectEnvironmentPresentation(
  environmentId: EnvironmentId,
  presentation: BaseEnvironmentPresentation,
): EnvironmentPresentation {
  return {
    ...presentation,
    environmentId,
    label: presentation.entry.target.label,
    displayUrl: connectionCatalogDisplayUrl(presentation.entry),
    relayManaged: presentation.entry.target._tag === "RelayConnectionTarget",
  };
}

export function useEnvironments() {
  const appServer = useOptionalAppServerController();
  const catalog = useAtomValue(
    appServer === null ? environmentCatalog.catalogValueAtom : EMPTY_CATALOG_ATOM,
  );
  const networkStatus = useAtomValue(
    appServer === null ? environmentCatalog.networkStatusValueAtom : DIRECT_NETWORK_STATUS_ATOM,
  );
  const presentationById = useAtomValue(
    appServer === null ? environmentPresentations.presentationsAtom : EMPTY_PRESENTATIONS_ATOM,
  );

  const environments = useMemo(() => {
    if (appServer !== null) {
      return appServer.environments.map((environment): EnvironmentPresentation => {
        const environmentId = environmentIdFor(environment.profile.id);
        const target = new PrimaryConnectionTarget({
          environmentId,
          label: environment.profile.name,
          httpBaseUrl: "app-server://stdio",
          wsBaseUrl: "app-server://stdio",
        });
        return {
          environmentId,
          label: environment.profile.name,
          displayUrl:
            environment.profile.connection.kind === "ssh"
              ? environment.profile.connection.host
              : "Local",
          relayManaged: false,
          entry: { target, profile: Option.none() },
          connection: {
            phase: environment.phase,
            error: environment.error,
            traceId: null,
          },
          serverConfig: toServerConfig(appServer, environment.profile.id),
        };
      });
    }
    return [...presentationById.entries()].map(([environmentId, presentation]) =>
      projectEnvironmentPresentation(environmentId, presentation),
    );
  }, [appServer, presentationById]);

  const directPresentationById = useMemo(
    () => new Map(environments.map((environment) => [environment.environmentId, environment])),
    [environments],
  );

  return {
    isReady: appServer === null ? catalog.isReady : appServer.settings !== null,
    networkStatus,
    environments,
    presentationById: appServer === null ? presentationById : directPresentationById,
  };
}

export function usePrimaryEnvironmentId(): EnvironmentId | null {
  const appServer = useOptionalAppServerController();
  const environmentId = useAtomValue(
    appServer === null ? primaryEnvironmentIdAtom : EMPTY_ENVIRONMENT_ID_ATOM,
  );
  return appServer?.selectedEnvironmentId
    ? environmentIdFor(appServer.selectedEnvironmentId)
    : environmentId;
}

export function useEnvironment(
  environmentId: EnvironmentId | null,
): EnvironmentPresentation | null {
  const { presentation } = useEnvironmentPresentation(environmentId);
  const direct = useEnvironments().environments.find(
    (candidate) => candidate.environmentId === environmentId,
  );
  return useMemo(
    () =>
      direct ??
      (environmentId === null || presentation === null
        ? null
        : projectEnvironmentPresentation(environmentId, presentation)),
    [direct, environmentId, presentation],
  );
}

export function usePrimaryEnvironment(): EnvironmentPresentation | null {
  return useEnvironment(usePrimaryEnvironmentId());
}

export function useEnvironmentHttpBaseUrl(environmentId: EnvironmentId | null): string | null {
  const prepared = usePreparedConnection(environmentId);
  return Option.isSome(prepared) ? prepared.value.httpBaseUrl : null;
}

export function useRelayEnvironmentDiscovery(): Discovery.RelayEnvironmentDiscoveryState {
  return useAtomValue(relayEnvironmentDiscovery.stateValueAtom);
}

export function useEnvironmentConnectionState(environmentId: EnvironmentId) {
  return useEnvironmentQuery(environmentCatalog.stateAtom(environmentId));
}
