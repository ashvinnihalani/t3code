import { describe, expect, it } from "@effect/vitest";

import { threadAccessOverrides, turnAccessOverrides } from "./composerOptions";

describe("composer access options", () => {
  it("maps upstream access labels onto app-server thread and turn overrides", () => {
    expect(threadAccessOverrides("supervised")).toEqual({
      approvalPolicy: "on-request",
      sandbox: "read-only",
    });
    expect(threadAccessOverrides("auto-accept-edits")).toEqual({
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    });
    expect(turnAccessOverrides("auto")).toEqual({
      approvalPolicy: "untrusted",
      sandboxPolicy: { type: "workspaceWrite" },
    });
    expect(turnAccessOverrides("full-access")).toEqual({
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
    });
  });
});
