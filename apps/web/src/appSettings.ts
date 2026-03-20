import { useCallback } from "react";
import { Option, Schema } from "effect";
import {
  DESKTOP_APP_CLOSE_BEHAVIOR_OPTIONS,
  TrimmedNonEmptyString,
  type DesktopAppCloseBehavior,
  type GitRequestSettings,
  type ProviderKind,
} from "@t3tools/contracts";
import {
  getDefaultModel,
  getModelOptions,
  normalizeModelSlug,
  resolveSelectableModel,
} from "@t3tools/shared/model";
import { useLocalStorage } from "./hooks/useLocalStorage";

export const APP_SETTINGS_STORAGE_KEY = "t3code:app-settings:v1";
const MAX_CUSTOM_MODEL_COUNT = 32;
export const MAX_CUSTOM_MODEL_LENGTH = 256;
export const TIMESTAMP_FORMAT_OPTIONS = ["locale", "12-hour", "24-hour"] as const;
export type TimestampFormat = (typeof TIMESTAMP_FORMAT_OPTIONS)[number];
export const DEFAULT_TIMESTAMP_FORMAT: TimestampFormat = "locale";
export const DEFAULT_DESKTOP_APP_CLOSE_BEHAVIOR: DesktopAppCloseBehavior = "terminate_all_agents";
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
type CustomModelSettingsKey = "customCodexModels" | "customClaudeModels" | "customKiroModels";
export type ProviderCustomModelConfig = {
  provider: ProviderKind;
  settingsKey: CustomModelSettingsKey;
  defaultSettingsKey: CustomModelSettingsKey;
  title: string;
  description: string;
  placeholder: string;
  example: string;
};
const BUILT_IN_MODEL_SLUGS_BY_PROVIDER: Record<ProviderKind, ReadonlySet<string>> = {
  codex: new Set(getModelOptions("codex").map((option) => option.slug)),
  claudeAgent: new Set(getModelOptions("claudeAgent").map((option) => option.slug)),
  kiro: new Set(getModelOptions("kiro").map((option) => option.slug)),
};
const CodexSettingsPathSchema = Schema.String.check(Schema.isMaxLength(4096)).pipe(
  Schema.withConstructorDefault(() => Option.some("")),
  Schema.withDecodingDefault(() => ""),
);
const GitCommitPromptSchema = Schema.String.check(Schema.isMaxLength(10_000)).pipe(
  Schema.withConstructorDefault(() => Option.some("")),
  Schema.withDecodingDefault(() => ""),
);
const CodexHostOverrideSchema = Schema.Struct({
  binaryPath: CodexSettingsPathSchema,
  homePath: CodexSettingsPathSchema,
});
export type CodexHostOverride = typeof CodexHostOverrideSchema.Type;
const DEFAULT_CODEX_HOST_OVERRIDE = CodexHostOverrideSchema.makeUnsafe({});
const KiroHostOverrideSchema = Schema.Struct({
  binaryPath: CodexSettingsPathSchema,
});
export type KiroHostOverride = typeof KiroHostOverrideSchema.Type;
const DEFAULT_KIRO_HOST_OVERRIDE = KiroHostOverrideSchema.makeUnsafe({});

export const AppSettingsSchema = Schema.Struct({
  codexBinaryPath: CodexSettingsPathSchema,
  codexHomePath: CodexSettingsPathSchema,
  codexRemoteOverrides: Schema.Record(Schema.String, CodexHostOverrideSchema).pipe(
    Schema.withConstructorDefault(() => Option.some({})),
    Schema.withDecodingDefault(() => ({})),
  ),
  kiroBinaryPath: CodexSettingsPathSchema,
  kiroRemoteOverrides: Schema.Record(Schema.String, KiroHostOverrideSchema).pipe(
    Schema.withConstructorDefault(() => Option.some({})),
    Schema.withDecodingDefault(() => ({})),
  ),
  defaultThreadEnvMode: Schema.Literals(["local", "worktree"]).pipe(
    Schema.withConstructorDefault(() => Option.some("local")),
  ),
  gitDefaultAction: Schema.Literals(GIT_DEFAULT_ACTION_OPTIONS).pipe(
    Schema.withConstructorDefault(() => Option.some(DEFAULT_GIT_DEFAULT_ACTION)),
  ),
  gitCommitPrompt: GitCommitPromptSchema,
  gitHubBinaryPath: CodexSettingsPathSchema,
  confirmThreadDelete: Schema.Boolean.pipe(Schema.withConstructorDefault(() => Option.some(true))),
  enableAssistantStreaming: Schema.Boolean.pipe(
    Schema.withConstructorDefault(() => Option.some(false)),
  ),
  desktopAppCloseBehavior: Schema.Literals(DESKTOP_APP_CLOSE_BEHAVIOR_OPTIONS).pipe(
    Schema.withConstructorDefault(() => Option.some(DEFAULT_DESKTOP_APP_CLOSE_BEHAVIOR)),
  ),
  threadIdDisplayMode: Schema.Literals(["hidden", "composer", "message"]).pipe(
    Schema.withConstructorDefault(() => Option.some(DEFAULT_THREAD_ID_DISPLAY_MODE)),
  ),
  timestampFormat: Schema.Literals(["locale", "12-hour", "24-hour"]).pipe(
    Schema.withConstructorDefault(() => Option.some(DEFAULT_TIMESTAMP_FORMAT)),
  ),
  customCodexModels: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
  ),
  customClaudeModels: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
  ),
  textGenerationModel: Schema.optional(TrimmedNonEmptyString),
  customKiroModels: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
  ),
});
export type AppSettings = typeof AppSettingsSchema.Type;
export interface AppModelOption {
  slug: string;
  name: string;
  isCustom: boolean;
}

const DEFAULT_APP_SETTINGS = AppSettingsSchema.makeUnsafe({});
const PROVIDER_CUSTOM_MODEL_CONFIG: Record<ProviderKind, ProviderCustomModelConfig> = {
  codex: {
    provider: "codex",
    settingsKey: "customCodexModels",
    defaultSettingsKey: "customCodexModels",
    title: "Codex",
    description: "Save additional Codex model slugs for the picker and `/model` command.",
    placeholder: "your-codex-model-slug",
    example: "gpt-6.7-codex-ultra-preview",
  },
  claudeAgent: {
    provider: "claudeAgent",
    settingsKey: "customClaudeModels",
    defaultSettingsKey: "customClaudeModels",
    title: "Claude",
    description: "Save additional Claude model slugs for the picker and `/model` command.",
    placeholder: "your-claude-model-slug",
    example: "claude-sonnet-5-0",
  },
  kiro: {
    provider: "kiro",
    settingsKey: "customKiroModels",
    defaultSettingsKey: "customKiroModels",
    title: "Kiro CLI",
    description: "Save additional Kiro model slugs for the picker and `/model` command.",
    placeholder: "your-kiro-model-slug",
    example: "claude-sonnet4.6",
  },
};
export const MODEL_PROVIDER_SETTINGS = Object.values(PROVIDER_CUSTOM_MODEL_CONFIG);

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

export function normalizeCustomModelSlugs(
  models: Iterable<string | null | undefined>,
  provider: ProviderKind = "codex",
): string[] {
  const normalizedModels: string[] = [];
  const seen = new Set<string>();
  const builtInModelSlugs = BUILT_IN_MODEL_SLUGS_BY_PROVIDER[provider];

  for (const candidate of models) {
    const normalized = normalizeModelSlug(candidate, provider);
    if (
      !normalized ||
      normalized.length > MAX_CUSTOM_MODEL_LENGTH ||
      builtInModelSlugs.has(normalized) ||
      seen.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);
    normalizedModels.push(normalized);
    if (normalizedModels.length >= MAX_CUSTOM_MODEL_COUNT) {
      break;
    }
  }

  return normalizedModels;
}

function normalizeAppSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    customCodexModels: normalizeCustomModelSlugs(settings.customCodexModels, "codex"),
    customClaudeModels: normalizeCustomModelSlugs(settings.customClaudeModels, "claudeAgent"),
    customKiroModels: normalizeCustomModelSlugs(settings.customKiroModels, "kiro"),
  };
}

export function getCustomModelsForProvider(
  settings: Pick<AppSettings, CustomModelSettingsKey>,
  provider: ProviderKind,
): readonly string[] {
  return settings[PROVIDER_CUSTOM_MODEL_CONFIG[provider].settingsKey];
}

export function getDefaultCustomModelsForProvider(
  defaults: Pick<AppSettings, CustomModelSettingsKey>,
  provider: ProviderKind,
): readonly string[] {
  return defaults[PROVIDER_CUSTOM_MODEL_CONFIG[provider].defaultSettingsKey];
}

export function patchCustomModels(
  provider: ProviderKind,
  models: string[],
): Partial<Pick<AppSettings, CustomModelSettingsKey>> {
  return {
    [PROVIDER_CUSTOM_MODEL_CONFIG[provider].settingsKey]: models,
  };
}

export function getCustomModelsByProvider(
  settings: Pick<AppSettings, CustomModelSettingsKey>,
): Record<ProviderKind, readonly string[]> {
  return {
    codex: getCustomModelsForProvider(settings, "codex"),
    claudeAgent: getCustomModelsForProvider(settings, "claudeAgent"),
    kiro: getCustomModelsForProvider(settings, "kiro"),
  };
}
export function getAppModelOptions(
  provider: ProviderKind,
  customModels: readonly string[],
  selectedModel?: string | null,
): AppModelOption[] {
  const options: AppModelOption[] = getModelOptions(provider).map(({ slug, name }) => ({
    slug,
    name,
    isCustom: false,
  }));
  const seen = new Set(options.map((option) => option.slug));
  const trimmedSelectedModel = selectedModel?.trim().toLowerCase();

  for (const slug of normalizeCustomModelSlugs(customModels, provider)) {
    if (seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    options.push({
      slug,
      name: slug,
      isCustom: true,
    });
  }

  const normalizedSelectedModel = normalizeModelSlug(selectedModel, provider);
  const selectedModelMatchesExistingName =
    typeof trimmedSelectedModel === "string" &&
    options.some((option) => option.name.toLowerCase() === trimmedSelectedModel);
  if (
    normalizedSelectedModel &&
    !seen.has(normalizedSelectedModel) &&
    !selectedModelMatchesExistingName
  ) {
    options.push({
      slug: normalizedSelectedModel,
      name: normalizedSelectedModel,
      isCustom: true,
    });
  }

  return options;
}

export function resolveAppModelSelection(
  provider: ProviderKind,
  customModels: Record<ProviderKind, readonly string[]>,
  selectedModel: string | null | undefined,
): string {
  const customModelsForProvider = customModels[provider];
  const options = getAppModelOptions(provider, customModelsForProvider, selectedModel);
  return resolveSelectableModel(provider, selectedModel, options) ?? getDefaultModel(provider);
}

export function getCustomModelOptionsByProvider(
  settings: Pick<AppSettings, CustomModelSettingsKey>,
): Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>> {
  const customModelsByProvider = getCustomModelsByProvider(settings);
  return {
    codex: getAppModelOptions("codex", customModelsByProvider.codex),
    claudeAgent: getAppModelOptions("claudeAgent", customModelsByProvider.claudeAgent),
    kiro: getAppModelOptions("kiro", customModelsByProvider.kiro),
  };
}

export function buildGitRequestSettings(
  settings: Pick<AppSettings, "gitCommitPrompt" | "gitHubBinaryPath" | "textGenerationModel">,
): GitRequestSettings | undefined {
  const githubBinaryPath = settings.gitHubBinaryPath.trim();
  const commitPrompt = settings.gitCommitPrompt.trim();
  const textGenerationModel = settings.textGenerationModel?.trim() ?? "";
  if (!githubBinaryPath && !commitPrompt && !textGenerationModel) {
    return undefined;
  }

  return {
    ...(githubBinaryPath ? { githubBinaryPath } : {}),
    ...(commitPrompt ? { commitPrompt } : {}),
    ...(textGenerationModel ? { textGenerationModel } : {}),
  };
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
