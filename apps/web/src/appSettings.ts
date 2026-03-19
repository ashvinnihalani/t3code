import { useCallback } from "react";
import { Option, Schema } from "effect";
import {
  type GitRepoControlMode,
  type GitRequestSettings,
  type ProviderKind,
} from "@t3tools/contracts";
import { getDefaultModel, getModelOptions, normalizeModelSlug } from "@t3tools/shared/model";
import { useLocalStorage } from "./hooks/useLocalStorage";

export const APP_SETTINGS_STORAGE_KEY = "t3code:app-settings:v1";
const MAX_CUSTOM_MODEL_COUNT = 32;
export const MAX_CUSTOM_MODEL_LENGTH = 256;
export const TIMESTAMP_FORMAT_OPTIONS = ["locale", "12-hour", "24-hour"] as const;
export type TimestampFormat = (typeof TIMESTAMP_FORMAT_OPTIONS)[number];
export const DEFAULT_TIMESTAMP_FORMAT: TimestampFormat = "locale";
export const GIT_DEFAULT_ACTION_OPTIONS = [
  "auto",
  "commit",
  "commit_push",
  "commit_push_pr",
] as const;
export type GitDefaultAction = (typeof GIT_DEFAULT_ACTION_OPTIONS)[number];
export const DEFAULT_GIT_DEFAULT_ACTION: GitDefaultAction = "auto";
export const DEFAULT_GIT_REPO_CONTROL_MODE: GitRepoControlMode = "aggregate";
const BUILT_IN_MODEL_SLUGS_BY_PROVIDER: Record<ProviderKind, ReadonlySet<string>> = {
  codex: new Set(getModelOptions("codex").map((option) => option.slug)),
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

const AppSettingsSchema = Schema.Struct({
  codexBinaryPath: CodexSettingsPathSchema,
  codexHomePath: CodexSettingsPathSchema,
  codexRemoteOverrides: Schema.Record(Schema.String, CodexHostOverrideSchema).pipe(
    Schema.withConstructorDefault(() => Option.some({})),
    Schema.withDecodingDefault(() => ({})),
  ),
  defaultThreadEnvMode: Schema.Literals(["local", "worktree"]).pipe(
    Schema.withConstructorDefault(() => Option.some("local")),
  ),
  gitDefaultAction: Schema.Literals(GIT_DEFAULT_ACTION_OPTIONS).pipe(
    Schema.withConstructorDefault(() => Option.some(DEFAULT_GIT_DEFAULT_ACTION)),
  ),
  gitRepoControlModeDefault: Schema.Literals(["aggregate", "selected"]).pipe(
    Schema.withConstructorDefault(() => Option.some(DEFAULT_GIT_REPO_CONTROL_MODE)),
  ),
  gitCommitPrompt: GitCommitPromptSchema,
  gitHubBinaryPath: CodexSettingsPathSchema,
  confirmThreadDelete: Schema.Boolean.pipe(Schema.withConstructorDefault(() => Option.some(true))),
  enableAssistantStreaming: Schema.Boolean.pipe(
    Schema.withConstructorDefault(() => Option.some(false)),
  ),
  timestampFormat: Schema.Literals(["locale", "12-hour", "24-hour"]).pipe(
    Schema.withConstructorDefault(() => Option.some(DEFAULT_TIMESTAMP_FORMAT)),
  ),
  customCodexModels: Schema.Array(Schema.String).pipe(
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
  if (normalizedSelectedModel && !seen.has(normalizedSelectedModel)) {
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
  customModels: readonly string[],
  selectedModel: string | null | undefined,
): string {
  const options = getAppModelOptions(provider, customModels, selectedModel);
  const trimmedSelectedModel = selectedModel?.trim();
  if (trimmedSelectedModel) {
    const direct = options.find((option) => option.slug === trimmedSelectedModel);
    if (direct) {
      return direct.slug;
    }

    const byName = options.find(
      (option) => option.name.toLowerCase() === trimmedSelectedModel.toLowerCase(),
    );
    if (byName) {
      return byName.slug;
    }
  }

  const normalizedSelectedModel = normalizeModelSlug(selectedModel, provider);
  if (!normalizedSelectedModel) {
    return getDefaultModel(provider);
  }

  return (
    options.find((option) => option.slug === normalizedSelectedModel)?.slug ??
    getDefaultModel(provider)
  );
}

export function buildGitRequestSettings(
  settings: Pick<AppSettings, "gitCommitPrompt" | "gitHubBinaryPath">,
): GitRequestSettings | undefined {
  const githubBinaryPath = settings.gitHubBinaryPath.trim();
  const commitPrompt = settings.gitCommitPrompt.trim();
  if (!githubBinaryPath && !commitPrompt) {
    return undefined;
  }

  return {
    ...(githubBinaryPath ? { githubBinaryPath } : {}),
    ...(commitPrompt ? { commitPrompt } : {}),
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
      setSettings((prev) => ({
        ...prev,
        ...patch,
      }));
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
