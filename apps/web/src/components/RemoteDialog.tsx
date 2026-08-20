import { XIcon } from "lucide-react";

import type { RemoteDialogState } from "../appServer/useAppServerController";

export function RemoteDialog({
  state,
  onClose,
  onCheck,
}: {
  readonly state: RemoteDialogState;
  readonly onClose: () => void;
  readonly onCheck: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Remote pairing"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Pair your phone</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Pair through the official app-server Remote service.
            </p>
          </div>
          <button
            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onClose}
            aria-label="Close"
          >
            <XIcon className="size-4" />
          </button>
        </div>
        <div className="grid gap-4 p-5">
          {state.busy && state.pairing === null ? (
            <p className="text-sm text-muted-foreground">
              Requesting pairing details from app-server…
            </p>
          ) : null}
          {state.error ? (
            <p className="rounded-lg border border-destructive/20 bg-destructive/8 p-3 text-xs text-destructive-foreground">
              {state.error}
            </p>
          ) : null}
          {state.pairing ? (
            <div className="grid gap-4">
              <output className="rounded-xl border border-border bg-muted p-5 text-center font-mono text-2xl font-semibold tracking-[0.18em]">
                {state.pairing.manualPairingCode ?? state.pairing.pairingCode}
              </output>
              {state.pairing.manualPairingCode !== null ? (
                <details className="text-xs text-muted-foreground">
                  <summary>App-server pairing payload</summary>
                  <code className="mt-2 block [overflow-wrap:anywhere] rounded-md bg-muted p-3">
                    {state.pairing.pairingCode}
                  </code>
                </details>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Expires {new Date(state.pairing.expiresAt * 1000).toLocaleString()}
              </p>
              <button
                className="h-9 rounded-md border border-input bg-card px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
                disabled={state.busy}
                onClick={onCheck}
              >
                Check pairing
              </button>
            </div>
          ) : null}
          {state.clients.length > 0 ? (
            <div>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">Paired clients</h3>
              <div className="divide-y divide-border rounded-lg border border-border">
                {state.clients.map((client) => (
                  <div className="grid gap-0.5 px-3 py-2.5" key={client.clientId}>
                    <strong className="text-xs font-medium">
                      {client.displayName ?? client.deviceModel ?? "Remote client"}
                    </strong>
                    <small className="text-[11px] text-muted-foreground">
                      {client.platform ?? client.deviceType ?? client.clientId}
                    </small>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
