import { describe, expect, it } from "@effect/vitest";

import {
  applyThreadSettings,
  aliasTurnUserMessage,
  appendAgentMessageDelta,
  mergeThreadDetails,
  projectModels,
  projectThreadDetail,
  projectThreadSummary,
  upsertTimelineItem,
  upsertTurn,
} from "./presentation";

const thread = {
  id: "thread-1",
  cwd: "/work/t3code",
  name: null,
  preview: "Build the desktop",
  createdAt: 10,
  updatedAt: 20,
  status: { type: "active", activeFlags: [] },
  turns: [
    {
      id: "turn-1",
      status: "inProgress",
      items: [
        {
          id: "user-1",
          type: "userMessage",
          content: [{ type: "text", text: "Build the desktop" }],
        },
      ],
    },
  ],
};

describe("app-server presentation projection", () => {
  it("projects list and timeline data without leaking protocol types into components", () => {
    expect(projectThreadSummary(thread)).toEqual({
      id: "thread-1",
      cwd: "/work/t3code",
      name: null,
      preview: "Build the desktop",
      createdAt: 10,
      updatedAt: 20,
      status: "active",
    });
    expect(projectThreadDetail(thread)?.turns[0]?.items[0]?.text).toBe("Build the desktop");
  });

  it("merges item lifecycle notifications and streaming deltas", () => {
    const detail = projectThreadDetail(thread);
    expect(detail).not.toBeNull();
    if (detail === null) return;

    const started = upsertTimelineItem(detail, "turn-1", {
      id: "agent-1",
      type: "agentMessage",
      text: "Starting",
    });
    const streamed = appendAgentMessageDelta(started, "turn-1", "agent-1", " now");
    expect(streamed.turns[0]?.items[1]?.text).toBe("Starting now");
  });

  it("keeps prior messages and tool items when a completed turn snapshot is sparse", () => {
    const detail = projectThreadDetail(thread);
    expect(detail).not.toBeNull();
    if (detail === null) return;

    const withTool = upsertTimelineItem(detail, "turn-1", {
      id: "tool-1",
      type: "commandExecution",
      command: "git status",
      status: "inProgress",
    });
    const completed = upsertTurn(withTool, {
      id: "turn-1",
      status: "completed",
      items: [
        {
          id: "agent-1",
          type: "agentMessage",
          text: "Done",
        },
      ],
    });

    expect(completed.turns[0]?.items.map((item) => item.id)).toEqual([
      "user-1",
      "tool-1",
      "agent-1",
    ]);
  });

  it("reconciles an optimistic user message with the app-server item across turn snapshots", () => {
    const detail = projectThreadDetail(thread);
    expect(detail).not.toBeNull();
    if (detail === null) return;

    const aliased = aliasTurnUserMessage(detail, "turn-1", "user-1", "optimistic-1");
    const completed = upsertTurn(aliased, {
      id: "turn-1",
      status: "completed",
      items: [
        {
          id: "user-1",
          type: "userMessage",
          content: [{ type: "text", text: "Build the desktop" }],
        },
        { id: "agent-1", type: "agentMessage", text: "Done" },
      ],
    });

    expect(completed.turns[0]?.items.map((item) => item.id)).toEqual(["optimistic-1", "agent-1"]);
  });

  it("merges a late hydration snapshot with notifications already rendered", () => {
    const current = projectThreadDetail(thread);
    expect(current).not.toBeNull();
    if (current === null) return;
    const withLiveMessage = appendAgentMessageDelta(current, "turn-1", "agent-live", "Live");
    const hydration = projectThreadDetail({
      ...thread,
      turns: [
        {
          id: "turn-1",
          status: "inProgress",
          items: [
            {
              id: "user-1",
              type: "userMessage",
              content: [{ type: "text", text: "Build the desktop" }],
            },
          ],
        },
      ],
    });
    expect(hydration).not.toBeNull();
    if (hydration === null) return;

    expect(
      mergeThreadDetails(withLiveMessage, hydration).turns[0]?.items.map((item) => item.id),
    ).toEqual(["user-1", "agent-live"]);
  });

  it("preserves app-server model traits for composer controls", () => {
    expect(
      projectModels({
        data: [
          {
            id: "gpt-5.6",
            model: "gpt-5.6",
            displayName: "GPT-5.6",
            description: "Latest model",
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Faster" },
              { reasoningEffort: "medium", description: "Balanced" },
            ],
            defaultServiceTier: "standard",
            serviceTiers: [{ id: "standard", name: "Standard", description: "Standard priority" }],
          },
        ],
      }),
    ).toEqual([
      {
        id: "gpt-5.6",
        model: "gpt-5.6",
        displayName: "GPT-5.6",
        description: "Latest model",
        isDefault: true,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "Faster" },
          { reasoningEffort: "medium", description: "Balanced" },
        ],
        defaultServiceTier: "standard",
        serviceTiers: [{ id: "standard", name: "Standard", description: "Standard priority" }],
      },
    ]);
  });

  it("normalizes authoritative app-server thread settings", () => {
    const detail = projectThreadDetail(thread);
    expect(detail).not.toBeNull();
    if (detail === null) return;

    const resumed = applyThreadSettings(detail, {
      model: "gpt-5.6",
      reasoningEffort: "high",
      serviceTier: "fast",
      approvalPolicy: "on-request",
      sandbox: { type: "workspaceWrite" },
    });
    expect(resumed.settings).toEqual({
      model: "gpt-5.6",
      effort: "high",
      serviceTier: "fast",
      runtimeMode: "auto-accept-edits",
      interactionMode: "default",
    });

    expect(
      applyThreadSettings(resumed, {
        model: "gpt-5.5",
        effort: "low",
        serviceTier: null,
        approvalPolicy: "never",
        sandboxPolicy: { type: "dangerFullAccess" },
        collaborationMode: {
          mode: "plan",
          settings: { model: "gpt-5.5", reasoning_effort: "low" },
        },
      }).settings,
    ).toEqual({
      model: "gpt-5.5",
      effort: "low",
      serviceTier: null,
      runtimeMode: "full-access",
      interactionMode: "plan",
    });
  });
});
