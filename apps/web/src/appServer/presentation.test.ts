import { describe, expect, it } from "@effect/vitest";

import {
  appendAgentMessageDelta,
  projectModels,
  projectThreadDetail,
  projectThreadSummary,
  upsertTimelineItem,
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
});
