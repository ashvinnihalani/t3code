import type { Migration } from "@effect/sql/SqlSchema/Migrator";

const migration: Migration = {
  id: 16,
  name: "016_projection_threads_workspace_path_and_repo_states",
  up: `
    ALTER TABLE projection_threads
    ADD COLUMN workspace_path TEXT;

    ALTER TABLE projection_threads
    ADD COLUMN repo_states_json TEXT NOT NULL DEFAULT '[]';
  `,
  down: `
    SELECT 1;
  `,
};

export default migration;
