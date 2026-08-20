import { FolderOpenIcon, XIcon } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import type { EnvironmentState } from "../appServer/useAppServerController";

export function AddProjectDialog({
  environments,
  initialEnvironmentId,
  onAdd,
  onClose,
}: {
  readonly environments: ReadonlyArray<EnvironmentState>;
  readonly initialEnvironmentId: string | null;
  readonly onAdd: (environmentId: string, workspace: string) => void;
  readonly onClose: () => void;
}) {
  const initialEnvironment =
    environments.find((environment) => environment.profile.id === initialEnvironmentId) ??
    environments[0];
  const [environmentId, setEnvironmentId] = useState(initialEnvironment?.profile.id ?? "");
  const [workspace, setWorkspace] = useState(
    initialEnvironment?.profile.connection.workspace ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const environment = useMemo(
    () => environments.find((candidate) => candidate.profile.id === environmentId),
    [environmentId, environments],
  );

  const chooseLocalDirectory = async () => {
    const bridge = window.desktopBridge;
    if (bridge === undefined) {
      setError("The desktop directory picker is unavailable.");
      return;
    }
    try {
      const selected = await bridge.selectProjectDirectory(workspace);
      if (selected !== null) setWorkspace(selected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalized = workspace.trim();
    if (environment === undefined || !normalized) {
      setError("Choose an environment and project directory.");
      return;
    }
    onAdd(environment.profile.id, normalized);
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
      role="presentation"
      onMouseDown={onClose}
    >
      <form
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Add project"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Add project</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose the app-server environment and working directory.
            </p>
          </div>
          <button
            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            <XIcon className="size-4" />
          </button>
        </div>
        <div className="grid gap-4 p-5">
          <label className="grid gap-1.5 text-xs font-medium">
            Environment
            <select
              className="h-10 rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              value={environmentId}
              onChange={(event) => {
                const next = environments.find(
                  (candidate) => candidate.profile.id === event.target.value,
                );
                setEnvironmentId(event.target.value);
                if (next !== undefined) setWorkspace(next.profile.connection.workspace);
              }}
            >
              {environments.map((candidate) => (
                <option key={candidate.profile.id} value={candidate.profile.id}>
                  {candidate.profile.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            Project directory
            <div className="flex gap-2">
              <input
                className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-card px-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ring/40"
                placeholder={
                  environment?.profile.connection.kind === "ssh"
                    ? "/remote/path/to/project"
                    : "/path/to/project"
                }
                value={workspace}
                onChange={(event) => setWorkspace(event.target.value)}
              />
              {environment?.profile.connection.kind === "local" ? (
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-input bg-card px-3 text-xs font-medium hover:bg-accent"
                  type="button"
                  onClick={() => void chooseLocalDirectory()}
                >
                  <FolderOpenIcon className="size-4" /> Browse
                </button>
              ) : null}
            </div>
            <span className="font-normal text-muted-foreground">
              {environment?.profile.connection.kind === "ssh"
                ? "Enter a directory on the remote SSH machine."
                : "The native picker selects a directory on this Mac."}
            </span>
          </label>
          {error ? (
            <p className="rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-xs text-destructive-foreground">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button
            className="h-9 rounded-md border border-input bg-card px-4 text-xs font-medium hover:bg-accent"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="h-9 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            type="submit"
          >
            Add project
          </button>
        </div>
      </form>
    </div>
  );
}
