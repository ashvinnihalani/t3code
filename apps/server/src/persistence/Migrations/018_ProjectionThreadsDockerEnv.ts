import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN env_mode TEXT NOT NULL DEFAULT 'local'
  `;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN docker_sandbox_json TEXT
  `;

  yield* sql`
    UPDATE projection_threads
    SET env_mode = CASE
      WHEN worktree_path IS NOT NULL THEN 'worktree'
      ELSE 'local'
    END
    WHERE env_mode IS NULL OR trim(env_mode) = ''
  `;
});
