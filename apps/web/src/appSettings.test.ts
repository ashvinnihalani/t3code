import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIMESTAMP_FORMAT,
  buildCodexHostOverridePatch,
  getAppModelOptions,
  getCodexHostOverride,
  normalizeCustomModelSlugs,
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
});

describe("getAppModelOptions", () => {
  it("appends saved custom models after the built-in options", () => {
    const options = getAppModelOptions("codex", ["custom/internal-model"]);

    expect(options.map((option) => option.slug)).toEqual([
      "gpt-5.4",
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
});

describe("resolveAppModelSelection", () => {
  it("preserves saved custom model slugs instead of falling back to the default", () => {
    expect(resolveAppModelSelection("codex", ["galapagos-alpha"], "galapagos-alpha")).toBe(
      "galapagos-alpha",
    );
  });

  it("falls back to the provider default when no model is selected", () => {
    expect(resolveAppModelSelection("codex", [], "")).toBe("gpt-5.4");
  });
});

describe("timestamp format defaults", () => {
  it("defaults timestamp format to locale", () => {
    expect(DEFAULT_TIMESTAMP_FORMAT).toBe("locale");
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
