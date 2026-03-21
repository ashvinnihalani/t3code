import { describe, expect, it } from "vitest";

import { getNextInteractionMode, INTERACTION_MODE_LABEL_BY_OPTION } from "./interactionModeControl";

describe("INTERACTION_MODE_LABEL_BY_OPTION", () => {
  it("exposes stable labels for each mode", () => {
    expect(INTERACTION_MODE_LABEL_BY_OPTION.default).toBe("Chat");
    expect(INTERACTION_MODE_LABEL_BY_OPTION.plan).toBe("Plan");
    expect(INTERACTION_MODE_LABEL_BY_OPTION.help).toBe("Help");
  });
});

describe("getNextInteractionMode", () => {
  it("cycles between chat and plan for two-mode providers", () => {
    expect(getNextInteractionMode("default", ["default", "plan"])).toBe("plan");
    expect(getNextInteractionMode("plan", ["default", "plan"])).toBe("default");
  });

  it("cycles through all three kiro modes", () => {
    const supportedModes = ["default", "plan", "help"] as const;

    expect(getNextInteractionMode("default", supportedModes)).toBe("plan");
    expect(getNextInteractionMode("plan", supportedModes)).toBe("help");
    expect(getNextInteractionMode("help", supportedModes)).toBe("default");
  });

  it("falls back to the first supported mode when the current mode is unavailable", () => {
    expect(getNextInteractionMode("help", ["default", "plan"])).toBe("default");
  });
});
