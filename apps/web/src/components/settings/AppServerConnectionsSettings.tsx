import {
  CirclePlusIcon,
  PencilIcon,
  RefreshCwIcon,
  SmartphoneIcon,
  Trash2Icon,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  newSshSettingsDraft,
  toSettingsDraft,
  type SettingsDraft,
} from "../../appServer/useAppServerController";
import { useOptionalAppServerController } from "../../appServer/context";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

function ConnectionEditor({
  draft,
  onChange,
  onCancel,
  onSave,
  saving,
  sshHosts,
}: {
  readonly draft: SettingsDraft;
  readonly onChange: (draft: SettingsDraft) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly saving: boolean;
  readonly sshHosts: ReadonlyArray<{ readonly alias: string }>;
}) {
  const field = (key: keyof SettingsDraft) => (value: string) =>
    onChange({ ...draft, [key]: value });

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            {draft.kind === "local" ? "Local app-server" : "SSH app-server"}
          </DialogTitle>
          <DialogDescription>
            Launch a Codex-compatible app-server over stdio. All configured connections stay
            available concurrently.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="app-server-name">Name</Label>
            <Input id="app-server-name" value={draft.name} onValueChange={field("name")} />
          </div>
          {draft.kind === "ssh" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 grid gap-1.5">
                <Label htmlFor="app-server-host">SSH host</Label>
                <Input
                  id="app-server-host"
                  list="app-server-ssh-hosts"
                  value={draft.host}
                  onValueChange={field("host")}
                />
                <datalist id="app-server-ssh-hosts">
                  {sshHosts.map((host) => (
                    <option key={host.alias} value={host.alias} />
                  ))}
                </datalist>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="app-server-user">Username</Label>
                <Input
                  id="app-server-user"
                  value={draft.username}
                  onValueChange={field("username")}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="app-server-port">Port</Label>
                <Input
                  id="app-server-port"
                  inputMode="numeric"
                  placeholder="22"
                  value={draft.port}
                  onValueChange={field("port")}
                />
              </div>
              <div className="col-span-2 grid gap-1.5">
                <Label htmlFor="app-server-identity">Identity file</Label>
                <Input
                  id="app-server-identity"
                  placeholder="Use OpenSSH configuration"
                  value={draft.identityFile}
                  onValueChange={field("identityFile")}
                />
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="app-server-executable">Executable</Label>
              <Input
                id="app-server-executable"
                value={draft.executable}
                onValueChange={field("executable")}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="app-server-workspace">Default workspace</Label>
              <Input
                id="app-server-workspace"
                value={draft.workspace}
                onValueChange={field("workspace")}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="app-server-arguments">Arguments (JSON)</Label>
            <Textarea
              id="app-server-arguments"
              className="font-mono"
              value={draft.args}
              onChange={(event) => field("args")(event.currentTarget.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="app-server-environment">Environment (JSON)</Label>
            <Textarea
              id="app-server-environment"
              className="font-mono"
              value={draft.env}
              onChange={(event) => field("env")(event.currentTarget.value)}
            />
          </div>
          {draft.kind === "ssh" ? (
            <label className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">Persistent remote control</span>
                <span className="text-xs text-muted-foreground">
                  Use this executable to bootstrap a daemon and connect through its app-server
                  proxy, so turns continue after the desktop closes.
                </span>
              </span>
              <Switch
                aria-label="Persistent remote control"
                checked={draft.persistent}
                onCheckedChange={(checked) => onChange({ ...draft, persistent: Boolean(checked) })}
              />
            </label>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={onSave}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function RemotePairingDialog() {
  const controller = useOptionalAppServerController();
  if (controller === null) return null;
  const state = controller.remote;
  return (
    <Dialog
      open={state.connectionId !== null}
      onOpenChange={(open) => !open && controller.closeRemotePairing()}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            Pair your phone{state.connectionName ? ` with ${state.connectionName}` : ""}
          </DialogTitle>
          <DialogDescription>
            Pair through this connection’s official Codex app-server Remote service.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {state.busy && state.pairing === null ? (
            <p className="text-sm text-muted-foreground">Requesting pairing details…</p>
          ) : null}
          {state.error ? (
            <p className="rounded-lg border border-destructive/24 bg-destructive/8 p-3 text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
          {state.pairing ? (
            <div className="space-y-3">
              <output className="block rounded-xl border bg-muted p-5 text-center font-mono text-2xl font-semibold tracking-[0.18em]">
                {state.pairing.manualPairingCode ?? state.pairing.pairingCode}
              </output>
              <p className="text-xs text-muted-foreground">
                Expires {new Date(state.pairing.expiresAt * 1_000).toLocaleString()}
              </p>
              <Button
                className="w-full"
                disabled={state.busy}
                variant="outline"
                onClick={() => void controller.checkRemotePairing()}
              >
                Check pairing
              </Button>
            </div>
          ) : null}
          {state.clients.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Paired clients</h3>
              <div className="divide-y rounded-lg border">
                {state.clients.map((client) => (
                  <div className="px-3 py-2.5" key={client.clientId}>
                    <div className="text-sm font-medium">
                      {client.displayName ?? client.deviceModel ?? "Remote client"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {client.platform ?? client.deviceType ?? client.clientId}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

export function AppServerConnectionsSettings() {
  const controller = useOptionalAppServerController();
  const [editing, setEditing] = useState<SettingsDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const localProfile = controller?.settings?.connections.find((profile) => profile.id === "local");
  const environmentsById = useMemo(
    () =>
      new Map(controller?.environments.map((environment) => [environment.profile.id, environment])),
    [controller?.environments],
  );

  if (controller === null) return null;

  const save = async () => {
    if (editing === null) return;
    setSaving(true);
    const saved = await controller.saveEnvironment(editing);
    setSaving(false);
    if (saved) setEditing(null);
  };

  const addSsh = () => {
    if (localProfile !== undefined) setEditing(newSshSettingsDraft(localProfile));
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Connections"
        headerAction={
          <Button
            size="sm"
            variant="outline"
            disabled={localProfile === undefined}
            onClick={addSsh}
          >
            <CirclePlusIcon /> Add SSH host
          </Button>
        }
      >
        {controller.settings?.connections.map((profile) => {
          const environment = environmentsById.get(profile.id);
          const location =
            profile.connection.kind === "ssh"
              ? `${profile.connection.username ? `${profile.connection.username}@` : ""}${profile.connection.host}`
              : "This Mac";
          return (
            <SettingsRow
              key={profile.id}
              title={profile.name}
              description={`${location} · ${profile.connection.workspace}`}
              status={
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`size-1.5 rounded-full ${environment?.phase === "connected" ? "bg-success" : "bg-warning"}`}
                  />
                  {environment?.phase === "connected"
                    ? "Connected"
                    : environment?.phase === "reconnecting"
                      ? `Reconnecting${environment.error ? ` · ${environment.error}` : ""}`
                      : "Connecting"}
                </span>
              }
              control={
                <div className="flex flex-wrap justify-end gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={environment?.phase === "connected"}
                    onClick={() => controller.retry(profile.id)}
                  >
                    <RefreshCwIcon /> Retry
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={environment?.phase !== "connected"}
                    onClick={() => void controller.beginRemotePairing(profile.id)}
                  >
                    <SmartphoneIcon /> Pair
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Edit ${profile.name}`}
                    onClick={() => setEditing(toSettingsDraft(profile))}
                  >
                    <PencilIcon />
                  </Button>
                  {profile.id !== "local" ? (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${profile.name}`}
                      onClick={() => {
                        if (
                          window.confirm(`Remove ${profile.name} and its locally cached projects?`)
                        ) {
                          void controller.removeEnvironment(profile.id);
                        }
                      }}
                    >
                      <Trash2Icon />
                    </Button>
                  ) : null}
                </div>
              }
            />
          );
        })}
      </SettingsSection>
      {controller.settingsError ? (
        <p className="px-4 text-sm text-destructive">{controller.settingsError}</p>
      ) : null}
      {editing ? (
        <ConnectionEditor
          draft={editing}
          onChange={setEditing}
          onCancel={() => setEditing(null)}
          onSave={() => void save()}
          saving={saving}
          sshHosts={controller.sshHosts}
        />
      ) : null}
      <RemotePairingDialog />
    </SettingsPageContainer>
  );
}
