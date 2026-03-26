import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_projects
    ADD COLUMN git_repos_json TEXT NOT NULL DEFAULT '[]'
  `;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN repo_branches_json TEXT NOT NULL DEFAULT '[]'
  `;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN multi_repo_worktree_json TEXT
  `;
});
