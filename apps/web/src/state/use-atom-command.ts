import { RegistryContext } from "@effect/atom-react";
import {
  type AtomCommand,
  type AtomCommandOptions,
  type AtomCommandResult,
  runAtomCommand,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback, useContext } from "react";
import { runAppServerCommand, useOptionalAppServerController } from "../appServer/context";

export function useAtomCommand<A, E, W>(
  command: AtomCommand<W, A, E>,
  options?: string | AtomCommandOptions,
): (value: W) => Promise<AtomCommandResult<A, E>> {
  const registry = useContext(RegistryContext);
  const appServer = useOptionalAppServerController();
  const label = typeof options === "string" ? options : (options?.label ?? command.label);
  const reportFailure = typeof options === "string" ? true : (options?.reportFailure ?? true);
  const reportDefect = typeof options === "string" ? true : (options?.reportDefect ?? true);

  return useCallback(
    (value: W) =>
      appServer === null
        ? runAtomCommand(registry, command, value, { label, reportFailure, reportDefect })
        : (runAppServerCommand(appServer, command.label, value) as Promise<
            AtomCommandResult<A, E>
          >),
    [appServer, command, label, registry, reportDefect, reportFailure],
  );
}
