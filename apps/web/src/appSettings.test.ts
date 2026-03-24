import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  AppSettingsSchema,
  DEFAULT_DESKTOP_APP_CLOSE_BEHAVIOR,
  DEFAULT_GIT_DEFAULT_ACTION,
  DEFAULT_THREAD_ID_DISPLAY_MODE,
  DEFAULT_TIMESTAMP_FORMAT,
  MODEL_PROVIDER_SETTINGS,
  buildCodexHostOverridePatch,
  buildGitRequestSettings,
  buildKiroHostOverridePatch,
  getAppModelOptions,
  getCodexHostOverride,
  getCustomModelOptionsByProvider,
  getCustomModelsByProvider,
  getCustomModelsForProvider,
  getDefaultCustomModelsForProvider,
  getKiroHostOverride,
  getProviderStartOptions,
  normalizeCustomModelSlugs,
  patchCustomModels,
  resolveAppModelSelection,
} from "./appSettings";

describe("normalizeCustomModelSlugs", () => {
  it("normalizes aliases, removes built-ins, and deduplicates values", () => {
    expect(
      normalizeCustomModelSlugs([
        " custom/internal-model ",
        "gpt-5.3-codex",
        "5.3",
        "custom/internal-model",
        "",
        null,
      ]),
    ).toEqual(["custom/internal-model"]);
  });

  it("normalizes provider-specific aliases for claude", () => {
    expect(normalizeCustomModelSlugs(["sonnet"], "claudeAgent")).toEqual([]);
    expect(normalizeCustomModelSlugs(["claude/custom-sonnet"], "claudeAgent")).toEqual([
      "claude/custom-sonnet",
    ]);
  });
});

describe("getAppModelOptions", () => {
  it("appends saved custom models after the built-in options", () => {
    const options = getAppModelOptions("codex", ["custom/internal-model"]);

    expect(options.map((option) => option.slug)).toEqual([
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.2-codex",
      "gpt-5.2",
      "custom/internal-model",
    ]);
  });

  it("keeps the currently selected custom model available even if it is no longer saved", () => {
    const options = getAppModelOptions("codex", [], "custom/selected-model");

    expect(options.at(-1)).toEqual({
      slug: "custom/selected-model",
      name: "custom/selected-model",
      isCustom: true,
    });
  });

  it("keeps a saved custom provider model available as an exact slug option", () => {
    const options = getAppModelOptions("claudeAgent", ["claude/custom-opus"], "claude/custom-opus");

    expect(options.some((option) => option.slug === "claude/custom-opus" && option.isCustom)).toBe(
      true,
    );
  });

  it("returns the built-in Kiro catalog and custom Kiro models", () => {
    const options = getAppModelOptions("kiro", ["custom/kiro-model"]);

    expect(options.map((option) => option.slug)).toContain("auto");
    expect(options.at(-1)).toEqual({
      slug: "custom/kiro-model",
      name: "custom/kiro-model",
      isCustom: true,
    });
  });
});

describe("resolveAppModelSelection", () => {
  it("preserves saved custom model slugs instead of falling back to the default", () => {
    expect(
      resolveAppModelSelection(
        "codex",
        { codex: ["galapagos-alpha"], claudeAgent: [], kiro: [] },
        "galapagos-alpha",
      ),
    ).toBe("galapagos-alpha");
  });

  it("falls back to the provider default when no model is selected", () => {
    expect(resolveAppModelSelection("codex", { codex: [], claudeAgent: [], kiro: [] }, "")).toBe(
      "gpt-5.4",
    );
  });

  it("resolves display names through the shared resolver", () => {
    expect(
      resolveAppModelSelection("codex", { codex: [], claudeAgent: [], kiro: [] }, "GPT-5.3 Codex"),
    ).toBe("gpt-5.3-codex");
  });

  it("resolves aliases through the shared resolver", () => {
    expect(
      resolveAppModelSelection("claudeAgent", { codex: [], claudeAgent: [], kiro: [] }, "sonnet"),
    ).toBe("claude-sonnet-4-6");
  });

  it("resolves transient selected custom models included in app model options", () => {
    expect(
      resolveAppModelSelection(
        "codex",
        { codex: [], claudeAgent: [], kiro: [] },
        "custom/selected-model",
      ),
    ).toBe("custom/selected-model");
  });

  it("falls back to the Kiro provider default when no model is selected", () => {
    expect(resolveAppModelSelection("kiro", { codex: [], claudeAgent: [], kiro: [] }, "")).toBe(
      "auto",
    );
  });
});

describe("timestamp format defaults", () => {
  it("defaults timestamp format to locale", () => {
    expect(DEFAULT_TIMESTAMP_FORMAT).toBe("locale");
  });
});

describe("desktop app close behavior defaults", () => {
  it("defaults desktop app close behavior to terminating all agents", () => {
    expect(DEFAULT_DESKTOP_APP_CLOSE_BEHAVIOR).toBe("terminate_all_agents");
  });
});

describe("git settings defaults", () => {
  it("defaults the primary git action to auto", () => {
    expect(DEFAULT_GIT_DEFAULT_ACTION).toBe("auto");
  });
});

describe("thread id display defaults", () => {
  it("hides thread ids by default", () => {
    expect(DEFAULT_THREAD_ID_DISPLAY_MODE).toBe("hidden");
  });
});

describe("provider-specific custom models", () => {
  it("includes provider-specific custom slugs in non-codex model lists", () => {
    const claudeOptions = getAppModelOptions("claudeAgent", ["claude/custom-opus"]);

    expect(claudeOptions.some((option) => option.slug === "claude/custom-opus")).toBe(true);
  });
});

describe("getProviderStartOptions", () => {
  it("returns only populated provider overrides", () => {
    expect(
      getProviderStartOptions({
        claudeBinaryPath: "/usr/local/bin/claude",
        codexBinaryPath: "",
        codexHomePath: "/Users/you/.codex",
        codexRemoteOverrides: {},
        kiroBinaryPath: "",
        kiroRemoteOverrides: {},
      }),
    ).toEqual({
      claudeAgent: {
        binaryPath: "/usr/local/bin/claude",
      },
      codex: {
        homePath: "/Users/you/.codex",
      },
    });
  });

  it("returns host-scoped codex and kiro overrides when a remote host is selected", () => {
    expect(
      getProviderStartOptions(
        {
          claudeBinaryPath: "/usr/local/bin/claude",
          codexBinaryPath: "/usr/local/bin/codex",
          codexHomePath: "/Users/you/.codex",
          codexRemoteOverrides: {
            "prod-box": {
              binaryPath: "/opt/codex/bin/codex",
              homePath: "/home/ubuntu/.codex",
            },
          },
          kiroBinaryPath: "",
          kiroRemoteOverrides: {
            "prod-box": {
              binaryPath: "/opt/kiro/bin/kiro-cli",
            },
          },
        },
        "prod-box",
      ),
    ).toEqual({
      claudeAgent: {
        binaryPath: "/usr/local/bin/claude",
      },
      codex: {
        binaryPath: "/opt/codex/bin/codex",
        homePath: "/home/ubuntu/.codex",
      },
      kiro: {
        binaryPath: "/opt/kiro/bin/kiro-cli",
      },
    });
  });

  it("returns undefined when no provider overrides are configured", () => {
    expect(
      getProviderStartOptions({
        claudeBinaryPath: "",
        codexBinaryPath: "",
        codexHomePath: "",
        codexRemoteOverrides: {},
        kiroBinaryPath: "",
        kiroRemoteOverrides: {},
      }),
    ).toBeUndefined();
  });
});

describe("provider-indexed custom model settings", () => {
  const settings = {
    customCodexModels: ["custom/codex-model"],
    customClaudeModels: ["claude/custom-opus"],
    customKiroModels: ["custom/kiro-model"],
  } as const;

  it("exports one provider config per provider", () => {
    expect(MODEL_PROVIDER_SETTINGS.map((config) => config.provider)).toEqual([
      "codex",
      "claudeAgent",
      "kiro",
    ]);
  });

  it("reads custom models for each provider", () => {
    expect(getCustomModelsForProvider(settings, "codex")).toEqual(["custom/codex-model"]);
    expect(getCustomModelsForProvider(settings, "claudeAgent")).toEqual(["claude/custom-opus"]);
    expect(getCustomModelsForProvider(settings, "kiro")).toEqual(["custom/kiro-model"]);
  });

  it("reads default custom models for each provider", () => {
    const defaults = {
      customCodexModels: ["default/codex-model"],
      customClaudeModels: ["claude/default-opus"],
      customKiroModels: ["default/kiro-model"],
    } as const;

    expect(getDefaultCustomModelsForProvider(defaults, "codex")).toEqual(["default/codex-model"]);
    expect(getDefaultCustomModelsForProvider(defaults, "claudeAgent")).toEqual([
      "claude/default-opus",
    ]);
    expect(getDefaultCustomModelsForProvider(defaults, "kiro")).toEqual(["default/kiro-model"]);
  });

  it("patches custom models for codex", () => {
    expect(patchCustomModels("codex", ["custom/codex-model"])).toEqual({
      customCodexModels: ["custom/codex-model"],
    });
  });

  it("patches custom models for claude", () => {
    expect(patchCustomModels("claudeAgent", ["claude/custom-opus"])).toEqual({
      customClaudeModels: ["claude/custom-opus"],
    });
  });

  it("patches custom models for kiro", () => {
    expect(patchCustomModels("kiro", ["custom/kiro-model"])).toEqual({
      customKiroModels: ["custom/kiro-model"],
    });
  });

  it("builds a complete provider-indexed custom model record", () => {
    expect(getCustomModelsByProvider(settings)).toEqual({
      codex: ["custom/codex-model"],
      claudeAgent: ["claude/custom-opus"],
      kiro: ["custom/kiro-model"],
    });
  });

  it("builds provider-indexed model options including custom models", () => {
    const modelOptionsByProvider = getCustomModelOptionsByProvider(settings);

    expect(
      modelOptionsByProvider.codex.some((option) => option.slug === "custom/codex-model"),
    ).toBe(true);
    expect(
      modelOptionsByProvider.claudeAgent.some((option) => option.slug === "claude/custom-opus"),
    ).toBe(true);
    expect(modelOptionsByProvider.kiro.some((option) => option.slug === "custom/kiro-model")).toBe(
      true,
    );
  });

  it("normalizes and deduplicates custom model options per provider", () => {
    const modelOptionsByProvider = getCustomModelOptionsByProvider({
      customCodexModels: ["  custom/codex-model ", "gpt-5.4", "custom/codex-model"],
      customClaudeModels: [" sonnet ", "claude/custom-opus", "claude/custom-opus"],
      customKiroModels: [" auto ", "custom/kiro-model", "custom/kiro-model"],
    });

    expect(
      modelOptionsByProvider.codex.filter((option) => option.slug === "custom/codex-model"),
    ).toHaveLength(1);
    expect(modelOptionsByProvider.codex.some((option) => option.slug === "gpt-5.4")).toBe(true);
    expect(
      modelOptionsByProvider.claudeAgent.filter((option) => option.slug === "claude/custom-opus"),
    ).toHaveLength(1);
    expect(
      modelOptionsByProvider.claudeAgent.some((option) => option.slug === "claude-sonnet-4-6"),
    ).toBe(true);
    expect(
      modelOptionsByProvider.kiro.filter((option) => option.slug === "custom/kiro-model"),
    ).toHaveLength(1);
  });
});

describe("AppSettingsSchema", () => {
  it("fills decoding defaults for persisted settings that predate newer keys", () => {
    const decode = (value: string) =>
      Schema.decodeUnknownSync(AppSettingsSchema)(JSON.parse(value));

    expect(
      decode(
        JSON.stringify({
          codexBinaryPath: "/usr/local/bin/codex",
          confirmThreadDelete: false,
        }),
      ),
    ).toMatchObject({
      claudeBinaryPath: "",
      codexBinaryPath: "/usr/local/bin/codex",
      codexHomePath: "",
      defaultThreadEnvMode: "local",
      confirmThreadDelete: false,
      enableAssistantStreaming: false,
      timestampFormat: DEFAULT_TIMESTAMP_FORMAT,
      customCodexModels: [],
      customClaudeModels: [],
      customKiroModels: [],
    });
  });
});

describe("buildGitRequestSettings", () => {
  it("omits empty git request settings", () => {
    expect(
      buildGitRequestSettings({
        gitCommitPrompt: "   ",
        gitHubBinaryPath: "",
        textGenerationModel: undefined,
      }),
    ).toBeUndefined();
  });

  it("returns trimmed git request settings", () => {
    expect(
      buildGitRequestSettings({
        gitCommitPrompt: "  prefer concise infra-focused commits  ",
        gitHubBinaryPath: "  /opt/bin/gh-custom  ",
        textGenerationModel: "  gpt-5.4-mini  ",
      }),
    ).toEqual({
      commitPrompt: "prefer concise infra-focused commits",
      githubBinaryPath: "/opt/bin/gh-custom",
      textGenerationModel: "gpt-5.4-mini",
    });
  });
});

describe("codex host overrides", () => {
  it("reads the local override when no host is selected", () => {
    expect(
      getCodexHostOverride(
        {
          codexBinaryPath: "/usr/local/bin/codex",
          codexHomePath: "/Users/test/.codex",
          codexRemoteOverrides: {},
        },
        null,
      ),
    ).toEqual({
      binaryPath: "/usr/local/bin/codex",
      homePath: "/Users/test/.codex",
    });
  });

  it("reads a saved remote override for the selected host", () => {
    expect(
      getCodexHostOverride(
        {
          codexBinaryPath: "",
          codexHomePath: "",
          codexRemoteOverrides: {
            "prod-box": {
              binaryPath: "/opt/codex/bin/codex",
              homePath: "/home/ubuntu/.codex",
            },
          },
        },
        "prod-box",
      ),
    ).toEqual({
      binaryPath: "/opt/codex/bin/codex",
      homePath: "/home/ubuntu/.codex",
    });
  });

  it("falls back to blank values for a host without a saved override", () => {
    expect(
      getCodexHostOverride(
        {
          codexBinaryPath: "/usr/local/bin/codex",
          codexHomePath: "/Users/test/.codex",
          codexRemoteOverrides: {},
        },
        "staging-box",
      ),
    ).toEqual({
      binaryPath: "",
      homePath: "",
    });
  });

  it("patches local overrides without touching remote host overrides", () => {
    expect(
      buildCodexHostOverridePatch(
        {
          codexBinaryPath: "",
          codexHomePath: "",
          codexRemoteOverrides: {
            "prod-box": {
              binaryPath: "/opt/codex/bin/codex",
              homePath: "",
            },
          },
        },
        {
          binaryPath: "/usr/local/bin/codex",
        },
        null,
      ),
    ).toEqual({
      codexBinaryPath: "/usr/local/bin/codex",
      codexHomePath: "",
    });
  });

  it("removes a remote override when both host values are reset to blank", () => {
    expect(
      buildCodexHostOverridePatch(
        {
          codexBinaryPath: "",
          codexHomePath: "",
          codexRemoteOverrides: {
            "prod-box": {
              binaryPath: "/opt/codex/bin/codex",
              homePath: "/home/ubuntu/.codex",
            },
          },
        },
        {
          binaryPath: "",
          homePath: "",
        },
        "prod-box",
      ),
    ).toEqual({
      codexRemoteOverrides: {},
    });
  });
});

describe("kiro host overrides", () => {
  it("reads the local override when no host is selected", () => {
    expect(
      getKiroHostOverride(
        {
          kiroBinaryPath: "/usr/local/bin/kiro-cli",
          kiroRemoteOverrides: {},
        },
        null,
      ),
    ).toEqual({
      binaryPath: "/usr/local/bin/kiro-cli",
    });
  });

  it("reads a saved remote override for the selected host", () => {
    expect(
      getKiroHostOverride(
        {
          kiroBinaryPath: "",
          kiroRemoteOverrides: {
            "prod-box": {
              binaryPath: "/opt/kiro/bin/kiro-cli",
            },
          },
        },
        "prod-box",
      ),
    ).toEqual({
      binaryPath: "/opt/kiro/bin/kiro-cli",
    });
  });

  it("removes a remote override when the host value is reset to blank", () => {
    expect(
      buildKiroHostOverridePatch(
        {
          kiroBinaryPath: "",
          kiroRemoteOverrides: {
            "prod-box": {
              binaryPath: "/opt/kiro/bin/kiro-cli",
            },
          },
        },
        {
          binaryPath: "",
        },
        "prod-box",
      ),
    ).toEqual({
      kiroRemoteOverrides: {},
    });
  });
});
