import "../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const { openResolvedEditorTargetInPreferredEditorSpy, readNativeApiSpy } = vi.hoisted(() => ({
  openResolvedEditorTargetInPreferredEditorSpy: vi.fn(async () => "vscode"),
  readNativeApiSpy: vi.fn(() => ({})),
}));

vi.mock("../editorPreferences", () => ({
  openResolvedEditorTargetInPreferredEditor: openResolvedEditorTargetInPreferredEditorSpy,
}));

vi.mock("../nativeApi", () => ({
  readNativeApi: readNativeApiSpy,
}));

import ChatMarkdown from "./ChatMarkdown";

const LINK_CONTEXT = {
  projectId: undefined,
  threadId: undefined,
  referenceRoot: undefined,
  remote: null,
};

describe("ChatMarkdown", () => {
  afterEach(() => {
    openResolvedEditorTargetInPreferredEditorSpy.mockClear();
    readNativeApiSpy.mockClear();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("rewrites file uri hrefs into direct paths before rendering", async () => {
    const filePath =
      "/Users/yashsingh/p/sco/claude-code-extract/src/utils/permissions/PermissionRule.ts";
    const screen = await render(
      <ChatMarkdown
        text={`[PermissionRule.ts](file://${filePath})`}
        linkContext={LINK_CONTEXT}
      />,
    );

    try {
      const link = page.getByRole("link", { name: "PermissionRule.ts" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", filePath);

      await link.click();

      await vi.waitFor(() => {
        expect(openResolvedEditorTargetInPreferredEditorSpy).toHaveBeenCalledWith(
          expect.anything(),
          { kind: "shell", target: filePath },
        );
      });
    } finally {
      await screen.unmount();
    }
  });

  it("keeps line anchors working after rewriting file uri hrefs", async () => {
    const filePath =
      "/Users/yashsingh/p/sco/claude-code-extract/src/utils/permissions/PermissionRule.ts";
    const screen = await render(
      <ChatMarkdown
        text={`[PermissionRule.ts:1](file://${filePath}#L1)`}
        linkContext={LINK_CONTEXT}
      />,
    );

    try {
      const link = page.getByRole("link", { name: "PermissionRule.ts:1" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", `${filePath}#L1`);

      await link.click();

      await vi.waitFor(() => {
        expect(openResolvedEditorTargetInPreferredEditorSpy).toHaveBeenCalledWith(
          expect.anything(),
          { kind: "shell", target: `${filePath}:1` },
        );
      });
    } finally {
      await screen.unmount();
    }
  });
});
