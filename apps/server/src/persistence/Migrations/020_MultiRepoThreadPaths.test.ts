import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("020_MultiRepoThreadPaths", (it) => {
  it.effect("registers and backfills thread project path and array-backed git state", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 19 });

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          remote_json,
          git_mode,
          git_repos_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES
          (
            'project-local',
            'Local Project',
            '/tmp/project-local',
            NULL,
            '[]',
            NULL,
            'single',
            NULL,
            '2026-01-01T00:00:00.000Z',
            '2026-01-01T00:00:00.000Z',
            NULL
          ),
          (
            'project-worktree',
            'Worktree Project',
            '/tmp/project-worktree',
            NULL,
            '[]',
            NULL,
            'single',
            NULL,
            '2026-01-01T00:00:00.000Z',
            '2026-01-01T00:00:00.000Z',
            NULL
          )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES
          (
            'thread-local',
            'project-local',
            'Local Thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-01-01T00:00:00.000Z',
            '2026-01-01T00:00:00.000Z',
            NULL
          ),
          (
            'thread-worktree',
            'project-worktree',
            'Worktree Thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            'feature/demo',
            '/tmp/project-worktree/.t3/worktrees/feature-demo',
            NULL,
            '2026-01-01T00:00:00.000Z',
            '2026-01-01T00:00:00.000Z',
            NULL
          )
      `;

      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES
          (
            'event-thread-created-local',
            'thread',
            'thread-local',
            1,
            'thread.created',
            '2026-01-01T00:00:00.000Z',
            'cmd-thread-created-local',
            NULL,
            'cmd-thread-created-local',
            'user',
            '{"threadId":"thread-local","projectId":"project-local","title":"Local Thread","modelSelection":{"provider":"codex","model":"gpt-5-codex"},"runtimeMode":"full-access","interactionMode":"default","branch":null,"worktreePath":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
            '{}'
          ),
          (
            'event-thread-meta-updated-worktree',
            'thread',
            'thread-worktree',
            2,
            'thread.meta-updated',
            '2026-01-01T00:00:00.000Z',
            'cmd-thread-meta-updated-worktree',
            NULL,
            'cmd-thread-meta-updated-worktree',
            'user',
            '{"threadId":"thread-worktree","branch":"feature/demo","worktreePath":"/tmp/project-worktree/.t3/worktrees/feature-demo"}',
            '{}'
          ),
          (
            'event-thread-created-already-migrated',
            'thread',
            'thread-worktree',
            3,
            'thread.created',
            '2026-01-01T00:00:00.000Z',
            'cmd-thread-created-already-migrated',
            NULL,
            'cmd-thread-created-already-migrated',
            'user',
            '{"threadId":"thread-worktree-2","projectId":"project-worktree","title":"Already Migrated Thread","modelSelection":{"provider":"codex","model":"gpt-5-codex"},"runtimeMode":"full-access","interactionMode":"default","projectPath":"/tmp/project-worktree/.t3/worktrees/already-migrated","branch":["feature/already-migrated"],"worktreePath":["/tmp/project-worktree/.t3/worktrees/already-migrated"],"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
            '{}'
          )
      `;

      yield* runMigrations({ toMigrationInclusive: 20 });

      const rows = yield* sql<{
        readonly threadId: string;
        readonly projectPath: string;
        readonly branchJson: string;
        readonly worktreePathJson: string;
      }>`
        SELECT
          thread_id AS "threadId",
          project_path AS "projectPath",
          branch_json AS "branchJson",
          worktree_path_json AS "worktreePathJson"
        FROM projection_threads
        ORDER BY thread_id ASC
      `;

      assert.deepStrictEqual(rows, [
        {
          threadId: "thread-local",
          projectPath: "/tmp/project-local",
          branchJson: "[null]",
          worktreePathJson: "[null]",
        },
        {
          threadId: "thread-worktree",
          projectPath: "/tmp/project-worktree/.t3/worktrees/feature-demo",
          branchJson: '["feature/demo"]',
          worktreePathJson: '["/tmp/project-worktree/.t3/worktrees/feature-demo"]',
        },
      ]);

      const eventRows = yield* sql<{
        readonly eventType: string;
        readonly payloadJson: string;
      }>`
        SELECT
          event_type AS "eventType",
          payload_json AS "payloadJson"
        FROM orchestration_events
        ORDER BY rowid ASC
      `;

      assert.deepStrictEqual(JSON.parse(eventRows[0]!.payloadJson), {
        threadId: "thread-local",
        projectId: "project-local",
        title: "Local Thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        projectPath: "/tmp/project-local",
        branch: [null],
        worktreePath: [null],
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      assert.deepStrictEqual(JSON.parse(eventRows[1]!.payloadJson), {
        threadId: "thread-worktree",
        projectPath: "/tmp/project-worktree/.t3/worktrees/feature-demo",
        branch: ["feature/demo"],
        worktreePath: ["/tmp/project-worktree/.t3/worktrees/feature-demo"],
      });
      assert.deepStrictEqual(JSON.parse(eventRows[2]!.payloadJson), {
        threadId: "thread-worktree-2",
        projectId: "project-worktree",
        title: "Already Migrated Thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        projectPath: "/tmp/project-worktree/.t3/worktrees/already-migrated",
        branch: ["feature/already-migrated"],
        worktreePath: ["/tmp/project-worktree/.t3/worktrees/already-migrated"],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    }),
  );
});
