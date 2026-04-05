import fs from "node:fs";
import path from "node:path";

import {
  ApprovalRequestId,
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProjectId,
  ThreadId,
  type ProviderStartOptions,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";

import {
  makeOrchestrationIntegrationHarness,
  type OrchestrationIntegrationHarness,
} from "./OrchestrationEngineHarness.integration.ts";

const PROJECT_ID = ProjectId.makeUnsafe("project-kiro-approval-probe");
const THREAD_ID = ThreadId.makeUnsafe("thread-kiro-approval-probe");
const KIRO_PROVIDER = "kiro" as const;
const RUN_LIVE_KIRO_APPROVAL_TESTS = process.env.RUN_LIVE_KIRO_APPROVAL_TESTS === "1";
const KIRO_BINARY_PATH = process.env.KIRO_BINARY_PATH ?? "kiro-cli";

type ApprovalProbe = {
  readonly label: string;
  readonly agentTool: string;
  readonly expectApproval: boolean;
  readonly goal: string;
};

const TOOL_APPROVAL_PROBES: ReadonlyArray<ApprovalProbe> = [
  {
    label: "code",
    agentTool: "code",
    expectApproval: false,
    goal: "Use the code tool to inspect this workspace for the symbol or text 'README'.",
  },
  {
    label: "glob",
    agentTool: "glob",
    expectApproval: false,
    goal: "Use glob to list a few files matching **/*.test.ts in this workspace.",
  },
  {
    label: "grep",
    agentTool: "grep",
    expectApproval: false,
    goal: "Use grep to search this workspace for the pattern approval.requested.",
  },
  {
    label: "introspect",
    agentTool: "introspect",
    expectApproval: false,
    goal: "Use introspect to answer how Kiro CLI saves conversations.",
  },
  {
    label: "knowledge",
    agentTool: "knowledge",
    expectApproval: true,
    goal: "Use the knowledge tool to create or query a tiny temporary knowledge base entry named approval-probe.",
  },
  {
    label: "read",
    agentTool: "read",
    expectApproval: false,
    goal: "Use read to inspect README.md and report the first line.",
  },
  {
    label: "shell",
    agentTool: "shell",
    expectApproval: true,
    goal: "Use shell to run the smallest safe read-only command possible, such as pwd.",
  },
  {
    label: "subagent",
    agentTool: "subagent",
    expectApproval: true,
    goal: "Use subagent to delegate one tiny workspace-inspection task.",
  },
  {
    label: "todo_list",
    agentTool: "todo",
    expectApproval: true,
    goal: "Use the todo tool to create a single todo item named approval probe.",
  },
  {
    label: "use_aws",
    agentTool: "aws",
    expectApproval: true,
    goal: "Use aws to run a minimal read-only AWS CLI operation such as sts get-caller-identity.",
  },
  {
    label: "web_fetch",
    agentTool: "web_fetch",
    expectApproval: true,
    goal: "Use web_fetch to retrieve https://example.com and summarize the title.",
  },
  {
    label: "web_search",
    agentTool: "web_search",
    expectApproval: true,
    goal: "Use web_search to search for Kiro CLI ACP.",
  },
  {
    label: "write",
    agentTool: "write",
    expectApproval: true,
    goal: "Use write to create a file named .kiro-approval-probe.txt with the text probe.",
  },
] as const;

function withRealKiroHarness<A, E>(
  use: (harness: OrchestrationIntegrationHarness) => Effect.Effect<A, E>,
) {
  return Effect.acquireUseRelease(
    makeOrchestrationIntegrationHarness({ provider: KIRO_PROVIDER, realProvider: KIRO_PROVIDER }),
    use,
    (harness) => harness.dispose,
  ).pipe(Effect.provide(NodeServices.layer));
}

function nowIso() {
  return new Date().toISOString();
}

function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function sanitizeProbeLabel(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
}

function buildProbeAgentConfig(probe: ApprovalProbe) {
  return {
    // Override Kiro's default interaction mode for this isolated workspace so
    // the production session/set_mode flow stays on the one-tool probe agent.
    name: "kiro_default",
    description: `ACP approval surfacing probe for ${probe.label}`,
    includeMcpJson: true,
    tools: [probe.agentTool],
    ...(probe.expectApproval ? {} : { allowedTools: [probe.agentTool] }),
    prompt: [
      `You are a deterministic ACP approval probe for the ${probe.label} tool.`,
      "You have exactly one tool available through your agent configuration.",
      "When the user asks you to run the probe, you must invoke that tool immediately.",
      "Do not answer from memory and do not say the tool is unavailable unless the runtime truly refuses it.",
      probe.goal,
      "If the tool requires approval, request it and wait.",
    ].join(" "),
  };
}

function writeProbeAgentFiles(
  workspaceDir: string,
  probe: ApprovalProbe,
): {
  readonly wrapperPath: string;
} {
  const agentDir = path.join(workspaceDir, ".kiro", "agents");
  fs.mkdirSync(agentDir, { recursive: true });

  const agentConfig = buildProbeAgentConfig(probe);
  const agentFileName = `${agentConfig.name}.json`;
  fs.writeFileSync(path.join(agentDir, agentFileName), JSON.stringify(agentConfig, null, 2));

  const wrapperPath = path.join(agentDir, `${agentConfig.name}-launcher.sh`);
  fs.writeFileSync(
    wrapperPath,
    [
      "#!/bin/sh",
      `exec ${shQuote(KIRO_BINARY_PATH)} "$@" --agent ${shQuote(agentConfig.name)}`,
      "",
    ].join("\n"),
  );
  fs.chmodSync(wrapperPath, 0o755);

  return { wrapperPath };
}

const seedProjectAndThread = (harness: OrchestrationIntegrationHarness) =>
  Effect.gen(function* () {
    const createdAt = nowIso();
    yield* harness.engine.dispatch({
      type: "project.create",
      commandId: CommandId.makeUnsafe("cmd-kiro-project-create"),
      projectId: PROJECT_ID,
      title: "Kiro Approval Probe Project",
      workspaceRoot: harness.workspaceDir,
      defaultModelSelection: {
        provider: KIRO_PROVIDER,
        model: DEFAULT_MODEL_BY_PROVIDER[KIRO_PROVIDER],
      },
      createdAt,
    });

    yield* harness.engine.dispatch({
      type: "thread.create",
      commandId: CommandId.makeUnsafe("cmd-kiro-thread-create"),
      threadId: THREAD_ID,
      projectId: PROJECT_ID,
      title: "Kiro Approval Probe Thread",
      modelSelection: {
        provider: KIRO_PROVIDER,
        model: DEFAULT_MODEL_BY_PROVIDER[KIRO_PROVIDER],
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required",
      projectPath: harness.workspaceDir,
      branch: [null],
      worktreePath: [null],
      createdAt,
    });
  });

const startProbeTurn = (input: {
  readonly harness: OrchestrationIntegrationHarness;
  readonly probe: ApprovalProbe;
  readonly providerOptions: ProviderStartOptions;
}) =>
  input.harness.engine.dispatch({
    type: "thread.turn.start",
    commandId: CommandId.makeUnsafe(`cmd-turn-start-${sanitizeProbeLabel(input.probe.label)}`),
    threadId: THREAD_ID,
    message: {
      messageId: MessageId.makeUnsafe(`msg-${sanitizeProbeLabel(input.probe.label)}`),
      role: "user",
      text: "Run the approval surfacing probe now.",
      attachments: [],
    },
    providerOptions: input.providerOptions,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "approval-required",
    createdAt: nowIso(),
  });

const waitForActiveTurnId = (harness: OrchestrationIntegrationHarness) =>
  harness
    .waitForThread(
      THREAD_ID,
      (thread) => thread.latestTurn !== null && thread.latestTurn.startedAt !== null,
      30_000,
    )
    .pipe(
      Effect.map((thread) => {
        const turnId = thread.latestTurn?.turnId;
        if (!turnId) {
          throw new Error("Expected projected thread to have an active turn.");
        }
        return turnId;
      }),
    );

const runProbeAndAssert = (probe: ApprovalProbe) =>
  withRealKiroHarness((harness) =>
    Effect.gen(function* () {
      yield* seedProjectAndThread(harness);
      const { wrapperPath } = writeProbeAgentFiles(harness.workspaceDir, probe);

      yield* startProbeTurn({
        harness,
        probe,
        providerOptions: {
          kiro: {
            binaryPath: wrapperPath,
          },
        },
      });

      const turnId = yield* waitForActiveTurnId(harness);

      if (probe.expectApproval) {
        const threadAfterApprovalWindow = yield* harness.waitForThread(
          THREAD_ID,
          (thread) =>
            thread.latestTurn?.turnId === turnId &&
            (thread.activities.some(
              (activity) => activity.turnId === turnId && activity.kind === "approval.requested",
            ) ||
              thread.latestTurn.completedAt !== null),
          30_000,
        );
        const approvalActivity = threadAfterApprovalWindow.activities.find(
          (activity) => activity.turnId === turnId && activity.kind === "approval.requested",
        );
        if (approvalActivity === undefined) {
          throw new Error(
            `Expected an approval request for ${probe.label}, but the turn completed without surfacing one.`,
          );
        }

        const payload =
          approvalActivity?.payload && typeof approvalActivity.payload === "object"
            ? (approvalActivity.payload as Record<string, unknown>)
            : null;
        const requestId =
          payload && typeof payload.requestId === "string"
            ? ApprovalRequestId.makeUnsafe(payload.requestId)
            : null;
        assert.ok(requestId !== null);

        yield* harness.waitForPendingApproval(
          String(requestId),
          (row) => row.status === "pending",
          30_000,
        );

        yield* harness.engine.dispatch({
          type: "thread.approval.respond",
          commandId: CommandId.makeUnsafe(`cmd-approval-cancel-${sanitizeProbeLabel(probe.label)}`),
          threadId: THREAD_ID,
          requestId: requestId!,
          decision: "cancel",
          createdAt: nowIso(),
        });

        yield* harness.waitForPendingApproval(
          String(requestId),
          (row) => row.status === "resolved" && row.decision === "cancel",
          30_000,
        );
        return;
      }

      const threadWithToolActivity = yield* harness.waitForThread(
        THREAD_ID,
        (thread) =>
          thread.latestTurn?.turnId === turnId &&
          (thread.activities.some(
            (activity) => activity.turnId === turnId && activity.kind === "approval.requested",
          ) ||
            thread.activities.some(
              (activity) =>
                activity.turnId === turnId &&
                (activity.kind === "tool.started" || activity.kind === "tool.completed"),
            ) ||
            thread.latestTurn.completedAt !== null),
        30_000,
      );

      if (
        threadWithToolActivity.activities.some(
          (activity) => activity.turnId === turnId && activity.kind === "approval.requested",
        )
      ) {
        throw new Error(
          `Expected ${probe.label} to run without approval, but an approval request was surfaced.`,
        );
      }

      if (
        !threadWithToolActivity.activities.some(
          (activity) =>
            activity.turnId === turnId &&
            (activity.kind === "tool.started" || activity.kind === "tool.completed"),
        )
      ) {
        throw new Error(`Expected ${probe.label} to produce tool activity, but none was observed.`);
      }

      yield* harness.waitForThread(
        THREAD_ID,
        (thread) =>
          thread.latestTurn?.turnId === turnId &&
          thread.latestTurn.completedAt !== null &&
          thread.session?.status === "ready",
        30_000,
      );
    }),
  );

for (const probe of TOOL_APPROVAL_PROBES) {
  it.live.skipIf(!RUN_LIVE_KIRO_APPROVAL_TESTS)(
    `surfaces Kiro ACP approval state correctly for ${probe.label}`,
    () => runProbeAndAssert(probe),
    180_000,
  );
}
