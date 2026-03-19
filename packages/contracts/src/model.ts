import { Schema } from "effect";
import { ProviderInteractionMode, ProviderKind } from "./orchestration";

export const CODEX_REASONING_EFFORT_OPTIONS = ["xhigh", "high", "medium", "low"] as const;
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORT_OPTIONS)[number];

export const CodexModelOptions = Schema.Struct({
  reasoningEffort: Schema.optional(Schema.Literals(CODEX_REASONING_EFFORT_OPTIONS)),
  fastMode: Schema.optional(Schema.Boolean),
});
export type CodexModelOptions = typeof CodexModelOptions.Type;

export const ProviderModelOptions = Schema.Struct({
  codex: Schema.optional(CodexModelOptions),
});
export type ProviderModelOptions = typeof ProviderModelOptions.Type;

type ModelOption = {
  readonly slug: string;
  readonly name: string;
};

export const MODEL_OPTIONS_BY_PROVIDER = {
  codex: [
    { slug: "gpt-5.4", name: "GPT-5.4" },
    { slug: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { slug: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark" },
    { slug: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
    { slug: "gpt-5.2", name: "GPT-5.2" },
  ],
  kiro: [
    { slug: "auto", name: "Auto" },
    { slug: "claude-opus-4.6", name: "Claude Opus 4.6" },
    { slug: "claude-opus-4.5", name: "Claude Opus 4.5" },
    { slug: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { slug: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    { slug: "claude-sonnet-4", name: "Claude Sonnet 4" },
    { slug: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
    { slug: "deepseek-3.2", name: "DeepSeek 3.2" },
    { slug: "minimax-m2.5", name: "MiniMax M2.5" },
    { slug: "minimax-m2.1", name: "MiniMax M2.1" },
    { slug: "qwen3-coder-next", name: "Qwen3 Coder Next" },
  ],
} as const satisfies Record<ProviderKind, readonly ModelOption[]>;
export type ModelOptionsByProvider = typeof MODEL_OPTIONS_BY_PROVIDER;

type BuiltInModelSlug = ModelOptionsByProvider[ProviderKind][number]["slug"];
export type ModelSlug = BuiltInModelSlug | (string & {});

export const DEFAULT_MODEL_BY_PROVIDER = {
  codex: "gpt-5.4",
  kiro: "auto",
} as const satisfies Record<ProviderKind, ModelSlug>;

export const DEFAULT_GIT_TEXT_GENERATION_MODEL = "gpt-5.4-mini" as const;

export const MODEL_SLUG_ALIASES_BY_PROVIDER = {
  codex: {
    "5.4": "gpt-5.4",
    "5.3": "gpt-5.3-codex",
    "gpt-5.3": "gpt-5.3-codex",
    "5.3-spark": "gpt-5.3-codex-spark",
    "gpt-5.3-spark": "gpt-5.3-codex-spark",
  },
  kiro: {
    "claude-opus4.6": "claude-opus-4.6",
    "claude-opus4.5": "claude-opus-4.5",
    "claude-sonnet4.6": "claude-sonnet-4.6",
    "claude-sonnet4.5": "claude-sonnet-4.5",
    "claude-sonnet4.0": "claude-sonnet-4",
    "claude-haiku4.5": "claude-haiku-4.5",
    "minimax-2.5": "minimax-m2.5",
    "minimax-2.1": "minimax-m2.1",
  },
} as const satisfies Record<ProviderKind, Record<string, ModelSlug>>;

export const REASONING_EFFORT_OPTIONS_BY_PROVIDER = {
  codex: CODEX_REASONING_EFFORT_OPTIONS,
  kiro: [],
} as const satisfies Record<ProviderKind, readonly CodexReasoningEffort[]>;

export const DEFAULT_REASONING_EFFORT_BY_PROVIDER = {
  codex: "high",
  kiro: null,
} as const satisfies Record<ProviderKind, CodexReasoningEffort | null>;

export const SUPPORTED_INTERACTION_MODES_BY_PROVIDER = {
  codex: ["default", "plan"],
  kiro: ["default", "plan", "help"],
} as const satisfies Record<ProviderKind, readonly ProviderInteractionMode[]>;

export const ROLLBACK_SUPPORTED_BY_PROVIDER = {
  codex: true,
  kiro: false,
} as const satisfies Record<ProviderKind, boolean>;
