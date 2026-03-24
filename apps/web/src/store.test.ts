import {
  DEFAULT_MODEL_BY_PROVIDER,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  dismissLocalCodexErrors,
  markThreadUnread,
  reorderProjects,
  syncServerReadModel,
  type AppState,
} from "./store";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "./types";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    model: "gpt-5-codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-02-13T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  };
}

function makeState(thread: Thread): AppState {
  return {
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        name: "Project",
        cwd: "/tmp/project",
        model: "gpt-5-codex",
        expanded: true,
        scripts: [],
      },
    ],
    threads: [thread],
    threadsHydrated: true,
    localCodexErrorsDismissedAfter: null,
  };
}

function makeReadModelThread(overrides: Partial<OrchestrationReadModel["threads"][number]>) {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    model: "gpt-5.3-codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-02-27T00:00:00.000Z",
    updatedAt: "2026-02-27T00:00:00.000Z",
    deletedAt: null,
    messages: [],
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    session: null,
    ...overrides,
  } satisfies OrchestrationReadModel["threads"][number];
}

function makeReadModel(thread: OrchestrationReadModel["threads"][number]): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: "2026-02-27T00:00:00.000Z",
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModel: "gpt-5.3-codex",
        createdAt: "2026-02-27T00:00:00.000Z",
        updatedAt: "2026-02-27T00:00:00.000Z",
        deletedAt: null,
        scripts: [],
      },
    ],
    threads: [thread],
  };
}

function makeReadModelProject(
  overrides: Partial<OrchestrationReadModel["projects"][number]>,
): OrchestrationReadModel["projects"][number] {
  return {
    id: ProjectId.makeUnsafe("project-1"),
    title: "Project",
    workspaceRoot: "/tmp/project",
    defaultModel: "gpt-5.3-codex",
    createdAt: "2026-02-27T00:00:00.000Z",
    updatedAt: "2026-02-27T00:00:00.000Z",
    deletedAt: null,
    scripts: [],
    ...overrides,
  };
}

describe("store pure functions", () => {
  it("markThreadUnread moves lastVisitedAt before completion for a completed thread", () => {
    const latestTurnCompletedAt = "2026-02-25T12:30:00.000Z";
    const initialState = makeState(
      makeThread({
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-1"),
          state: "completed",
          requestedAt: "2026-02-25T12:28:00.000Z",
          startedAt: "2026-02-25T12:28:30.000Z",
          completedAt: latestTurnCompletedAt,
          assistantMessageId: null,
        },
        lastVisitedAt: "2026-02-25T12:35:00.000Z",
      }),
    );

    const next = markThreadUnread(initialState, ThreadId.makeUnsafe("thread-1"));

    const updatedThread = next.threads[0];
    expect(updatedThread).toBeDefined();
    expect(updatedThread?.lastVisitedAt).toBe("2026-02-25T12:29:59.999Z");
    expect(Date.parse(updatedThread?.lastVisitedAt ?? "")).toBeLessThan(
      Date.parse(latestTurnCompletedAt),
    );
  });

  it("markThreadUnread does not change a thread without a completed turn", () => {
    const initialState = makeState(
      makeThread({
        latestTurn: null,
        lastVisitedAt: "2026-02-25T12:35:00.000Z",
      }),
    );

    const next = markThreadUnread(initialState, ThreadId.makeUnsafe("thread-1"));

    expect(next).toEqual(initialState);
  });

  it("reorderProjects moves a project to a target index", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const project3 = ProjectId.makeUnsafe("project-3");
    const state: AppState = {
      projects: [
        {
          id: project1,
          name: "Project 1",
          cwd: "/tmp/project-1",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
        {
          id: project2,
          name: "Project 2",
          cwd: "/tmp/project-2",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
        {
          id: project3,
          name: "Project 3",
          cwd: "/tmp/project-3",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
      ],
      threads: [],
      threadsHydrated: true,
      localCodexErrorsDismissedAfter: null,
    };

    const next = reorderProjects(state, project1, project3);

    expect(next.projects.map((project) => project.id)).toEqual([project2, project3, project1]);
  });

  it("dismissLocalCodexErrors clears only local Codex session errors and records the timestamp", () => {
    const localProjectId = ProjectId.makeUnsafe("project-local");
    const remoteProjectId = ProjectId.makeUnsafe("project-remote");
    const state: AppState = {
      projects: [
        {
          id: localProjectId,
          name: "Local",
          cwd: "/tmp/local",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
        {
          id: remoteProjectId,
          name: "Remote",
          cwd: "/tmp/remote",
          remote: {
            kind: "ssh",
            hostAlias: "buildbox",
          },
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
      ],
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("thread-local"),
          projectId: localProjectId,
          error: "Codex CLI is missing.",
          session: {
            provider: "codex",
            status: "error",
            orchestrationStatus: "error",
            lastError: "Codex CLI is missing.",
            createdAt: "2026-03-16T00:00:00.000Z",
            updatedAt: "2026-03-16T00:00:00.000Z",
          },
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-local-ui"),
          projectId: localProjectId,
          error: "You can attach up to 20 images per message.",
          session: null,
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-remote"),
          projectId: remoteProjectId,
          error: "Remote Codex session failed.",
          session: {
            provider: "codex",
            status: "error",
            orchestrationStatus: "error",
            lastError: "Remote Codex session failed.",
            createdAt: "2026-03-16T00:00:00.000Z",
            updatedAt: "2026-03-16T00:00:00.000Z",
          },
        }),
      ],
      threadsHydrated: true,
      localCodexErrorsDismissedAfter: null,
    };

    const next = dismissLocalCodexErrors(state, "2026-03-17T00:00:00.000Z");

    expect(next.localCodexErrorsDismissedAfter).toBe("2026-03-17T00:00:00.000Z");
    expect(next.threads[0]?.error).toBeNull();
    expect(next.threads[1]?.error).toBe("You can attach up to 20 images per message.");
    expect(next.threads[2]?.error).toBe("Remote Codex session failed.");
  });
});

describe("store read model sync", () => {
  it("maps remote session reconnect metadata from the read model", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "stopped",
          providerName: "codex",
          providerThreadId: "thread_remote_123",
          runtimeMode: DEFAULT_RUNTIME_MODE,
          activeTurnId: null,
          lastError: null,
          resumeAvailable: true,
          reconnectState: "resume-thread",
          reconnectSummary: "Reconnected to provider thread thread_remote_123.",
          reconnectUpdatedAt: "2026-02-27T00:00:00.000Z",
          updatedAt: "2026-02-27T00:00:00.000Z",
        },
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.session).toMatchObject({
      providerThreadId: "thread_remote_123",
      resumeAvailable: true,
      reconnectState: "resume-thread",
      reconnectSummary: "Reconnected to provider thread thread_remote_123.",
      reconnectUpdatedAt: "2026-02-27T00:00:00.000Z",
    });
  });

  it("preserves disconnected orchestration sessions instead of collapsing them to closed", () => {
    const initialState = makeState(makeThread());
    const next = syncServerReadModel(
      initialState,
      makeReadModel(
        makeReadModelThread({
          session: {
            threadId: ThreadId.makeUnsafe("thread-1"),
            status: "disconnected",
            providerName: "codex",
            runtimeMode: DEFAULT_RUNTIME_MODE,
            activeTurnId: null,
            lastError: null,
            updatedAt: "2026-02-27T00:00:00.000Z",
          },
        }),
      ),
    );

    expect(next.threads[0]?.session).toMatchObject({
      status: "disconnected",
      orchestrationStatus: "disconnected",
    });
  });

  it("falls back to the codex default for unsupported provider models without an active session", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        model: "claude-opus-9-preview",
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.model).toBe(DEFAULT_MODEL_BY_PROVIDER.codex);
  });

  it("preserves project and thread updatedAt timestamps from the read model", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        updatedAt: "2026-02-27T00:05:00.000Z",
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.projects[0]?.updatedAt).toBe("2026-02-27T00:00:00.000Z");
    expect(next.threads[0]?.updatedAt).toBe("2026-02-27T00:05:00.000Z");
  });

  it("preserves the current project order when syncing incoming read model updates", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const project3 = ProjectId.makeUnsafe("project-3");
    const initialState: AppState = {
      projects: [
        {
          id: project2,
          name: "Project 2",
          cwd: "/tmp/project-2",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
        {
          id: project1,
          name: "Project 1",
          cwd: "/tmp/project-1",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
      ],
      threads: [],
      threadsHydrated: true,
      localCodexErrorsDismissedAfter: null,
    };
    const readModel: OrchestrationReadModel = {
      snapshotSequence: 2,
      updatedAt: "2026-02-27T00:00:00.000Z",
      projects: [
        makeReadModelProject({
          id: project1,
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
        }),
        makeReadModelProject({
          id: project2,
          title: "Project 2",
          workspaceRoot: "/tmp/project-2",
        }),
        makeReadModelProject({
          id: project3,
          title: "Project 3",
          workspaceRoot: "/tmp/project-3",
        }),
      ],
      threads: [],
    };

    const next = syncServerReadModel(initialState, readModel);

    expect(next.projects.map((project) => project.id)).toEqual([project2, project1, project3]);
  });
});
