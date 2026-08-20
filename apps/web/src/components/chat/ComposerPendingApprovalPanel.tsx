import { FileCode2Icon, ShieldAlertIcon, TerminalSquareIcon } from "lucide-react";

import type { PendingApproval } from "../../appServer/useAppServerController";

export function ComposerPendingApprovalPanel({ approval }: { readonly approval: PendingApproval }) {
  return (
    <section className="mb-2 overflow-hidden rounded-xl border border-amber-500/25 bg-card shadow-lg">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
          {approval.kind === "command" ? (
            <TerminalSquareIcon className="size-4" />
          ) : (
            <FileCode2Icon className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <ShieldAlertIcon className="size-3.5 text-amber-600 dark:text-amber-400" />
            <h3 className="text-xs font-semibold">Approval required</h3>
          </div>
          <p className="mt-1 break-words font-mono text-xs leading-5">{approval.title}</p>
          {approval.reason ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{approval.reason}</p>
          ) : null}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border bg-muted/30 px-3 py-2">
        <button
          className="h-8 rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => approval.respond("decline")}
        >
          Deny
        </button>
        <button
          className="h-8 rounded-md border border-input bg-card px-3 text-xs font-medium hover:bg-accent"
          onClick={() => approval.respond("acceptForSession")}
        >
          Allow for session
        </button>
        <button
          className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          onClick={() => approval.respond("accept")}
        >
          Allow
        </button>
      </div>
    </section>
  );
}
