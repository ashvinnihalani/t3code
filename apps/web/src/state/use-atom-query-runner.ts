import { RegistryContext } from "@effect/atom-react";
import {
  executeAtomQuery,
  type AtomCommandOptions,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult, type Atom } from "effect/unstable/reactivity";
import * as Cause from "effect/Cause";
import { useCallback, useContext } from "react";
import { useOptionalAppServerController } from "../appServer/context";

export function useAtomQueryRunner<T, A, E>(
  family: (target: T) => Atom.Atom<AsyncResult.AsyncResult<A, E>>,
  options?: string | AtomCommandOptions,
): (target: T) => Promise<AtomCommandResult<A, E>> {
  const registry = useContext(RegistryContext);
  const appServer = useOptionalAppServerController();
  const explicitLabel = typeof options === "string" ? options : options?.label;
  const reportFailure = typeof options === "string" ? true : (options?.reportFailure ?? true);
  const reportDefect = typeof options === "string" ? true : (options?.reportDefect ?? true);

  return useCallback(
    (target: T) => {
      if (appServer !== null) {
        return Promise.resolve(
          AsyncResult.failure(
            Cause.fail(new Error("This T3 RPC query is not supported by app-server.")),
          ) as AtomCommandResult<A, E>,
        );
      }
      const atom = family(target);
      return executeAtomQuery(registry, atom, {
        label: explicitLabel ?? atom.label?.[0] ?? "atom query",
        reportFailure,
        reportDefect,
      });
    },
    [appServer, explicitLabel, family, registry, reportDefect, reportFailure],
  );
}
