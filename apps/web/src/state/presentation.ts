import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentPresentation } from "@t3tools/client-runtime/connection";
import { createEnvironmentPresentationAtoms } from "@t3tools/client-runtime/state/presentation";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { serverEnvironment } from "./server";
import { useOptionalAppServerController } from "../appServer/context";

export const environmentPresentations = createEnvironmentPresentationAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  stateAtom: environmentCatalog.stateAtom,
  serverConfigValueAtom: serverEnvironment.configValueAtom,
});

const EMPTY_ENVIRONMENT_PRESENTATION_ATOM = Atom.make<EnvironmentPresentation | null>(null).pipe(
  Atom.withLabel("web-environment-presentation:empty"),
);
const EMPTY_ENVIRONMENT_CATALOG_ATOM = Atom.make({
  isReady: false,
  entries: new Map<EnvironmentId, never>(),
}).pipe(Atom.withLabel("web-environment-catalog:direct-empty"));

export function useEnvironmentPresentation(environmentId: EnvironmentId | null) {
  const appServer = useOptionalAppServerController();
  const catalog = useAtomValue(
    appServer === null ? environmentCatalog.catalogValueAtom : EMPTY_ENVIRONMENT_CATALOG_ATOM,
  );
  const presentation = useAtomValue(
    appServer !== null || environmentId === null
      ? EMPTY_ENVIRONMENT_PRESENTATION_ATOM
      : environmentPresentations.presentationAtom(environmentId),
  );
  return {
    isReady: appServer !== null || catalog.isReady,
    presentation,
  };
}
