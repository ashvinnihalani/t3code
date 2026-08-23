import { useAtomValue } from "@effect/atom-react";
import { createEnvironmentSessionAtoms } from "@t3tools/client-runtime/state/session";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { isDirectAppServerDesktop } from "../appServer/mode";
import { appAtomRegistry } from "../rpc/atomRegistry";

export const environmentSession = createEnvironmentSessionAtoms(connectionAtomRuntime);

const EMPTY_PREPARED_CONNECTION_ATOM = Atom.make(Option.none()).pipe(
  Atom.withLabel("web-prepared-connection:empty"),
);
const EMPTY_SESSION_STATE_ATOM = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("web-environment-session:empty"),
);

export function usePreparedConnection(environmentId: EnvironmentId | null) {
  return useAtomValue(
    isDirectAppServerDesktop() || environmentId === null
      ? EMPTY_PREPARED_CONNECTION_ATOM
      : environmentSession.preparedConnectionValueAtom(environmentId),
  );
}

export function readPreparedConnection(environmentId: EnvironmentId) {
  if (isDirectAppServerDesktop()) return null;
  return Option.getOrNull(
    appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(environmentId)),
  );
}

/**
 * This client's authenticated session on one environment, as reported by that
 * environment's `/api/auth/session` endpoint. `data` stays populated across
 * SWR revalidations; `isPending` is only meaningful before the first resolve.
 */
export function useEnvironmentSessionState(environmentId: EnvironmentId) {
  const direct = isDirectAppServerDesktop();
  const result = useAtomValue(
    direct ? EMPTY_SESSION_STATE_ATOM : environmentSession.sessionStateAtom(environmentId),
  );
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    hasError: result._tag === "Failure",
    isPending: !direct && result.waiting,
  };
}
