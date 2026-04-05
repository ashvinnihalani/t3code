import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, PlusIcon, RotateCcwIcon, Undo2Icon, XIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { type DesktopAppCloseBehavior, type ProviderKind } from "@t3tools/contracts";
import { getModelOptions, normalizeModelSlug } from "@t3tools/shared/model";
import {
  buildClaudeHostOverridePatch,
  GIT_DEFAULT_ACTION_OPTIONS,
  THREAD_ID_DISPLAY_MODE_OPTIONS,
  type GitDefaultAction,
  type ThreadIdDisplayMode,
  getClaudeHostOverride,
  buildCodexHostOverridePatch,
  buildKiroHostOverridePatch,
  getCodexHostOverride,
  getKiroHostOverride,
  useAppSettings,
} from "../appSettings";
import {
  getCustomModelOptionsByProvider,
  getCustomModelsForProvider,
  getDefaultCustomModelsForProvider,
  MAX_CUSTOM_MODEL_LENGTH,
  MODEL_PROVIDER_SETTINGS,
  patchCustomModels,
  resolveAppModelSelectionState,
} from "../modelSelection";
import { APP_VERSION } from "../branding";
import { ProviderModelPicker } from "../components/chat/ProviderModelPicker";
import { TraitsPicker } from "../components/chat/TraitsPicker";
import { Button } from "../components/ui/button";
import { Collapsible, CollapsibleContent } from "../components/ui/collapsible";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { SidebarInset, SidebarTrigger } from "../components/ui/sidebar";
import { Switch } from "../components/ui/switch";
import { Textarea } from "../components/ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { resolveAndPersistPreferredEditor } from "../editorPreferences";
import { isElectron } from "../env";
import { useTheme } from "../hooks/useTheme";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { cn } from "../lib/utils";
import { ensureNativeApi, readNativeApi } from "../nativeApi";
import { GIT_PROVIDER_OPTIONS } from "../session-logic";
import { useStore } from "../store";

const THEME_OPTIONS = [
  {
    value: "system",
    label: "System",
    description: "Match your OS appearance setting.",
  },
  {
    value: "light",
    label: "Light",
    description: "Always use the light theme.",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use the dark theme.",
  },
] as const;

const TIMESTAMP_FORMAT_LABELS = {
  locale: "System default",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
} as const;

const GIT_DEFAULT_ACTION_LABELS: Record<GitDefaultAction, string> = {
  auto: "Auto",
  commit: "Commit",
  commit_push: "Commit and Push",
  commit_push_pr: "Commit Push and PR",
};

const DESKTOP_APP_CLOSE_BEHAVIOR_LABELS: Record<DesktopAppCloseBehavior, string> = {
  terminate_all_agents: "Stop all sessions",
  terminate_local_agents_only: "Stop local sessions only",
  terminate_no_agents: "Keep all sessions running",
};

const DESKTOP_APP_CLOSE_BEHAVIOR_DESCRIPTIONS: Record<DesktopAppCloseBehavior, string> = {
  terminate_all_agents: "Quit the local threads server and stop every active Codex session.",
  terminate_local_agents_only:
    "Keep the local threads server running, but stop sessions for local projects before exit.",
  terminate_no_agents: "Leave the local threads server and existing sessions running.",
};

const THREAD_ID_DISPLAY_MODE_LABELS: Record<ThreadIdDisplayMode, string> = {
  hidden: "Hidden",
  composer: "Below input box",
  message: "On each message",
};

const THREAD_ID_DISPLAY_MODE_DESCRIPTIONS: Record<ThreadIdDisplayMode, string> = {
  hidden: "Do not show the provider thread ID.",
  composer: "Show one thread ID centered below the composer.",
  message: "Append the thread ID to every message timestamp.",
};

type InstallBinarySettingsKey = "claudeBinaryPath" | "codexBinaryPath" | "kiroBinaryPath";

type InstallProviderSettings = {
  provider: ProviderKind;
  title: string;
  binaryPathKey: InstallBinarySettingsKey;
  binaryPlaceholder: string;
  binaryDescription: ReactNode;
  binaryLabel?: string;
  homePathKey?: "codexHomePath";
  localDescription?: string;
  remoteDescription?: string;
  homePlaceholder?: string;
  homeDescription?: ReactNode;
};

const INSTALL_PROVIDER_SETTINGS: readonly InstallProviderSettings[] = [
  {
    provider: "codex",
    title: "Codex",
    binaryPathKey: "codexBinaryPath",
    binaryLabel: "Codex binary path",
    binaryPlaceholder: "Codex binary path",
    binaryDescription: (
      <>
        Leave blank to use <code>codex</code> from your PATH.
      </>
    ),
    localDescription: "Override the CLI used for new local sessions.",
    remoteDescription: "Override the Codex binary and CODEX_HOME for a specific SSH host.",
    homePathKey: "codexHomePath",
    homePlaceholder: "CODEX_HOME",
    homeDescription: "Optional custom Codex home and config directory.",
  },
  {
    provider: "claudeAgent",
    title: "Claude",
    binaryPathKey: "claudeBinaryPath",
    binaryLabel: "Claude binary path",
    binaryPlaceholder: "Claude binary path",
    binaryDescription: (
      <>
        Leave blank to use <code>claude</code> from your PATH.
      </>
    ),
    localDescription: "Override the CLI used for new local sessions.",
    remoteDescription: "Override the Claude binary for a specific SSH host.",
  },
  {
    provider: "kiro",
    title: "Kiro CLI",
    binaryPathKey: "kiroBinaryPath",
    binaryLabel: "Kiro binary path",
    binaryPlaceholder: "Kiro binary path",
    binaryDescription: (
      <>
        Leave blank to use <code>kiro-cli</code> from your PATH.
      </>
    ),
    localDescription: "Override the CLI used for new local sessions.",
    remoteDescription: "Override the Kiro CLI binary for a specific SSH host.",
  },
];

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h2>
      <div className="relative overflow-hidden rounded-2xl border bg-card not-dark:bg-clip-padding text-card-foreground shadow-xs/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]">
        {children}
      </div>
    </section>
  );
}

function SettingsRow({
  title,
  description,
  status,
  resetAction,
  control,
  children,
  onClick,
}: {
  title: string;
  description: string;
  status?: ReactNode;
  resetAction?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      className="border-t border-border px-4 py-4 first:border-t-0 sm:px-5"
      data-slot="settings-row"
    >
      <div
        className={cn(
          "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
          onClick && "cursor-pointer",
        )}
        onClick={onClick}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <h3 className="text-sm font-medium text-foreground">{title}</h3>
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
              {resetAction}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{description}</p>
          {status ? <div className="pt-1 text-[11px] text-muted-foreground">{status}</div> : null}
        </div>
        {control ? (
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
            {control}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function SettingResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Reset ${label} to default`}
            className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              onClick();
            }}
          >
            <Undo2Icon className="size-3" />
          </Button>
        }
      />
      <TooltipPopup side="top">Reset to default</TooltipPopup>
    </Tooltip>
  );
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

type OverrideMode = "local" | "ssh";

function SettingsRouteView() {
  const { theme, setTheme } = useTheme();
  const { settings, defaults, updateSettings, resetSettings } = useAppSettings();
  const projects = useStore((store) => store.projects);
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const [isOpeningKeybindings, setIsOpeningKeybindings] = useState(false);
  const [openKeybindingsError, setOpenKeybindingsError] = useState<string | null>(null);
  const [openInstallProviders, setOpenInstallProviders] = useState<Record<ProviderKind, boolean>>({
    claudeAgent: Boolean(
      settings.claudeBinaryPath || Object.keys(settings.claudeRemoteOverrides).length > 0,
    ),
    codex: Boolean(
      settings.codexBinaryPath ||
      settings.codexHomePath ||
      Object.keys(settings.codexRemoteOverrides).length > 0,
    ),
    kiro: Boolean(settings.kiroBinaryPath || Object.keys(settings.kiroRemoteOverrides).length > 0),
  });
  const [providerOverrideMode, setProviderOverrideMode] = useState<
    Record<ProviderKind, OverrideMode>
  >({
    codex:
      Object.keys(settings.codexRemoteOverrides).length > 0 &&
      !settings.codexBinaryPath &&
      !settings.codexHomePath
        ? "ssh"
        : "local",
    claudeAgent:
      Object.keys(settings.claudeRemoteOverrides).length > 0 && !settings.claudeBinaryPath
        ? "ssh"
        : "local",
    kiro:
      Object.keys(settings.kiroRemoteOverrides).length > 0 && !settings.kiroBinaryPath
        ? "ssh"
        : "local",
  });
  const [selectedClaudeRemoteHost, setSelectedClaudeRemoteHost] = useState<string | null>(null);
  const [selectedCodexRemoteHost, setSelectedCodexRemoteHost] = useState<string | null>(null);
  const [selectedKiroRemoteHost, setSelectedKiroRemoteHost] = useState<string | null>(null);
  const [selectedCustomModelProvider, setSelectedCustomModelProvider] =
    useState<ProviderKind>("codex");
  const [customModelInputByProvider, setCustomModelInputByProvider] = useState<
    Record<ProviderKind, string>
  >({
    codex: "",
    claudeAgent: "",
    kiro: "",
  });
  const [customModelErrorByProvider, setCustomModelErrorByProvider] = useState<
    Partial<Record<ProviderKind, string | null>>
  >({});
  const [showAllCustomModels, setShowAllCustomModels] = useState(false);

  const sshProjectHostAliases = useMemo(
    () =>
      Array.from(
        new Set(
          projects.flatMap((project) =>
            project.host?.kind === "ssh" ? [project.host.hostAlias] : [],
          ),
        ),
      ).toSorted((left, right) => left.localeCompare(right)),
    [projects],
  );

  const claudeRemoteHosts = sshProjectHostAliases;
  const codexRemoteHosts = sshProjectHostAliases;
  const kiroRemoteHosts = sshProjectHostAliases;

  useEffect(() => {
    if (claudeRemoteHosts.length === 0) {
      setSelectedClaudeRemoteHost(null);
      return;
    }

    if (!selectedClaudeRemoteHost || !claudeRemoteHosts.includes(selectedClaudeRemoteHost)) {
      setSelectedClaudeRemoteHost(claudeRemoteHosts[0] ?? null);
    }
  }, [claudeRemoteHosts, selectedClaudeRemoteHost]);

  useEffect(() => {
    if (codexRemoteHosts.length === 0) {
      setSelectedCodexRemoteHost(null);
      return;
    }

    if (!selectedCodexRemoteHost || !codexRemoteHosts.includes(selectedCodexRemoteHost)) {
      setSelectedCodexRemoteHost(codexRemoteHosts[0] ?? null);
    }
  }, [codexRemoteHosts, selectedCodexRemoteHost]);

  useEffect(() => {
    if (kiroRemoteHosts.length === 0) {
      setSelectedKiroRemoteHost(null);
      return;
    }

    if (!selectedKiroRemoteHost || !kiroRemoteHosts.includes(selectedKiroRemoteHost)) {
      setSelectedKiroRemoteHost(kiroRemoteHosts[0] ?? null);
    }
  }, [kiroRemoteHosts, selectedKiroRemoteHost]);

  const selectedClaudeRemoteOverride = selectedClaudeRemoteHost
    ? getClaudeHostOverride(settings, selectedClaudeRemoteHost)
    : null;
  const selectedCodexRemoteOverride = selectedCodexRemoteHost
    ? getCodexHostOverride(settings, selectedCodexRemoteHost)
    : null;
  const selectedKiroRemoteOverride = selectedKiroRemoteHost
    ? getKiroHostOverride(settings, selectedKiroRemoteHost)
    : null;

  const keybindingsConfigPath = serverConfigQuery.data?.keybindingsConfigPath ?? null;
  const availableEditors = serverConfigQuery.data?.availableEditors;

  const textGenerationModelSelection = resolveAppModelSelectionState(settings);
  const textGenProvider = textGenerationModelSelection.provider;
  const textGenModel = textGenerationModelSelection.model;
  const textGenModelOptions = textGenerationModelSelection.options;
  const gitModelOptionsByProvider = getCustomModelOptionsByProvider(
    settings,
    textGenProvider,
    textGenModel,
  );
  const defaultGitTextGenerationModelSelection = resolveAppModelSelectionState(defaults);
  const isGitTextGenerationModelDirty =
    JSON.stringify(textGenerationModelSelection) !==
    JSON.stringify(defaultGitTextGenerationModelSelection);
  const selectedCustomModelProviderSettings = MODEL_PROVIDER_SETTINGS.find(
    (providerSettings) => providerSettings.provider === selectedCustomModelProvider,
  )!;
  const selectedCustomModelInput = customModelInputByProvider[selectedCustomModelProvider];
  const selectedCustomModelError = customModelErrorByProvider[selectedCustomModelProvider] ?? null;

  const savedCustomModelRows = MODEL_PROVIDER_SETTINGS.flatMap((providerSettings) =>
    getCustomModelsForProvider(settings, providerSettings.provider).map((slug) => ({
      key: `${providerSettings.provider}:${slug}`,
      provider: providerSettings.provider,
      providerTitle: providerSettings.title,
      slug,
    })),
  );
  const totalCustomModels = savedCustomModelRows.length;
  const visibleCustomModelRows = showAllCustomModels
    ? savedCustomModelRows
    : savedCustomModelRows.slice(0, 5);
  const hasCustomModelOverrides = MODEL_PROVIDER_SETTINGS.some((providerSettings) => {
    const currentModels = getCustomModelsForProvider(settings, providerSettings.provider);
    const defaultModels = getDefaultCustomModelsForProvider(defaults, providerSettings.provider);
    return !arraysEqual(currentModels, defaultModels);
  });

  const hasGitOverrides =
    settings.gitDefaultAction !== defaults.gitDefaultAction ||
    settings.gitCommitPrompt !== defaults.gitCommitPrompt ||
    settings.gitHubBinaryPath !== defaults.gitHubBinaryPath;

  const isInstallSettingsDirty =
    settings.claudeBinaryPath !== defaults.claudeBinaryPath ||
    settings.codexBinaryPath !== defaults.codexBinaryPath ||
    settings.codexHomePath !== defaults.codexHomePath ||
    settings.kiroBinaryPath !== defaults.kiroBinaryPath;

  const hasClaudeRemoteOverrides = Object.keys(settings.claudeRemoteOverrides).length > 0;
  const hasCodexRemoteOverrides = Object.keys(settings.codexRemoteOverrides).length > 0;
  const hasKiroRemoteOverrides = Object.keys(settings.kiroRemoteOverrides).length > 0;
  const hasSelectedClaudeRemoteOverride = Boolean(selectedClaudeRemoteOverride?.binaryPath);
  const hasSelectedCodexRemoteOverride = Boolean(
    selectedCodexRemoteOverride?.binaryPath || selectedCodexRemoteOverride?.homePath,
  );
  const hasSelectedKiroRemoteOverride = Boolean(selectedKiroRemoteOverride?.binaryPath);

  const hasCodexLocalOverride =
    settings.codexBinaryPath !== defaults.codexBinaryPath ||
    settings.codexHomePath !== defaults.codexHomePath;
  const hasClaudeLocalOverride = settings.claudeBinaryPath !== defaults.claudeBinaryPath;
  const hasKiroLocalOverride = settings.kiroBinaryPath !== defaults.kiroBinaryPath;

  const changedSettingLabels = [
    ...(theme !== "system" ? ["Theme"] : []),
    ...(settings.timestampFormat !== defaults.timestampFormat ? ["Time format"] : []),
    ...(settings.diffWordWrap !== defaults.diffWordWrap ? ["Diff line wrapping"] : []),
    ...(settings.enableAssistantStreaming !== defaults.enableAssistantStreaming
      ? ["Assistant output"]
      : []),
    ...(settings.defaultThreadEnvMode !== defaults.defaultThreadEnvMode ? ["New thread mode"] : []),
    ...(settings.confirmThreadDelete !== defaults.confirmThreadDelete
      ? ["Delete confirmation"]
      : []),
    ...(settings.threadIdDisplayMode !== defaults.threadIdDisplayMode ? ["Thread ID display"] : []),
    ...(settings.desktopAppCloseBehavior !== defaults.desktopAppCloseBehavior
      ? ["App close behavior"]
      : []),
    ...(isGitTextGenerationModelDirty ? ["Git writing model"] : []),
    ...(hasGitOverrides ? ["Git settings"] : []),
    ...(hasCustomModelOverrides ? ["Custom models"] : []),
    ...(isInstallSettingsDirty ? ["Provider installs"] : []),
    ...(hasClaudeRemoteOverrides ? ["Claude SSH overrides"] : []),
    ...(hasCodexRemoteOverrides ? ["Codex SSH overrides"] : []),
    ...(hasKiroRemoteOverrides ? ["Kiro SSH overrides"] : []),
  ];

  const openKeybindingsFile = useCallback(() => {
    if (!keybindingsConfigPath) return;
    setOpenKeybindingsError(null);
    setIsOpeningKeybindings(true);
    const api = ensureNativeApi();
    const editor = resolveAndPersistPreferredEditor(availableEditors ?? []);
    if (!editor) {
      setOpenKeybindingsError("No available editors found.");
      setIsOpeningKeybindings(false);
      return;
    }
    void api.shell
      .openInEditor(keybindingsConfigPath, editor)
      .catch((error) => {
        setOpenKeybindingsError(
          error instanceof Error ? error.message : "Unable to open keybindings file.",
        );
      })
      .finally(() => {
        setIsOpeningKeybindings(false);
      });
  }, [availableEditors, keybindingsConfigPath]);

  const addCustomModel = useCallback(
    (provider: ProviderKind) => {
      const customModelInput = customModelInputByProvider[provider];
      const customModels = getCustomModelsForProvider(settings, provider);
      const normalized = normalizeModelSlug(customModelInput, provider);
      if (!normalized) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "Enter a model slug.",
        }));
        return;
      }
      if (getModelOptions(provider).some((option) => option.slug === normalized)) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "That model is already built in.",
        }));
        return;
      }
      if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: `Model slugs must be ${MAX_CUSTOM_MODEL_LENGTH} characters or less.`,
        }));
        return;
      }
      if (customModels.includes(normalized)) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "That custom model is already saved.",
        }));
        return;
      }

      updateSettings(patchCustomModels(provider, [...customModels, normalized]));
      setCustomModelInputByProvider((existing) => ({
        ...existing,
        [provider]: "",
      }));
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));
    },
    [customModelInputByProvider, settings, updateSettings],
  );

  const removeCustomModel = useCallback(
    (provider: ProviderKind, slug: string) => {
      const customModels = getCustomModelsForProvider(settings, provider);
      updateSettings(
        patchCustomModels(
          provider,
          customModels.filter((model) => model !== slug),
        ),
      );
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));
    },
    [settings, updateSettings],
  );

  async function restoreDefaults() {
    if (changedSettingLabels.length === 0) return;

    const api = readNativeApi();
    const confirmed = await (api ?? ensureNativeApi()).dialogs.confirm(
      ["Restore default settings?", `This will reset: ${changedSettingLabels.join(", ")}.`].join(
        "\n",
      ),
    );
    if (!confirmed) return;

    setTheme("system");
    resetSettings();
    setOpenInstallProviders({
      codex: false,
      claudeAgent: false,
      kiro: false,
    });
    setSelectedCodexRemoteHost(null);
    setSelectedKiroRemoteHost(null);
    setSelectedCustomModelProvider("codex");
    setCustomModelInputByProvider({
      codex: "",
      claudeAgent: "",
      kiro: "",
    });
    setCustomModelErrorByProvider({});
    setShowAllCustomModels(false);
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {!isElectron && (
          <header className="border-b border-border px-3 py-2 sm:px-5">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7 shrink-0 md:hidden" />
              <span className="text-sm font-medium text-foreground">Settings</span>
              <div className="ms-auto flex items-center gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={changedSettingLabels.length === 0}
                  onClick={() => void restoreDefaults()}
                >
                  <RotateCcwIcon className="size-3.5" />
                  Restore defaults
                </Button>
              </div>
            </div>
          </header>
        )}

        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground/70">
              Settings
            </span>
            <div className="ms-auto flex items-center gap-2">
              <Button
                size="xs"
                variant="outline"
                disabled={changedSettingLabels.length === 0}
                onClick={() => void restoreDefaults()}
              >
                <RotateCcwIcon className="size-3.5" />
                Restore defaults
              </Button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
            <SettingsSection title="General">
              <SettingsRow
                title="Theme"
                description="Choose how T3 Code looks across the app."
                resetAction={
                  theme !== "system" ? (
                    <SettingResetButton label="theme" onClick={() => setTheme("system")} />
                  ) : null
                }
                control={
                  <Select
                    value={theme}
                    onValueChange={(value) => {
                      if (value !== "system" && value !== "light" && value !== "dark") return;
                      setTheme(value);
                    }}
                  >
                    <SelectTrigger className="w-full sm:w-40" aria-label="Theme preference">
                      <SelectValue>
                        {THEME_OPTIONS.find((option) => option.value === theme)?.label ?? "System"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      {THEME_OPTIONS.map((option) => (
                        <SelectItem hideIndicator key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                }
              />

              <SettingsRow
                title="Time format"
                description="System default follows your browser or OS clock preference."
                resetAction={
                  settings.timestampFormat !== defaults.timestampFormat ? (
                    <SettingResetButton
                      label="time format"
                      onClick={() =>
                        updateSettings({
                          timestampFormat: defaults.timestampFormat,
                        })
                      }
                    />
                  ) : null
                }
                control={
                  <Select
                    value={settings.timestampFormat}
                    onValueChange={(value) => {
                      if (value !== "locale" && value !== "12-hour" && value !== "24-hour") {
                        return;
                      }
                      updateSettings({
                        timestampFormat: value,
                      });
                    }}
                  >
                    <SelectTrigger className="w-full sm:w-40" aria-label="Timestamp format">
                      <SelectValue>{TIMESTAMP_FORMAT_LABELS[settings.timestampFormat]}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      <SelectItem hideIndicator value="locale">
                        {TIMESTAMP_FORMAT_LABELS.locale}
                      </SelectItem>
                      <SelectItem hideIndicator value="12-hour">
                        {TIMESTAMP_FORMAT_LABELS["12-hour"]}
                      </SelectItem>
                      <SelectItem hideIndicator value="24-hour">
                        {TIMESTAMP_FORMAT_LABELS["24-hour"]}
                      </SelectItem>
                    </SelectPopup>
                  </Select>
                }
              />

              <SettingsRow
                title="Diff line wrapping"
                description="Set the default wrap state when the diff panel opens. The in-panel wrap toggle only affects the current diff session."
                resetAction={
                  settings.diffWordWrap !== defaults.diffWordWrap ? (
                    <SettingResetButton
                      label="diff line wrapping"
                      onClick={() =>
                        updateSettings({
                          diffWordWrap: defaults.diffWordWrap,
                        })
                      }
                    />
                  ) : null
                }
                control={
                  <Switch
                    checked={settings.diffWordWrap}
                    onCheckedChange={(checked) =>
                      updateSettings({
                        diffWordWrap: Boolean(checked),
                      })
                    }
                    aria-label="Wrap diff lines by default"
                  />
                }
              />

              <SettingsRow
                title="Assistant output"
                description="Show token-by-token output while a response is in progress."
                resetAction={
                  settings.enableAssistantStreaming !== defaults.enableAssistantStreaming ? (
                    <SettingResetButton
                      label="assistant output"
                      onClick={() =>
                        updateSettings({
                          enableAssistantStreaming: defaults.enableAssistantStreaming,
                        })
                      }
                    />
                  ) : null
                }
                control={
                  <Switch
                    checked={settings.enableAssistantStreaming}
                    onCheckedChange={(checked) =>
                      updateSettings({
                        enableAssistantStreaming: Boolean(checked),
                      })
                    }
                    aria-label="Stream assistant messages"
                  />
                }
              />

              <SettingsRow
                title="New threads"
                description="Pick the default workspace mode for newly created draft threads."
                resetAction={
                  settings.defaultThreadEnvMode !== defaults.defaultThreadEnvMode ? (
                    <SettingResetButton
                      label="new threads"
                      onClick={() =>
                        updateSettings({
                          defaultThreadEnvMode: defaults.defaultThreadEnvMode,
                        })
                      }
                    />
                  ) : null
                }
                control={
                  <Select
                    value={settings.defaultThreadEnvMode}
                    onValueChange={(value) => {
                      if (value !== "local" && value !== "worktree") return;
                      updateSettings({
                        defaultThreadEnvMode: value,
                      });
                    }}
                  >
                    <SelectTrigger className="w-full sm:w-44" aria-label="Default thread mode">
                      <SelectValue>
                        {settings.defaultThreadEnvMode === "worktree" ? "New worktree" : "Local"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      <SelectItem hideIndicator value="local">
                        Local
                      </SelectItem>
                      <SelectItem hideIndicator value="worktree">
                        New worktree
                      </SelectItem>
                    </SelectPopup>
                  </Select>
                }
              />

              <SettingsRow
                title="Delete confirmation"
                description="Ask before deleting a thread and its chat history."
                resetAction={
                  settings.confirmThreadDelete !== defaults.confirmThreadDelete ? (
                    <SettingResetButton
                      label="delete confirmation"
                      onClick={() =>
                        updateSettings({
                          confirmThreadDelete: defaults.confirmThreadDelete,
                        })
                      }
                    />
                  ) : null
                }
                control={
                  <Switch
                    checked={settings.confirmThreadDelete}
                    onCheckedChange={(checked) =>
                      updateSettings({
                        confirmThreadDelete: Boolean(checked),
                      })
                    }
                    aria-label="Confirm thread deletion"
                  />
                }
              />

              <SettingsRow
                title="Thread ID display"
                description={THREAD_ID_DISPLAY_MODE_DESCRIPTIONS[settings.threadIdDisplayMode]}
                resetAction={
                  settings.threadIdDisplayMode !== defaults.threadIdDisplayMode ? (
                    <SettingResetButton
                      label="thread id display"
                      onClick={() =>
                        updateSettings({
                          threadIdDisplayMode: defaults.threadIdDisplayMode,
                        })
                      }
                    />
                  ) : null
                }
                control={
                  <Select
                    value={settings.threadIdDisplayMode}
                    onValueChange={(value) => {
                      if (!THREAD_ID_DISPLAY_MODE_OPTIONS.includes(value as ThreadIdDisplayMode)) {
                        return;
                      }
                      updateSettings({
                        threadIdDisplayMode: value as ThreadIdDisplayMode,
                      });
                    }}
                  >
                    <SelectTrigger className="w-full sm:w-44" aria-label="Thread ID display mode">
                      <SelectValue>
                        {THREAD_ID_DISPLAY_MODE_LABELS[settings.threadIdDisplayMode]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      {THREAD_ID_DISPLAY_MODE_OPTIONS.map((option) => (
                        <SelectItem hideIndicator key={option} value={option}>
                          {THREAD_ID_DISPLAY_MODE_LABELS[option]}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                }
              />

              {isElectron ? (
                <SettingsRow
                  title="On app close"
                  description={
                    DESKTOP_APP_CLOSE_BEHAVIOR_DESCRIPTIONS[settings.desktopAppCloseBehavior]
                  }
                  resetAction={
                    settings.desktopAppCloseBehavior !== defaults.desktopAppCloseBehavior ? (
                      <SettingResetButton
                        label="app close behavior"
                        onClick={() =>
                          updateSettings({
                            desktopAppCloseBehavior: defaults.desktopAppCloseBehavior,
                          })
                        }
                      />
                    ) : null
                  }
                  control={
                    <Select
                      value={settings.desktopAppCloseBehavior}
                      onValueChange={(value) => {
                        if (value === null || !(value in DESKTOP_APP_CLOSE_BEHAVIOR_LABELS)) {
                          return;
                        }
                        updateSettings({
                          desktopAppCloseBehavior: value as DesktopAppCloseBehavior,
                        });
                      }}
                    >
                      <SelectTrigger
                        className="w-full sm:w-56"
                        aria-label="Desktop app close behavior"
                      >
                        <SelectValue>
                          {DESKTOP_APP_CLOSE_BEHAVIOR_LABELS[settings.desktopAppCloseBehavior]}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup align="end" alignItemWithTrigger={false}>
                        {Object.entries(DESKTOP_APP_CLOSE_BEHAVIOR_LABELS).map(([value, label]) => (
                          <SelectItem hideIndicator key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  }
                />
              ) : null}
            </SettingsSection>

            <SettingsSection title="Git">
              <SettingsRow
                title="Default action"
                description="Auto preserves the original context-sensitive behavior. The other options force a preferred action when possible."
                resetAction={
                  settings.gitDefaultAction !== defaults.gitDefaultAction ? (
                    <SettingResetButton
                      label="default git action"
                      onClick={() =>
                        updateSettings({
                          gitDefaultAction: defaults.gitDefaultAction,
                        })
                      }
                    />
                  ) : null
                }
                control={
                  <Select
                    value={settings.gitDefaultAction}
                    onValueChange={(value) => {
                      if (!GIT_DEFAULT_ACTION_OPTIONS.includes(value as GitDefaultAction)) {
                        return;
                      }
                      updateSettings({
                        gitDefaultAction: value as GitDefaultAction,
                      });
                    }}
                  >
                    <SelectTrigger className="w-full sm:w-52" aria-label="Default git action">
                      <SelectValue>
                        {GIT_DEFAULT_ACTION_LABELS[settings.gitDefaultAction]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      {GIT_DEFAULT_ACTION_OPTIONS.map((option) => (
                        <SelectItem hideIndicator key={option} value={option}>
                          {GIT_DEFAULT_ACTION_LABELS[option]}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                }
              />

              <SettingsRow
                title="Git writing model"
                description="Provider and model used for auto-generated git content."
                resetAction={
                  JSON.stringify(settings.textGenerationModelSelection ?? null) !==
                  JSON.stringify(defaults.textGenerationModelSelection ?? null) ? (
                    <SettingResetButton
                      label="git writing model"
                      onClick={() => {
                        updateSettings({
                          textGenerationModelSelection: defaults.textGenerationModelSelection,
                        });
                      }}
                    />
                  ) : null
                }
                control={
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <ProviderModelPicker
                      provider={textGenProvider}
                      model={textGenModel}
                      lockedProvider={null}
                      modelOptionsByProvider={gitModelOptionsByProvider}
                      providerOptions={GIT_PROVIDER_OPTIONS}
                      triggerVariant="outline"
                      triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                      onProviderModelChange={(provider, model) => {
                        updateSettings({
                          textGenerationModelSelection: resolveAppModelSelectionState({
                            ...settings,
                            textGenerationModelSelection: { provider, model },
                          }),
                        });
                      }}
                    />
                    <TraitsPicker
                      provider={textGenProvider}
                      model={textGenModel}
                      prompt=""
                      onPromptChange={() => {}}
                      modelOptions={textGenModelOptions}
                      allowPromptInjectedEffort={false}
                      triggerVariant="outline"
                      triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                      onModelOptionsChange={(nextOptions) => {
                        updateSettings({
                          textGenerationModelSelection: resolveAppModelSelectionState({
                            ...settings,
                            textGenerationModelSelection: {
                              provider: textGenProvider,
                              model: textGenModel,
                              ...(nextOptions ? { options: nextOptions } : {}),
                            },
                          }),
                        });
                      }}
                    />
                  </div>
                }
              />

              <SettingsRow
                title="Prompt"
                description="Optional instructions for generated commit messages, PR titles, and branch names."
                resetAction={
                  settings.gitCommitPrompt !== defaults.gitCommitPrompt ? (
                    <SettingResetButton
                      label="git prompt"
                      onClick={() =>
                        updateSettings({
                          gitCommitPrompt: defaults.gitCommitPrompt,
                        })
                      }
                    />
                  ) : null
                }
              >
                <div className="mt-4 border-t border-border pt-4">
                  <Textarea
                    id="git-commit-prompt"
                    value={settings.gitCommitPrompt}
                    onChange={(event) =>
                      updateSettings({
                        gitCommitPrompt: event.target.value,
                      })
                    }
                    placeholder="Optional instructions for the Git prompter"
                    spellCheck={false}
                  />
                </div>
              </SettingsRow>

              <SettingsRow
                title="GitHub binary path"
                description="Optional executable override for git status, PR actions, and PR checkout. For SSH projects, the same path must exist on the remote host."
                resetAction={
                  settings.gitHubBinaryPath !== defaults.gitHubBinaryPath ? (
                    <SettingResetButton
                      label="github binary path"
                      onClick={() =>
                        updateSettings({
                          gitHubBinaryPath: defaults.gitHubBinaryPath,
                        })
                      }
                    />
                  ) : null
                }
              >
                <div className="mt-4 border-t border-border pt-4">
                  <Input
                    id="github-binary-path"
                    value={settings.gitHubBinaryPath}
                    onChange={(event) =>
                      updateSettings({
                        gitHubBinaryPath: event.target.value,
                      })
                    }
                    placeholder="gh"
                    spellCheck={false}
                  />
                </div>
              </SettingsRow>
            </SettingsSection>

            <SettingsSection title="Models">
              <SettingsRow
                title="Custom models"
                description="Add custom model slugs for supported providers."
                resetAction={
                  hasCustomModelOverrides ? (
                    <SettingResetButton
                      label="custom models"
                      onClick={() => {
                        updateSettings({
                          customCodexModels: defaults.customCodexModels,
                          customClaudeModels: defaults.customClaudeModels,
                          customKiroModels: defaults.customKiroModels,
                        });
                        setCustomModelErrorByProvider({});
                        setShowAllCustomModels(false);
                      }}
                    />
                  ) : null
                }
              >
                <div className="mt-4 border-t border-border pt-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Select
                      value={selectedCustomModelProvider}
                      onValueChange={(value) => {
                        if (
                          !MODEL_PROVIDER_SETTINGS.some((provider) => provider.provider === value)
                        ) {
                          return;
                        }
                        setSelectedCustomModelProvider(value as ProviderKind);
                      }}
                    >
                      <SelectTrigger
                        size="sm"
                        className="w-full sm:w-40"
                        aria-label="Custom model provider"
                      >
                        <SelectValue>{selectedCustomModelProviderSettings.title}</SelectValue>
                      </SelectTrigger>
                      <SelectPopup align="start" alignItemWithTrigger={false}>
                        {MODEL_PROVIDER_SETTINGS.map((providerSettings) => (
                          <SelectItem
                            hideIndicator
                            className="min-h-7 text-sm"
                            key={providerSettings.provider}
                            value={providerSettings.provider}
                          >
                            {providerSettings.title}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                    <Input
                      id="custom-model-slug"
                      value={selectedCustomModelInput}
                      onChange={(event) => {
                        const value = event.target.value;
                        setCustomModelInputByProvider((existing) => ({
                          ...existing,
                          [selectedCustomModelProvider]: value,
                        }));
                        if (selectedCustomModelError) {
                          setCustomModelErrorByProvider((existing) => ({
                            ...existing,
                            [selectedCustomModelProvider]: null,
                          }));
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        addCustomModel(selectedCustomModelProvider);
                      }}
                      placeholder={selectedCustomModelProviderSettings.example}
                      spellCheck={false}
                    />
                    <Button
                      className="shrink-0"
                      variant="outline"
                      onClick={() => addCustomModel(selectedCustomModelProvider)}
                    >
                      <PlusIcon className="size-3.5" />
                      Add
                    </Button>
                  </div>

                  {selectedCustomModelError ? (
                    <p className="mt-2 text-xs text-destructive">{selectedCustomModelError}</p>
                  ) : null}

                  {totalCustomModels > 0 ? (
                    <div className="mt-3">
                      <div>
                        {visibleCustomModelRows.map((row) => (
                          <div
                            key={row.key}
                            className="group grid grid-cols-[minmax(5rem,6rem)_minmax(0,1fr)_auto] items-center gap-3 border-t border-border/60 px-4 py-2 first:border-t-0"
                          >
                            <span className="truncate text-xs text-muted-foreground">
                              {row.providerTitle}
                            </span>
                            <code className="min-w-0 truncate text-sm text-foreground">
                              {row.slug}
                            </code>
                            <button
                              type="button"
                              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 hover:opacity-100"
                              aria-label={`Remove ${row.slug}`}
                              onClick={() => removeCustomModel(row.provider, row.slug)}
                            >
                              <XIcon className="size-3.5 text-muted-foreground hover:text-foreground" />
                            </button>
                          </div>
                        ))}
                      </div>

                      {savedCustomModelRows.length > 5 ? (
                        <button
                          type="button"
                          className="mt-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                          onClick={() => setShowAllCustomModels((value) => !value)}
                        >
                          {showAllCustomModels
                            ? "Show less"
                            : `Show more (${savedCustomModelRows.length - 5})`}
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-lg border border-dashed border-border bg-background px-3 py-4 text-xs text-muted-foreground">
                      No custom models saved yet.
                    </div>
                  )}
                </div>
              </SettingsRow>
            </SettingsSection>

            <SettingsSection title="Advanced">
              <SettingsRow
                title="Provider installs"
                description="Override local installs and SSH host-specific binaries for each provider."
                resetAction={
                  isInstallSettingsDirty ||
                  hasClaudeRemoteOverrides ||
                  hasCodexRemoteOverrides ||
                  hasKiroRemoteOverrides ? (
                    <SettingResetButton
                      label="provider installs"
                      onClick={() => {
                        updateSettings({
                          claudeBinaryPath: defaults.claudeBinaryPath,
                          claudeRemoteOverrides: defaults.claudeRemoteOverrides,
                          codexBinaryPath: defaults.codexBinaryPath,
                          codexHomePath: defaults.codexHomePath,
                          codexRemoteOverrides: defaults.codexRemoteOverrides,
                          kiroBinaryPath: defaults.kiroBinaryPath,
                          kiroRemoteOverrides: defaults.kiroRemoteOverrides,
                        });
                        setOpenInstallProviders({
                          codex: false,
                          claudeAgent: false,
                          kiro: false,
                        });
                        setProviderOverrideMode({
                          codex: "local",
                          claudeAgent: "local",
                          kiro: "local",
                        });
                      }}
                    />
                  ) : null
                }
              >
                <div className="mt-4">
                  <div className="space-y-2">
                    {INSTALL_PROVIDER_SETTINGS.map((providerSettings) => {
                      const isOpen = openInstallProviders[providerSettings.provider];
                      const selectedMode = providerOverrideMode[providerSettings.provider];
                      const supportsRemote =
                        providerSettings.provider === "claudeAgent" ||
                        providerSettings.provider === "codex" ||
                        providerSettings.provider === "kiro";
                      const remoteHosts =
                        providerSettings.provider === "claudeAgent"
                          ? claudeRemoteHosts
                          : providerSettings.provider === "codex"
                            ? codexRemoteHosts
                            : providerSettings.provider === "kiro"
                              ? kiroRemoteHosts
                              : [];
                      const selectedRemoteHost =
                        providerSettings.provider === "claudeAgent"
                          ? selectedClaudeRemoteHost
                          : providerSettings.provider === "codex"
                            ? selectedCodexRemoteHost
                            : providerSettings.provider === "kiro"
                              ? selectedKiroRemoteHost
                              : null;
                      const selectedRemoteOverride =
                        providerSettings.provider === "claudeAgent"
                          ? selectedClaudeRemoteOverride
                          : providerSettings.provider === "codex"
                            ? selectedCodexRemoteOverride
                            : providerSettings.provider === "kiro"
                              ? selectedKiroRemoteOverride
                              : null;
                      const canSelectRemote = supportsRemote && remoteHosts.length > 0;
                      const effectiveSelectedMode =
                        selectedMode === "ssh" && canSelectRemote ? "ssh" : "local";
                      const isLocalDirty =
                        providerSettings.provider === "codex"
                          ? hasCodexLocalOverride
                          : providerSettings.provider === "claudeAgent"
                            ? hasClaudeLocalOverride
                            : hasKiroLocalOverride;
                      const isRemoteDirty =
                        providerSettings.provider === "claudeAgent"
                          ? hasClaudeRemoteOverrides
                          : providerSettings.provider === "codex"
                            ? hasCodexRemoteOverrides
                            : providerSettings.provider === "kiro"
                              ? hasKiroRemoteOverrides
                              : false;
                      const isSelectedRemoteDirty =
                        providerSettings.provider === "claudeAgent"
                          ? hasSelectedClaudeRemoteOverride
                          : providerSettings.provider === "codex"
                            ? hasSelectedCodexRemoteOverride
                            : providerSettings.provider === "kiro"
                              ? hasSelectedKiroRemoteOverride
                              : false;
                      const isDirty = isLocalDirty || isRemoteDirty;
                      const binaryPathValue =
                        providerSettings.binaryPathKey === "claudeBinaryPath"
                          ? settings.claudeBinaryPath
                          : providerSettings.binaryPathKey === "kiroBinaryPath"
                            ? settings.kiroBinaryPath
                            : settings.codexBinaryPath;
                      const resetAction =
                        effectiveSelectedMode === "local" ? (
                          isLocalDirty ? (
                            <SettingResetButton
                              label={`${providerSettings.title.toLowerCase()} local override`}
                              onClick={() => {
                                if (providerSettings.provider === "codex") {
                                  updateSettings({
                                    codexBinaryPath: defaults.codexBinaryPath,
                                    codexHomePath: defaults.codexHomePath,
                                  });
                                  return;
                                }
                                if (providerSettings.provider === "claudeAgent") {
                                  updateSettings({
                                    claudeBinaryPath: defaults.claudeBinaryPath,
                                  });
                                  return;
                                }
                                updateSettings({
                                  kiroBinaryPath: defaults.kiroBinaryPath,
                                });
                              }}
                            />
                          ) : null
                        ) : supportsRemote && selectedRemoteHost && isSelectedRemoteDirty ? (
                          <SettingResetButton
                            label={`${providerSettings.title.toLowerCase()} ssh override`}
                            onClick={() => {
                              if (providerSettings.provider === "claudeAgent") {
                                updateSettings(
                                  buildClaudeHostOverridePatch(
                                    settings,
                                    { binaryPath: "" },
                                    selectedRemoteHost,
                                  ),
                                );
                                return;
                              }
                              if (providerSettings.provider === "codex") {
                                updateSettings(
                                  buildCodexHostOverridePatch(
                                    settings,
                                    {
                                      binaryPath: "",
                                      homePath: "",
                                    },
                                    selectedRemoteHost,
                                  ),
                                );
                                return;
                              }
                              updateSettings(
                                buildKiroHostOverridePatch(
                                  settings,
                                  { binaryPath: "" },
                                  selectedRemoteHost,
                                ),
                              );
                            }}
                          />
                        ) : null;

                      return (
                        <Collapsible
                          key={providerSettings.provider}
                          open={isOpen}
                          onOpenChange={(open) =>
                            setOpenInstallProviders((existing) => ({
                              ...existing,
                              [providerSettings.provider]: open,
                            }))
                          }
                        >
                          <div className="overflow-hidden rounded-xl border border-border/70">
                            <button
                              type="button"
                              className="flex w-full items-center gap-3 px-4 py-3 text-left"
                              onClick={() =>
                                setOpenInstallProviders((existing) => ({
                                  ...existing,
                                  [providerSettings.provider]: !existing[providerSettings.provider],
                                }))
                              }
                            >
                              <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
                                {providerSettings.title}
                              </span>
                              {isDirty ? (
                                <span className="text-[11px] text-muted-foreground">Custom</span>
                              ) : null}
                              <ChevronDownIcon
                                className={cn(
                                  "size-4 shrink-0 text-muted-foreground transition-transform",
                                  isOpen && "rotate-180",
                                )}
                              />
                            </button>

                            <CollapsibleContent>
                              <div className="border-t border-border/70 px-4 py-4">
                                <div className="space-y-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                                      {(effectiveSelectedMode === "ssh"
                                        ? providerSettings.remoteDescription
                                        : providerSettings.localDescription) ??
                                        "Override the provider binary path."}
                                    </p>
                                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                                      {resetAction}
                                    </span>
                                  </div>

                                  {supportsRemote ? (
                                    <label
                                      htmlFor={`provider-install-mode-${providerSettings.provider}`}
                                      className="block"
                                    >
                                      <span className="block text-xs font-medium text-foreground">
                                        Override target
                                      </span>
                                      <Select
                                        value={effectiveSelectedMode}
                                        onValueChange={(value) => {
                                          if (value !== "local" && value !== "ssh") return;
                                          if (value === "ssh" && !canSelectRemote) return;
                                          setProviderOverrideMode((existing) => ({
                                            ...existing,
                                            [providerSettings.provider]: value,
                                          }));
                                        }}
                                      >
                                        <SelectTrigger
                                          id={`provider-install-mode-${providerSettings.provider}`}
                                          className="mt-1 w-full"
                                          disabled={!canSelectRemote}
                                          aria-label={`${providerSettings.title} override target`}
                                        >
                                          <SelectValue>
                                            {effectiveSelectedMode === "ssh" ? "SSH host" : "Local"}
                                          </SelectValue>
                                        </SelectTrigger>
                                        <SelectPopup align="start" alignItemWithTrigger={false}>
                                          <SelectItem hideIndicator value="local">
                                            Local
                                          </SelectItem>
                                          {canSelectRemote ? (
                                            <SelectItem hideIndicator value="ssh">
                                              SSH host
                                            </SelectItem>
                                          ) : null}
                                        </SelectPopup>
                                      </Select>
                                    </label>
                                  ) : null}

                                  {effectiveSelectedMode === "ssh" && supportsRemote ? (
                                    remoteHosts.length > 0 ? (
                                      <>
                                        <label
                                          htmlFor={`provider-install-ssh-host-${providerSettings.provider}`}
                                          className="block"
                                        >
                                          <span className="block text-xs font-medium text-foreground">
                                            SSH host
                                          </span>
                                          <Select
                                            value={selectedRemoteHost ?? ""}
                                            onValueChange={(value) => {
                                              if (typeof value !== "string") return;
                                              if (!remoteHosts.includes(value)) return;
                                              if (providerSettings.provider === "claudeAgent") {
                                                setSelectedClaudeRemoteHost(value);
                                                return;
                                              }
                                              if (providerSettings.provider === "codex") {
                                                setSelectedCodexRemoteHost(value);
                                                return;
                                              }
                                              setSelectedKiroRemoteHost(value);
                                            }}
                                          >
                                            <SelectTrigger
                                              id={`provider-install-ssh-host-${providerSettings.provider}`}
                                              className="mt-1 w-full"
                                              aria-label={`${providerSettings.title} SSH override host`}
                                            >
                                              <SelectValue>
                                                {selectedRemoteHost ?? "Select host"}
                                              </SelectValue>
                                            </SelectTrigger>
                                            <SelectPopup align="start" alignItemWithTrigger={false}>
                                              {remoteHosts.map((hostAlias) => (
                                                <SelectItem
                                                  hideIndicator
                                                  key={hostAlias}
                                                  value={hostAlias}
                                                >
                                                  {hostAlias}
                                                </SelectItem>
                                              ))}
                                            </SelectPopup>
                                          </Select>
                                        </label>

                                        <label
                                          htmlFor={`provider-install-ssh-binary-${providerSettings.provider}`}
                                          className="block"
                                        >
                                          <span className="block text-xs font-medium text-foreground">
                                            {providerSettings.binaryLabel ??
                                              `${providerSettings.title} binary path`}
                                          </span>
                                          <Input
                                            id={`provider-install-ssh-binary-${providerSettings.provider}`}
                                            className="mt-1"
                                            value={selectedRemoteOverride?.binaryPath ?? ""}
                                            onChange={(event) => {
                                              if (!selectedRemoteHost) return;
                                              if (providerSettings.provider === "claudeAgent") {
                                                updateSettings(
                                                  buildClaudeHostOverridePatch(
                                                    settings,
                                                    { binaryPath: event.target.value },
                                                    selectedRemoteHost,
                                                  ),
                                                );
                                                return;
                                              }
                                              if (providerSettings.provider === "codex") {
                                                updateSettings(
                                                  buildCodexHostOverridePatch(
                                                    settings,
                                                    { binaryPath: event.target.value },
                                                    selectedRemoteHost,
                                                  ),
                                                );
                                                return;
                                              }
                                              updateSettings(
                                                buildKiroHostOverridePatch(
                                                  settings,
                                                  { binaryPath: event.target.value },
                                                  selectedRemoteHost,
                                                ),
                                              );
                                            }}
                                            placeholder={
                                              providerSettings.provider === "claudeAgent"
                                                ? "claude"
                                                : providerSettings.provider === "kiro"
                                                  ? "kiro-cli"
                                                  : "codex"
                                            }
                                            spellCheck={false}
                                          />
                                        </label>

                                        {providerSettings.provider === "codex" ? (
                                          <label
                                            htmlFor="provider-install-ssh-home-codex"
                                            className="block"
                                          >
                                            <span className="block text-xs font-medium text-foreground">
                                              CODEX_HOME path
                                            </span>
                                            <Input
                                              id="provider-install-ssh-home-codex"
                                              className="mt-1"
                                              value={selectedCodexRemoteOverride?.homePath ?? ""}
                                              onChange={(event) => {
                                                if (!selectedCodexRemoteHost) return;
                                                updateSettings(
                                                  buildCodexHostOverridePatch(
                                                    settings,
                                                    { homePath: event.target.value },
                                                    selectedCodexRemoteHost,
                                                  ),
                                                );
                                              }}
                                              placeholder="/home/you/.codex"
                                              spellCheck={false}
                                            />
                                          </label>
                                        ) : null}
                                      </>
                                    ) : (
                                      <div className="rounded-lg border border-dashed border-border bg-background px-3 py-4 text-xs text-muted-foreground">
                                        Open an SSH project to configure per-host{" "}
                                        {providerSettings.title} overrides.
                                      </div>
                                    )
                                  ) : (
                                    <>
                                      <label
                                        htmlFor={`provider-install-${providerSettings.binaryPathKey}`}
                                        className="block"
                                      >
                                        <span className="block text-xs font-medium text-foreground">
                                          {providerSettings.binaryLabel ??
                                            `${providerSettings.title} binary path`}
                                        </span>
                                        <Input
                                          id={`provider-install-${providerSettings.binaryPathKey}`}
                                          className="mt-1"
                                          value={binaryPathValue}
                                          onChange={(event) =>
                                            updateSettings(
                                              providerSettings.binaryPathKey === "claudeBinaryPath"
                                                ? { claudeBinaryPath: event.target.value }
                                                : providerSettings.binaryPathKey ===
                                                    "kiroBinaryPath"
                                                  ? { kiroBinaryPath: event.target.value }
                                                  : { codexBinaryPath: event.target.value },
                                            )
                                          }
                                          placeholder={providerSettings.binaryPlaceholder}
                                          spellCheck={false}
                                        />
                                        <span className="mt-1 block text-xs text-muted-foreground">
                                          {providerSettings.binaryDescription}
                                        </span>
                                      </label>

                                      {providerSettings.homePathKey ? (
                                        <label
                                          htmlFor={`provider-install-${providerSettings.homePathKey}`}
                                          className="block"
                                        >
                                          <span className="block text-xs font-medium text-foreground">
                                            CODEX_HOME path
                                          </span>
                                          <Input
                                            id={`provider-install-${providerSettings.homePathKey}`}
                                            className="mt-1"
                                            value={settings.codexHomePath}
                                            onChange={(event) =>
                                              updateSettings({
                                                codexHomePath: event.target.value,
                                              })
                                            }
                                            placeholder={providerSettings.homePlaceholder}
                                            spellCheck={false}
                                          />
                                          {providerSettings.homeDescription ? (
                                            <span className="mt-1 block text-xs text-muted-foreground">
                                              {providerSettings.homeDescription}
                                            </span>
                                          ) : null}
                                        </label>
                                      ) : null}
                                    </>
                                  )}
                                </div>
                              </div>
                            </CollapsibleContent>
                          </div>
                        </Collapsible>
                      );
                    })}
                  </div>
                </div>
              </SettingsRow>

              <SettingsRow
                title="Keybindings"
                description="Open the persisted `keybindings.json` file to edit advanced bindings directly."
                status={
                  <>
                    <span className="block break-all font-mono text-[11px] text-foreground">
                      {keybindingsConfigPath ?? "Resolving keybindings path..."}
                    </span>
                    {openKeybindingsError ? (
                      <span className="mt-1 block text-destructive">{openKeybindingsError}</span>
                    ) : (
                      <span className="mt-1 block">Opens in your preferred editor.</span>
                    )}
                  </>
                }
                control={
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!keybindingsConfigPath || isOpeningKeybindings}
                    onClick={openKeybindingsFile}
                  >
                    {isOpeningKeybindings ? "Opening..." : "Open file"}
                  </Button>
                }
              />

              <SettingsRow
                title="Version"
                description="Current application version."
                control={
                  <code className="text-xs font-medium text-muted-foreground">{APP_VERSION}</code>
                }
              />
            </SettingsSection>
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/settings")({
  component: SettingsRouteView,
});
