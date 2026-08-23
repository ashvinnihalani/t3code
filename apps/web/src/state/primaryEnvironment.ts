import { Atom } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { isDirectAppServerDesktop } from "../appServer/mode";

export const primaryEnvironmentIdAtom = Atom.make((get) => {
  // The direct controller owns connection selection. Avoid mounting the
  // removed T3 connection catalog through this derived atom.
  if (isDirectAppServerDesktop()) return null;
  for (const [environmentId, entry] of get(environmentCatalog.catalogValueAtom).entries) {
    if (entry.target._tag === "PrimaryConnectionTarget") {
      return environmentId;
    }
  }
  return null;
}).pipe(Atom.withLabel("web-primary-environment-id"));
