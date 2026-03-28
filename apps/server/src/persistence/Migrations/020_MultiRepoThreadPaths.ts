import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN project_path TEXT
  `;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN branch_json TEXT
  `;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN worktree_path_json TEXT
  `;

  yield* sql`
    UPDATE projection_threads
    SET
      project_path = COALESCE(
        worktree_path,
        (
          SELECT workspace_root
          FROM projection_projects
          WHERE projection_projects.project_id = projection_threads.project_id
        ),
        ''
      ),
      branch_json = json_array(branch),
      worktree_path_json = json_array(worktree_path)
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_remove(
      json_set(
        payload_json,
        '$.projectPath',
        CASE
          WHEN json_type(payload_json, '$.projectPath') IS NULL
          THEN COALESCE(
            json_extract(payload_json, '$.worktreePath'),
            (
              SELECT workspace_root
              FROM projection_projects
              WHERE projection_projects.project_id = json_extract(payload_json, '$.projectId')
            ),
            ''
          )
          ELSE json_extract(payload_json, '$.projectPath')
        END,
        '$.branch',
        CASE
          WHEN json_type(payload_json, '$.branch') = 'array'
          THEN json(json_extract(payload_json, '$.branch'))
          ELSE json(json_array(json_extract(payload_json, '$.branch')))
        END,
        '$.worktreePath',
        CASE
          WHEN json_type(payload_json, '$.worktreePath') = 'array'
          THEN json(json_extract(payload_json, '$.worktreePath'))
          ELSE json(json_array(json_extract(payload_json, '$.worktreePath')))
        END
      ),
      '$.updatedAt'
    )
    WHERE event_type = 'thread.created'
      AND json_type(payload_json, '$.projectPath') IS NULL
      AND (
        json_type(payload_json, '$.branch') IS NULL
        OR json_type(payload_json, '$.branch') != 'array'
      )
      AND (
        json_type(payload_json, '$.worktreePath') IS NULL
        OR json_type(payload_json, '$.worktreePath') != 'array'
      )
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(
      payload_json,
      '$.projectPath',
      COALESCE(
        json_extract(payload_json, '$.projectPath'),
        json_extract(payload_json, '$.worktreePath'),
        (
          SELECT workspace_root
          FROM projection_projects
          WHERE projection_projects.project_id = json_extract(payload_json, '$.projectId')
        )
      ),
      '$.branch',
      CASE
        WHEN json_type(payload_json, '$.branch') = 'array'
        THEN json(json_extract(payload_json, '$.branch'))
        WHEN json_type(payload_json, '$.branch') IS NULL
        THEN json('null')
        ELSE json(json_array(json_extract(payload_json, '$.branch')))
      END,
      '$.worktreePath',
      CASE
        WHEN json_type(payload_json, '$.worktreePath') = 'array'
        THEN json(json_extract(payload_json, '$.worktreePath'))
        WHEN json_type(payload_json, '$.worktreePath') IS NULL
        THEN json('null')
        ELSE json(json_array(json_extract(payload_json, '$.worktreePath')))
      END
    )
    WHERE event_type = 'thread.meta-updated'
      AND (
        (json_type(payload_json, '$.branch') IS NOT NULL AND json_type(payload_json, '$.branch') != 'array')
        OR (
          json_type(payload_json, '$.worktreePath') IS NOT NULL
          AND json_type(payload_json, '$.worktreePath') != 'array'
        )
        OR (
          json_type(payload_json, '$.projectPath') IS NULL
          AND (
            json_type(payload_json, '$.branch') IS NOT NULL
            OR json_type(payload_json, '$.worktreePath') IS NOT NULL
          )
        )
      )
  `;
});
