import { describe, expect, it } from "@effect/vitest";

import { APP_VERSION } from "../branding";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveSelectableProviderInstanceEntry,
} from "../providerInstances";
import type { AppServerController } from "./context";
import { projectThreadDetail } from "./presentation";
import {
  isNewAppServerThreadSelection,
  toEnvironmentProject,
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

  it("keeps cached app-server models available while reconnecting", () => {
    const reconnecting = controller();
    const config = toServerConfig(
      {
        ...reconnecting,
        environments: reconnecting.environments.map((environment) => ({
          ...environment,
          phase: "reconnecting" as const,
        })),
      } as AppServerController,
      "local",
    );

    expect(config.providers[0]).toMatchObject({
      status: "ready",
      models: [{ slug: "gpt-test" }],
    });
  });

  it("keeps direct projects on the app-server workspace path", () => {
    const project = toEnvironmentProject({
      key: "local:/workspace",
      environmentId: "local",
      environmentName: "Local",
      cwd: "/workspace",
      threads: [],
    });

    expect(project.defaultThreadEnvMode).toBe("local");
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

  it("keeps tool calls interleaved with assistant messages", () => {
    const detail = projectThreadDetail({
      id: "thread-1",
      cwd: "/workspace",
      name: "Ordered turn",
      preview: "",
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_010,
      status: { type: "idle" },
      turns: [
        {
          id: "turn-1",
          status: "completed",
          startedAt: 1_700_000_000,
          completedAt: 1_700_000_010,
          items: [
            { id: "user-1", type: "userMessage", content: [{ type: "text", text: "Go" }] },
            { id: "reasoning-1", type: "reasoning", summary: ["Thinking"] },
            {
              id: "tool-1",
              type: "commandExecution",
              command: "first",
              status: "completed",
            },
            { id: "commentary-1", type: "agentMessage", text: "Halfway there." },
            {
              id: "tool-2",
              type: "commandExecution",
              command: "second",
              status: "completed",
            },
            { id: "final-1", type: "agentMessage", text: "Done." },
          ],
        },
      ],
    });
    expect(detail).not.toBeNull();
    if (detail === null) return;

    const base = controller();
    const projected = toEnvironmentThread(
      { ...base, pendingApproval: null } as AppServerController,
      "local",
      detail,
    );
    const renderedOrder = [
      ...projected.messages.map((message) => ({ id: message.id, createdAt: message.createdAt })),
      ...projected.activities.map((activity) => ({
        id: activity.id,
        createdAt: activity.createdAt,
      })),
    ]
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((entry) => entry.id);

    expect(renderedOrder).toEqual([
      "user-1",
      "reasoning-1",
      "tool-1",
      "commentary-1",
      "tool-2",
      "final-1",
    ]);
  });

  it("projects per-thread app-server settings into composer controls", () => {
    const thread = toEnvironmentThread(controller(), "local", {
      id: "thread-1",
      name: "Test",
      preview: "",
      cwd: "/workspace",
      createdAt: 1_000,
      updatedAt: 2_000,
      status: "idle",
      turns: [],
      settings: {
        model: "gpt-other",
        effort: "high",
        serviceTier: "fast",
        runtimeMode: "auto-accept-edits",
        interactionMode: "plan",
      },
    });

    expect(thread).toMatchObject({
      modelSelection: {
        instanceId: "codex",
        model: "gpt-other",
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "serviceTier", value: "fast" },
        ],
      },
      runtimeMode: "auto-accept-edits",
      interactionMode: "plan",
    });
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
