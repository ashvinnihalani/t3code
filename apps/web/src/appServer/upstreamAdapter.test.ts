import { describe, expect, it } from "@effect/vitest";

import { APP_VERSION } from "../branding";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveSelectableProviderInstanceEntry,
} from "../providerInstances";
import type { AppServerController } from "./context";
import {
  isNewAppServerThreadSelection,
  toEnvironmentThread,
  toServerConfig,
} from "./upstreamAdapter";

function controller(): AppServerController {
  return {
    environments: [
      {
        profile: {
          id: "local",
          name: "Local",
          connection: {
            kind: "local",
            executable: "codex",
            args: ["app-server"],
            workspace: "/workspace",
            env: {},
          },
        },
        phase: "connected",
        attempt: 1,
        error: null,
        retryAt: null,
        snapshot: null,
        account: {},
        remote: null,
        workspaceOpeners: ["cursor", "vscode", "zed", "file-manager"],
        models: [
          {
            id: "model",
            model: "gpt-test",
            displayName: "GPT Test",
            isDefault: true,
            description: "",
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "" },
              { reasoningEffort: "high", description: "" },
            ],
            defaultServiceTier: "standard",
            serviceTiers: [
              { id: "standard", name: "Standard", description: "" },
              { id: "fast", name: "Fast", description: "" },
            ],
          },
        ],
      },
    ],
    pendingApproval: {
      id: "approval-1",
      createdAt: 1_000,
      environmentId: "local",
      threadId: "thread-1",
      kind: "command",
      title: "Run tests",
      detail: "/workspace",
      reason: "Needs access",
      respond: () => undefined,
    },
  } as unknown as AppServerController;
}

describe("upstream app-server adapter", () => {
  it("only promotes a draft after app-server selects a different thread", () => {
    expect(isNewAppServerThreadSelection("previous", "previous")).toBe(false);
    expect(isNewAppServerThreadSelection("previous", null)).toBe(false);
    expect(isNewAppServerThreadSelection("previous", "created")).toBe(true);
  });

  it("exposes app-server model traits to the upstream picker", () => {
    const config = toServerConfig(controller(), "local");
    expect(config.providers[0]?.models[0]).toMatchObject({
      slug: "gpt-test",
      capabilities: {
        optionDescriptors: [
          { id: "reasoningEffort", currentValue: "medium" },
          { id: "serviceTier", currentValue: "standard" },
        ],
      },
    });
    expect(config.availableEditors).toEqual(["cursor", "vscode", "zed", "file-manager"]);
    expect(config.environment.serverVersion).toBe(APP_VERSION);
    const entries = applyProviderInstanceSettings(
      deriveProviderInstanceEntries(config.providers),
      config.settings,
    );
    expect(resolveSelectableProviderInstanceEntry(entries, undefined)?.instanceId).toBe("codex");
  });

  it("projects app-server approvals into the upstream composer activity model", () => {
    const thread = toEnvironmentThread(controller(), "local", {
      id: "thread-1",
      name: "Test",
      preview: "",
      cwd: "/workspace",
      createdAt: 1_000,
      updatedAt: 2_000,
      status: "active",
      turns: [],
    });
    expect(thread.activities).toMatchObject([
      {
        kind: "approval.requested",
        payload: {
          requestId: "approval-1",
          requestKind: "command",
          detail: "Needs access",
        },
      },
    ]);
  });

  it("projects app-server questions into the upstream structured-input model", () => {
    const base = controller();
    const withUserInput = {
      ...base,
      pendingApproval: null,
      pendingUserInput: {
        id: "question-1",
        createdAt: 1_000,
        environmentId: "local",
        threadId: "thread-1",
        questions: [
          {
            id: "scope",
            header: "Scope",
            question: "Which scope?",
            options: [{ label: "Focused", description: "Only this package" }],
            multiSelect: false,
          },
        ],
        respond: () => undefined,
      },
    } as AppServerController;
    const thread = toEnvironmentThread(withUserInput, "local", {
      id: "thread-1",
      name: "Test",
      preview: "",
      cwd: "/workspace",
      createdAt: 1_000,
      updatedAt: 2_000,
      status: "active",
      turns: [],
    });
    expect(thread.activities).toMatchObject([
      {
        kind: "user-input.requested",
        payload: {
          requestId: "question-1",
          questions: [{ id: "scope", multiSelect: false }],
        },
      },
    ]);
  });
});
