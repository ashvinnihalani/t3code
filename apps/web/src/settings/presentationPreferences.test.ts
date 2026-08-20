import { describe, expect, it } from "@effect/vitest";

import {
  DEFAULT_PRESENTATION_PREFERENCES,
  normalizePresentationPreferences,
} from "./presentationPreferences";

describe("presentation preferences", () => {
  it("uses defaults for missing or invalid stored data", () => {
    expect(normalizePresentationPreferences(null)).toEqual(DEFAULT_PRESENTATION_PREFERENCES);
    expect(normalizePresentationPreferences({ colorScheme: "sepia" }).colorScheme).toBe("system");
  });

  it("retains valid choices and bounds font sizes", () => {
    expect(
      normalizePresentationPreferences({
        colorScheme: "dark",
        groupProjects: false,
        timestampFormat: "24-hour",
        interfaceFontSize: 99,
        promptFontSize: 9,
        codeFontSize: 14,
      }),
    ).toEqual({
      colorScheme: "dark",
      groupProjects: false,
      timestampFormat: "24-hour",
      interfaceFontSize: 19,
      promptFontSize: 12,
      codeFontSize: 14,
    });
  });
});
