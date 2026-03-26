import { useCallback } from "react";
import { Option, Schema } from "effect";
import {
  DESKTOP_APP_CLOSE_BEHAVIOR_OPTIONS,
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  ModelSelection,
  type DesktopAppCloseBehavior,
  type GitRequestSettings,
  type ProviderStartOptions,
} from "@t3tools/contracts";
import { useLocalStorage } from "./hooks/useLocalStorage";
import {
  normalizeCustomModelSlugs,
  resolveAppModelSelectionState,
  type CustomModelSettings,
} from "./modelSelection";

export const APP_SETTINGS_STORAGE_KEY = "t3code:app-settings:v1";

export const TIMESTAMP_FORMAT_OPTIONS = ["locale", "12-hour", "24-hour"] as const;
export type TimestampFormat = (typeof TIMESTAMP_FORMAT_OPTIONS)[number];
export const DEFAULT_TIMESTAMP_FORMAT: TimestampFormat = "locale";

export const SIDEBAR_PROJECT_SORT_ORDER_OPTIONS = ["updated_at", "created_at", "manual"] as const;
export type SidebarProjectSortOrder = (typeof SIDEBAR_PROJECT_SORT_ORDER_OPTIONS)[number];
export const DEFAULT_SIDEBAR_PROJECT_SORT_ORDER: SidebarProjectSortOrder = "updated_at";

export const SIDEBAR_THREAD_SORT_ORDER_OPTIONS = ["updated_at", "created_at"] as const;
export type SidebarThreadSortOrder = (typeof SIDEBAR_THREAD_SORT_ORDER_OPTIONS)[number];
export const DEFAULT_SIDEBAR_THREAD_SORT_ORDER: SidebarThreadSortOrder = "updated_at";

export const GIT_DEFAULT_ACTION_OPTIONS = [
  "auto",
  "commit",
  "commit_push",
  "commit_push_pr",
] as const;
export type GitDefaultAction = (typeof GIT_DEFAULT_ACTION_OPTIONS)[number];
export const DEFAULT_GIT_DEFAULT_ACTION: GitDefaultAction = "auto";

export const THREAD_ID_DISPLAY_MODE_OPTIONS = ["hidden", "composer", "message"] as const;
export type ThreadIdDisplayMode = (typeof THREAD_ID_DISPLAY_MODE_OPTIONS)[number];
export const DEFAULT_THREAD_ID_DISPLAY_MODE: ThreadIdDisplayMode = "hidden";

export const DEFAULT_DESKTOP_APP_CLOSE_BEHAVIOR: DesktopAppCloseBehavior = "terminate_all_agents";

const DEFAULT_GIT_TEXT_GENERATION_MODEL_SELECTION = {
  provider: "codex" as const,
  model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER.codex,
};

const SettingsPathSchema = Schema.String.check(Schema.isMaxLength(4096)).pipe(
  Schema.withConstructorDefault(() => Option.some("")),
  Schema.withDecodingDefault(() => ""),
);
const GitCommitPromptSchema = Schema.String.check(Schema.isMaxLength(10_000)).pipe(
  Schema.withConstructorDefault(() => Option.some("")),
  Schema.withDecodingDefault(() => ""),
);

const CodexHostOverrideSchema = Schema.Struct({
  binaryPath: SettingsPathSchema,
  homePath: SettingsPathSchema,
});
export type CodexHostOverride = typeof CodexHostOverrideSchema.Type;
const DEFAULT_CODEX_HOST_OVERRIDE = CodexHostOverrideSchema.makeUnsafe({});

const KiroHostOverrideSchema = Schema.Struct({
  binaryPath: SettingsPathSchema,
});
export type KiroHostOverride = typeof KiroHostOverrideSchema.Type;
const DEFAULT_KIRO_HOST_OVERRIDE = KiroHostOverrideSchema.makeUnsafe({});

export const AppSettingsSchema = Schema.Struct({
  claudeBinaryPath: SettingsPathSchema,
  codexBinaryPath: SettingsPathSchema,
  codexHomePath: SettingsPathSchema,
  codexRemoteOverrides: Schema.Record(Schema.String, CodexHostOverrideSchema).pipe(
    Schema.withConstructorDefault(() => Option.some({})),
    Schema.withDecodingDefault(() => ({})),
  ),
  kiroBinaryPath: SettingsPathSchema,
  kiroRemoteOverrides: Schema.Record(Schema.String, KiroHostOverrideSchema).pipe(
    Schema.withConstructorDefault(() => Option.some({})),
    Schema.withDecodingDefault(() => ({})),
  ),
  defaultThreadEnvMode: Schema.Literals(["local", "worktree"]).pipe(
    Schema.withConstructorDefault(() => Option.some("local")),
    Schema.withDecodingDefault(() => "local" as const),
  ),
  gitDefaultAction: Schema.Literals(GIT_DEFAULT_ACTION_OPTIONS).pipe(
    Schema.withConstructorDefault(() => Option.some(DEFAULT_GIT_DEFAULT_ACTION)),
    Schema.withDecodingDefault(() => DEFAULT_GIT_DEFAULT_ACTION),
  ),
  gitCommitPrompt: GitCommitPromptSchema,
  gitHubBinaryPath: SettingsPathSchema,
  confirmThreadDelete: Schema.Boolean.pipe(
    Schema.withConstructorDefault(() => Option.some(true)),
    Schema.withDecodingDefault(() => true),
  ),
  diffWordWrap: Schema.Boolean.pipe(
    Schema.withConstructorDefault(() => Option.some(false)),
    Schema.withDecodingDefault(() => false),
  ),
  enableAssistantStreaming: Schema.Boolean.pipe(
    Schema.withConstructorDefault(() => Option.some(false)),
    Schema.withDecodingDefault(() => false),
  ),
  sidebarProjectSortOrder: Schema.Literals(SIDEBAR_PROJECT_SORT_ORDER_OPTIONS).pipe(
    Schema.withConstructorDefault(() => Option.some(DEFAULT_SIDEBAR_PROJECT_SORT_ORDER)),
    Schema.withDecodingDefault(() => DEFAULT_SIDEBAR_PROJECT_SORT_ORDER),
  ),
  sidebarThreadSortOrder: Schema.Literals(SIDEBAR_THREAD_SORT_ORDER_OPTIONS).pipe(
    Schema.withConstructorDefault(() => Option.some(DEFAULT_SIDEBAR_THREAD_SORT_ORDER)),
    Schema.withDecodingDefault(() => DEFAULT_SIDEBAR_THREAD_SORT_ORDER),
  ),
  desktopAppCloseBehavior: Schema.Literals(DESKTOP_APP_CLOSE_BEHAVIOR_OPTIONS).pipe(
    Schema.withConstructorDefault(() => Option.some(DEFAULT_DESKTOP_APP_CLOSE_BEHAVIOR)),
    Schema.withDecodingDefault(() => DEFAULT_DESKTOP_APP_CLOSE_BEHAVIOR),
  ),
  threadIdDisplayMode: Schema.Literals(THREAD_ID_DISPLAY_MODE_OPTIONS).pipe(
    Schema.withConstructorDefault(() => Option.some(DEFAULT_THREAD_ID_DISPLAY_MODE)),
    Schema.withDecodingDefault(() => DEFAULT_THREAD_ID_DISPLAY_MODE),
  ),
  timestampFormat: Schema.Literals(TIMESTAMP_FORMAT_OPTIONS).pipe(
    Schema.withConstructorDefault(() => Option.some(DEFAULT_TIMESTAMP_FORMAT)),
    Schema.withDecodingDefault(() => DEFAULT_TIMESTAMP_FORMAT),
  ),
  customCodexModels: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
    Schema.withDecodingDefault(() => []),
  ),
  customClaudeModels: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
    Schema.withDecodingDefault(() => []),
  ),
  customKiroModels: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
    Schema.withDecodingDefault(() => []),
  ),
  textGenerationModelSelection: ModelSelection.pipe(
    Schema.withConstructorDefault(() => Option.some(DEFAULT_GIT_TEXT_GENERATION_MODEL_SELECTION)),
    Schema.withDecodingDefault(() => DEFAULT_GIT_TEXT_GENERATION_MODEL_SELECTION),
  ),
});
export type AppSettings = typeof AppSettingsSchema.Type;

const DEFAULT_APP_SETTINGS = AppSettingsSchema.makeUnsafe({});

function normalizeAppSettings(settings: AppSettings & CustomModelSettings): AppSettings {
  return {
    ...settings,
    customCodexModels: normalizeCustomModelSlugs(settings.customCodexModels, "codex"),
    customClaudeModels: normalizeCustomModelSlugs(settings.customClaudeModels, "claudeAgent"),
    customKiroModels: normalizeCustomModelSlugs(settings.customKiroModels, "kiro"),
    textGenerationModelSelection: resolveAppModelSelectionState(settings),
  };
}

export function getCodexHostOverride(
  settings: Pick<AppSettings, "codexBinaryPath" | "codexHomePath" | "codexRemoteOverrides">,
  hostAlias?: string | null,
): CodexHostOverride {
  if (!hostAlias) {
    return {
      binaryPath: settings.codexBinaryPath,
      homePath: settings.codexHomePath,
    };
  }

  const override = settings.codexRemoteOverrides[hostAlias];
  if (!override) {
    return { ...DEFAULT_CODEX_HOST_OVERRIDE };
  }

  return {
    binaryPath: override.binaryPath,
    homePath: override.homePath,
  };
}

export function buildCodexHostOverridePatch(
  settings: Pick<AppSettings, "codexBinaryPath" | "codexHomePath" | "codexRemoteOverrides">,
  patch: Partial<CodexHostOverride>,
  hostAlias?: string | null,
): Partial<AppSettings> {
  const nextOverride = {
    ...getCodexHostOverride(settings, hostAlias),
    ...patch,
  };

  if (!hostAlias) {
    return {
      codexBinaryPath: nextOverride.binaryPath,
      codexHomePath: nextOverride.homePath,
    };
  }

  const codexRemoteOverrides = { ...settings.codexRemoteOverrides };
  if (!nextOverride.binaryPath && !nextOverride.homePath) {
    delete codexRemoteOverrides[hostAlias];
  } else {
    codexRemoteOverrides[hostAlias] = nextOverride;
  }

  return { codexRemoteOverrides };
}

export function getKiroHostOverride(
  settings: Pick<AppSettings, "kiroBinaryPath" | "kiroRemoteOverrides">,
  hostAlias?: string | null,
): KiroHostOverride {
  if (!hostAlias) {
    return {
      binaryPath: settings.kiroBinaryPath,
    };
  }

  const override = settings.kiroRemoteOverrides[hostAlias];
  if (!override) {
    return { ...DEFAULT_KIRO_HOST_OVERRIDE };
  }

  return {
    binaryPath: override.binaryPath,
  };
}

export function buildKiroHostOverridePatch(
  settings: Pick<AppSettings, "kiroBinaryPath" | "kiroRemoteOverrides">,
  patch: Partial<KiroHostOverride>,
  hostAlias?: string | null,
): Partial<AppSettings> {
  const nextOverride = {
    ...getKiroHostOverride(settings, hostAlias),
    ...patch,
  };

  if (!hostAlias) {
    return {
      kiroBinaryPath: nextOverride.binaryPath,
    };
  }

  const kiroRemoteOverrides = { ...settings.kiroRemoteOverrides };
  if (!nextOverride.binaryPath) {
    delete kiroRemoteOverrides[hostAlias];
  } else {
    kiroRemoteOverrides[hostAlias] = nextOverride;
  }

  return { kiroRemoteOverrides };
}

export function buildGitRequestSettings(
  settings: Pick<
    AppSettings,
    | "gitCommitPrompt"
    | "gitHubBinaryPath"
    | "textGenerationModelSelection"
    | "customCodexModels"
    | "customClaudeModels"
    | "customKiroModels"
  >,
): GitRequestSettings | undefined {
  const githubBinaryPath = settings.gitHubBinaryPath.trim();
  const commitPrompt = settings.gitCommitPrompt.trim();
  const textGenerationModelSelection = resolveAppModelSelectionState(settings);

  return {
    ...(githubBinaryPath ? { githubBinaryPath } : {}),
    ...(commitPrompt ? { commitPrompt } : {}),
    textGenerationModelSelection,
  };
}

export function getProviderStartOptions(
  settings: Pick<
    AppSettings,
    | "claudeBinaryPath"
    | "codexBinaryPath"
    | "codexHomePath"
    | "codexRemoteOverrides"
    | "kiroBinaryPath"
    | "kiroRemoteOverrides"
  >,
  hostAlias?: string | null,
): ProviderStartOptions | undefined {
  const codex = getCodexHostOverride(settings, hostAlias);
  const kiro = getKiroHostOverride(settings, hostAlias);

  const providerOptions: ProviderStartOptions = {
    ...(settings.claudeBinaryPath
      ? {
          claudeAgent: {
            binaryPath: settings.claudeBinaryPath,
          },
        }
      : {}),
    ...(codex.binaryPath || codex.homePath
      ? {
          codex: {
            ...(codex.binaryPath ? { binaryPath: codex.binaryPath } : {}),
            ...(codex.homePath ? { homePath: codex.homePath } : {}),
          },
        }
      : {}),
    ...(kiro.binaryPath
      ? {
          kiro: {
            binaryPath: kiro.binaryPath,
          },
        }
      : {}),
  };

  return Object.keys(providerOptions).length > 0 ? providerOptions : undefined;
}

export function useAppSettings() {
  const [settings, setSettings] = useLocalStorage(
    APP_SETTINGS_STORAGE_KEY,
    DEFAULT_APP_SETTINGS,
    AppSettingsSchema,
  );

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      setSettings((prev) => normalizeAppSettings({ ...prev, ...patch }));
    },
    [setSettings],
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_APP_SETTINGS);
  }, [setSettings]);

  return {
    settings,
    updateSettings,
    resetSettings,
    defaults: DEFAULT_APP_SETTINGS,
  } as const;
}
