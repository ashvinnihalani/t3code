import { CheckIcon, MonitorCogIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { SettingsDraft } from "../../appServer/useAppServerController";
import type { DiscoveredSshHost } from "effect-codex-app-server/connection";

const inputClass =
  "h-9 rounded-md border border-input bg-card px-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ring/40";
const textareaClass =
  "rounded-md border border-input bg-card px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring/40";

export function SettingsPanels({
  initialDraft,
  sshHosts,
  error,
  onSave,
}: {
  readonly initialDraft: SettingsDraft;
  readonly sshHosts: ReadonlyArray<DiscoveredSshHost>;
  readonly error: string | null;
  readonly onSave: (draft: SettingsDraft) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    await onSave(draft);
    setSaving(false);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl gap-12 px-10 py-10">
        <nav className="w-48 shrink-0">
          <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">Desktop</p>
          <button className="flex h-9 w-full items-center gap-2 rounded-md bg-accent px-2 text-sm font-medium">
            <MonitorCogIcon className="size-4" /> Connection
          </button>
        </nav>
        <form className="min-w-0 flex-1" onSubmit={(event) => void submit(event)}>
          <div className="mb-8">
            <h2 className="text-xl font-semibold tracking-tight">Connection</h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
              Choose the Codex-compatible app-server controlled by this desktop. Thread history
              remains cached locally while the app-server is authoritative.
            </p>
          </div>

          <section className="border-b border-border py-6 first:pt-0">
            <div className="flex items-start justify-between gap-10">
              <div>
                <h3 className="text-sm font-medium">App-server location</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Launch on this Mac or through an existing OpenSSH host.
                </p>
              </div>
              <div className="flex rounded-lg border border-input bg-muted p-1">
                {(["local", "ssh"] as const).map((kind) => (
                  <button
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${draft.kind === kind ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    key={kind}
                    type="button"
                    onClick={() => setDraft({ ...draft, kind })}
                  >
                    {kind === "local" ? "Local" : "Remote SSH"}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <div className="grid grid-cols-2 gap-5 py-6">
            {draft.kind === "ssh" ? (
              <>
                <label className="grid gap-2 text-xs font-medium">
                  SSH host
                  <input
                    className={inputClass}
                    list="ssh-hosts"
                    value={draft.host}
                    onChange={(event) => setDraft({ ...draft, host: event.target.value })}
                  />
                  <datalist id="ssh-hosts">
                    {sshHosts.map((host) => (
                      <option value={host.alias} key={host.alias} />
                    ))}
                  </datalist>
                </label>
                <label className="grid gap-2 text-xs font-medium">
                  Username
                  <input
                    className={inputClass}
                    placeholder="From SSH config"
                    value={draft.username}
                    onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                  />
                </label>
                <label className="grid gap-2 text-xs font-medium">
                  Port
                  <input
                    className={inputClass}
                    inputMode="numeric"
                    placeholder="22"
                    value={draft.port}
                    onChange={(event) => setDraft({ ...draft, port: event.target.value })}
                  />
                </label>
                <label className="grid gap-2 text-xs font-medium">
                  Identity file
                  <input
                    className={inputClass}
                    placeholder="From SSH config or agent"
                    value={draft.identityFile}
                    onChange={(event) => setDraft({ ...draft, identityFile: event.target.value })}
                  />
                </label>
              </>
            ) : null}
            <label className="grid gap-2 text-xs font-medium">
              Executable
              <input
                className={inputClass}
                value={draft.executable}
                onChange={(event) => setDraft({ ...draft, executable: event.target.value })}
              />
            </label>
            <label className="grid gap-2 text-xs font-medium">
              Workspace
              <input
                className={inputClass}
                value={draft.workspace}
                onChange={(event) => setDraft({ ...draft, workspace: event.target.value })}
              />
            </label>
            <label className="col-span-2 grid gap-2 text-xs font-medium">
              Arguments (JSON)
              <textarea
                className={`${textareaClass} min-h-24`}
                value={draft.args}
                onChange={(event) => setDraft({ ...draft, args: event.target.value })}
              />
            </label>
            <label className="col-span-2 grid gap-2 text-xs font-medium">
              Environment (JSON)
              <textarea
                className={`${textareaClass} min-h-28`}
                value={draft.env}
                onChange={(event) => setDraft({ ...draft, env: event.target.value })}
              />
            </label>
          </div>
          {error ? <p className="mb-4 text-xs text-destructive-foreground">{error}</p> : null}
          <div className="flex justify-end border-t border-border pt-5">
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              disabled={saving}
              type="submit"
            >
              <CheckIcon className="size-3.5" /> {saving ? "Saving…" : "Save and reconnect"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
