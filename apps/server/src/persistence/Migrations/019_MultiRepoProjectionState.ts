import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_projects
    ADD COLUMN git_mode TEXT NOT NULL DEFAULT 'none'
  `;

  yield* sql`
    ALTER TABLE projection_projects
    ADD COLUMN git_repos_json TEXT
  `;
});
