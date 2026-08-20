import type { DiscoveredSshHost } from "effect-codex-app-server/connection";
import { CheckIcon, LaptopIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import type { SettingsDraft } from "../../appServer/useAppServerController";
import type {
  ColorScheme,
  PresentationPreferences,
  TimestampFormat,
} from "../../settings/presentationPreferences";
import type { SettingsSectionId } from "./SettingsSidebarNav";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "./settingsLayout";

const inputClass =
  "h-9 w-72 rounded-lg border border-input bg-card px-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ring/40";
const textareaClass =
  "min-h-24 w-72 resize-y rounded-lg border border-input bg-card px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring/40";

function GeneralSettingsPanel({
  preferences,
  onUpdatePreferences,
}: {
  readonly preferences: PresentationPreferences;
  readonly onUpdatePreferences: (change: Partial<PresentationPreferences>) => void;
}) {
  return (
    <SettingsPageContainer>
      <SettingsSection title="General">
        <SettingsRow
          title="Project grouping"
          description="Group app-server threads by the working directory captured on each thread."
          control={
            <SettingsSwitch
              checked={preferences.groupProjects}
              label="Project grouping"
              onChange={(groupProjects) => onUpdatePreferences({ groupProjects })}
            />
          }
        />
        <SettingsRow
          title="Time format"
          description="System default follows your browser or OS clock preference."
          control={
            <SettingsSelect
              label="Timestamp format"
              value={preferences.timestampFormat}
              onChange={(value) =>
                onUpdatePreferences({ timestampFormat: value as TimestampFormat })
              }
            >
              <option value="locale">System default</option>
              <option value="12-hour">12-hour</option>
              <option value="24-hour">24-hour</option>
            </SettingsSelect>
          }
        />
        <SettingsRow
          title="Local thread cache"
          description="Keep project and thread summaries on this device so the sidebar remains useful while disconnected."
          status="Required by this desktop client and always enabled."
          control={<StatusPill>Enabled</StatusPill>}
        />
        <SettingsRow
          title="Automatic reconnection"
          description="Reconnect to the selected local or SSH app-server after its transport disconnects."
          status="Retries use a bounded backoff and resume the selected thread after reconnecting."
          control={<StatusPill>Automatic</StatusPill>}
        />
      </SettingsSection>
      <SettingsSection title="About">
        <SettingsRow
          title="Version"
          description="T3 Codex is a focused fork of T3 Code for Codex app-server compatible agents."
          control={
            <code className="rounded-md bg-muted px-2.5 py-1.5 text-xs">
              {import.meta.env.APP_VERSION}
            </code>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function StatusPill({ children }: { readonly children: ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

const COLOR_SCHEMES: ReadonlyArray<{
  readonly id: ColorScheme;
  readonly label: string;
  readonly icon: typeof MonitorIcon;
}> = [
  { id: "system", label: "System", icon: LaptopIcon },
  { id: "light", label: "Light", icon: SunIcon },
  { id: "dark", label: "Dark", icon: MoonIcon },
];

function FontSizeControl({
  label,
  value,
  min,
  max,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        aria-label={label}
        className="settings-slider w-36"
        max={max}
        min={min}
        type="range"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output className="w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs tabular-nums">
        {value}px
      </output>
    </div>
  );
}

function AppearanceSettingsPanel({
  preferences,
  onUpdatePreferences,
}: {
  readonly preferences: PresentationPreferences;
  readonly onUpdatePreferences: (change: Partial<PresentationPreferences>) => void;
}) {
  return (
    <SettingsPageContainer>
      <SettingsSection title="Appearance">
        <SettingsRow
          title="Color scheme"
          description="Choose whether T3 Codex follows macOS or uses a fixed light or dark appearance."
          control={
            <div className="flex rounded-lg border border-input bg-muted p-1">
              {COLOR_SCHEMES.map(({ id, label, icon: Icon }) => (
                <button
                  aria-pressed={preferences.colorScheme === id}
                  className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium ${preferences.colorScheme === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  key={id}
                  type="button"
                  onClick={() => onUpdatePreferences({ colorScheme: id })}
                >
                  <Icon className="size-3.5" /> {label}
                </button>
              ))}
            </div>
          }
        />
      </SettingsSection>
      <SettingsSection title="Typography">
        <SettingsRow
          title="Interface font size"
          description="Sidebar, settings, navigation, and general controls."
          control={
            <FontSizeControl
              label="Interface font size"
              max={19}
              min={13}
              value={preferences.interfaceFontSize}
              onChange={(interfaceFontSize) => onUpdatePreferences({ interfaceFontSize })}
            />
          }
        />
        <SettingsRow
          title="Prompt font size"
          description="The composer where you write prompts to the connected agent."
          control={
            <FontSizeControl
              label="Prompt font size"
              max={20}
              min={12}
              value={preferences.promptFontSize}
              onChange={(promptFontSize) => onUpdatePreferences({ promptFontSize })}
            />
          }
        />
        <SettingsRow
          title="Code font size"
          description="Command output, tool details, file paths, and code-like values."
          control={
            <FontSizeControl
              label="Code font size"
              max={18}
              min={10}
              value={preferences.codeFontSize}
              onChange={(codeFontSize) => onUpdatePreferences({ codeFontSize })}
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function ConnectionsSettingsPanel({
  initialDraft,
  sshHosts,
  error,
  remoteStatus,
  onOpenRemote,
  onSave,
}: {
  readonly initialDraft: SettingsDraft;
  readonly sshHosts: ReadonlyArray<DiscoveredSshHost>;
  readonly error: string | null;
  readonly remoteStatus: string | null;
  readonly onOpenRemote: () => void;
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
    <form className="min-h-0 flex flex-1 flex-col" onSubmit={(event) => void submit(event)}>
      <SettingsPageContainer>
        <SettingsSection title="Connections">
          <SettingsRow
            title="App-server location"
            description="Launch Codex on this Mac or connect through an existing OpenSSH host."
            control={
              <div className="flex rounded-lg border border-input bg-muted p-1">
                {(["local", "ssh"] as const).map((kind) => (
                  <button
                    className={`rounded-md px-3 py-1.5 text-xs font-medium ${draft.kind === kind ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    key={kind}
                    type="button"
                    onClick={() => setDraft({ ...draft, kind })}
                  >
                    {kind === "local" ? "Local" : "Remote SSH"}
                  </button>
                ))}
              </div>
            }
          />
          {draft.kind === "ssh" ? (
            <>
              <SettingsRow
                title="SSH host"
                description="An alias from ~/.ssh/config or a reachable hostname."
                control={
                  <>
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
                  </>
                }
              />
              <SettingsRow
                title="Username"
                description="Leave blank to use the username from OpenSSH configuration."
                control={
                  <input
                    className={inputClass}
                    placeholder="From SSH config"
                    value={draft.username}
                    onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                  />
                }
              />
              <SettingsRow
                title="Port"
                description="Leave blank to use port 22 or the value from OpenSSH configuration."
                control={
                  <input
                    className={inputClass}
                    inputMode="numeric"
                    placeholder="22"
                    value={draft.port}
                    onChange={(event) => setDraft({ ...draft, port: event.target.value })}
                  />
                }
              />
              <SettingsRow
                title="Identity file"
                description="Optional private key path. OpenSSH agents and config continue to work."
                control={
                  <input
                    className={inputClass}
                    placeholder="From SSH config or agent"
                    value={draft.identityFile}
                    onChange={(event) => setDraft({ ...draft, identityFile: event.target.value })}
                  />
                }
              />
            </>
          ) : null}
          <SettingsRow
            title="Executable"
            description="The local or remote executable that implements the Codex app-server protocol."
            control={
              <input
                className={inputClass}
                value={draft.executable}
                onChange={(event) => setDraft({ ...draft, executable: event.target.value })}
              />
            }
          />
          <SettingsRow
            title="Workspace"
            description="Default working directory for new threads and the app-server process."
            control={
              <input
                className={inputClass}
                value={draft.workspace}
                onChange={(event) => setDraft({ ...draft, workspace: event.target.value })}
              />
            }
          />
          <SettingsRow
            title="Arguments"
            description="JSON array passed to the executable. Codex normally uses app-server."
            control={
              <textarea
                className={textareaClass}
                value={draft.args}
                onChange={(event) => setDraft({ ...draft, args: event.target.value })}
              />
            }
          />
          <SettingsRow
            title="Environment"
            description="JSON object merged into the app-server process environment."
            control={
              <textarea
                className={textareaClass}
                value={draft.env}
                onChange={(event) => setDraft({ ...draft, env: event.target.value })}
              />
            }
          />
        </SettingsSection>
        <SettingsSection title="Remote">
          <SettingsRow
            title="Pair a phone"
            description="Use the connected app-server's official Remote service to control this environment from another device."
            status={
              remoteStatus === null
                ? "Remote status is unavailable until app-server connects."
                : `App-server reports Remote as ${remoteStatus}.`
            }
            control={
              <button
                className="h-9 rounded-lg border border-input bg-card px-3 text-xs font-medium hover:bg-accent"
                type="button"
                onClick={onOpenRemote}
              >
                Pair phone
              </button>
            }
          />
        </SettingsSection>
        {error ? (
          <p className="mx-4 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-xs text-destructive-foreground">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end border-t border-border px-4 pt-5">
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={saving}
            type="submit"
          >
            <CheckIcon className="size-3.5" /> {saving ? "Saving…" : "Save and reconnect"}
          </button>
        </div>
      </SettingsPageContainer>
    </form>
  );
}

export function SettingsPanels({
  section,
  preferences,
  initialDraft,
  sshHosts,
  error,
  remoteStatus,
  onOpenRemote,
  onUpdatePreferences,
  onSave,
}: {
  readonly section: SettingsSectionId;
  readonly preferences: PresentationPreferences;
  readonly initialDraft: SettingsDraft;
  readonly sshHosts: ReadonlyArray<DiscoveredSshHost>;
  readonly error: string | null;
  readonly remoteStatus: string | null;
  readonly onOpenRemote: () => void;
  readonly onUpdatePreferences: (change: Partial<PresentationPreferences>) => void;
  readonly onSave: (draft: SettingsDraft) => Promise<boolean>;
}) {
  if (section === "appearance") {
    return (
      <AppearanceSettingsPanel
        preferences={preferences}
        onUpdatePreferences={onUpdatePreferences}
      />
    );
  }
  if (section === "connections") {
    return (
      <ConnectionsSettingsPanel
        error={error}
        initialDraft={initialDraft}
        remoteStatus={remoteStatus}
        sshHosts={sshHosts}
        onOpenRemote={onOpenRemote}
        onSave={onSave}
      />
    );
  }
  return (
    <GeneralSettingsPanel preferences={preferences} onUpdatePreferences={onUpdatePreferences} />
  );
}
