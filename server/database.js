import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_color TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  color TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fields_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id);
`;

/** One query interface keeps local SQLite and deployed PostgreSQL behavior alike. */
export async function openDatabase({ databasePath, databaseUrl } = {}) {
  const connectionString = databaseUrl ?? process.env.DATABASE_URL;
  if (connectionString) {
    const { Pool } = await import('pg');
    // The provider's connection URL controls TLS; do not disable certificate checks.
    const pool = new Pool({ connectionString, max: 5 });
    const query = (sql, values = []) => {
      let index = 0;
      return pool.query(sql.replace(/\?/g, () => `$${++index}`), values);
    };
    const migrationClient = await pool.connect();
    try {
      // Serverless instances can start together; serialize the initial schema migration.
      await migrationClient.query('SELECT pg_advisory_lock(814721900)');
      await migrationClient.query(schema);
    } catch (error) {
      // Discard this client so a failed initialization cannot retain a session lock.
      migrationClient.release(true);
      await pool.end();
      throw error;
    }
    await migrationClient.query('SELECT pg_advisory_unlock(814721900)');
    migrationClient.release();
    return {
      kind: 'postgres',
      async get(sql, values) { return (await query(sql, values)).rows[0]; },
      async all(sql, values) { return (await query(sql, values)).rows; },
      async run(sql, values) { return query(sql, values); },
      async close() { await pool.end(); },
    };
  }
  if (process.env.VERCEL) {
    throw new Error('DATABASE_URL is required on Vercel. Connect a PostgreSQL database before deploying.');
  }
  const path = databasePath ?? process.env.SQLITE_PATH ?? resolve('.data/workspace.sqlite');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  sqlite.exec(schema);
  return {
    kind: 'sqlite',
    async get(sql, values = []) { return sqlite.prepare(sql).get(...values); },
    async all(sql, values = []) { return sqlite.prepare(sql).all(...values); },
    async run(sql, values = []) { return sqlite.prepare(sql).run(...values); },
    async close() { sqlite.close(); },
  };
}
