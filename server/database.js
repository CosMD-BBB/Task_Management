import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { migrateDomainData } from './domain.js';

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_color TEXT NOT NULL,
  created_at TEXT NOT NULL,
  global_role TEXT NOT NULL DEFAULT 'member',
  email_verified INTEGER NOT NULL DEFAULT 0,
  email_verified_mode TEXT NOT NULL DEFAULT '',
  disabled_at TEXT,
  demo_scope_id TEXT
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
  created_at TEXT NOT NULL,
  cover_image TEXT,
  content_type_options_json TEXT NOT NULL DEFAULT '[]',
  channel_options_json TEXT NOT NULL DEFAULT '[]'
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
CREATE TABLE IF NOT EXISTS task_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  author_avatar_color TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'caption', 'revision')),
  mentions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS task_comments_task ON task_comments(task_id, created_at);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  comment_id TEXT REFERENCES task_comments(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at);
CREATE TABLE IF NOT EXISTS account_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  issued_mode TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_outbox (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target_user_id TEXT,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

const additiveColumns = {
  users: {
    global_role: "TEXT NOT NULL DEFAULT 'member'", email_verified: 'INTEGER NOT NULL DEFAULT 0',
    email_verified_mode: "TEXT NOT NULL DEFAULT ''",
    disabled_at: 'TEXT', demo_scope_id: 'TEXT',
  },
  projects: {
    cover_image: 'TEXT', content_type_options_json: "TEXT NOT NULL DEFAULT '[]'", channel_options_json: "TEXT NOT NULL DEFAULT '[]'",
  },
  account_tokens: { issued_mode: "TEXT NOT NULL DEFAULT ''" },
  notifications: { comment_id: 'TEXT REFERENCES task_comments(id) ON DELETE CASCADE' },
};
const commentNotificationIndex = 'CREATE UNIQUE INDEX IF NOT EXISTS notifications_comment_user ON notifications(comment_id, user_id) WHERE comment_id IS NOT NULL';

// Add a new version when a future release needs schema or stored-data changes.
// The marker and its changes commit together, so a failed migration can be retried.
async function migrateDatabase(db, executeSchema) {
  await db.transaction(async (tx) => {
    if (tx.kind === 'postgres') await tx.run('SELECT pg_advisory_xact_lock(814721900)');
    await tx.run('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    if (await tx.get('SELECT version FROM schema_migrations WHERE version = ?', [1])) return;
    // Match the application mutation lock before touching application tables.
    if (tx.kind === 'postgres') await tx.run('SELECT pg_advisory_xact_lock(814721901)');
    await executeSchema(tx);
    for (const [table, columns] of Object.entries(additiveColumns)) {
      const existing = tx.kind === 'sqlite'
        ? new Set((await tx.all(`PRAGMA table_info(${table})`)).map((column) => column.name))
        : undefined;
      for (const [column, definition] of Object.entries(columns)) {
        if (existing?.has(column)) continue;
        await tx.run(`ALTER TABLE ${table} ADD COLUMN ${tx.kind === 'postgres' ? 'IF NOT EXISTS ' : ''}${column} ${definition}`);
      }
    }
    await tx.run(commentNotificationIndex);
    await migrateDomainData({ ...tx, transaction: (callback) => callback(tx) });
    await tx.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [1, new Date().toISOString()]);
  });
}

/** One query interface keeps local SQLite and deployed PostgreSQL behavior alike. */
export async function openDatabase({ databasePath, databaseUrl } = {}) {
  const connectionString = databaseUrl ?? process.env.DATABASE_URL;
  if (connectionString) {
    const { Pool } = await import('pg');
    // The provider's connection URL controls TLS; do not disable certificate checks.
    const max = Number(process.env.DATABASE_POOL_MAX ?? 3);
    if (!Number.isInteger(max) || max < 1 || max > 10) throw Object.assign(new Error('DATABASE_POOL_MAX must be an integer from 1 to 10.'), { code: 'DATABASE_POOL_INVALID' });
    const pool = new Pool({
      connectionString, max, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000, query_timeout: 15000, allowExitOnIdle: true,
    });
    // Idle connections can fail after a provider restart; do not crash the worker.
    pool.on('error', () => console.error('An idle PostgreSQL connection became unavailable.'));
    const query = (sql, values = []) => {
      let index = 0;
      return pool.query(sql.replace(/\?/g, () => `$${++index}`), values);
    };
    const db = {
      kind: 'postgres',
      async get(sql, values) { return (await query(sql, values)).rows[0]; },
      async all(sql, values) { return (await query(sql, values)).rows; },
      async run(sql, values) { return query(sql, values); },
      async transaction(callback) {
        const client = await pool.connect();
        let releaseError;
        const scopedQuery = (sql, values = []) => {
          let index = 0;
          return client.query(sql.replace(/\?/g, () => `$${++index}`), values);
        };
        const tx = {
          kind: 'postgres',
          async get(sql, values) { return (await scopedQuery(sql, values)).rows[0]; },
          async all(sql, values) { return (await scopedQuery(sql, values)).rows; },
          async run(sql, values) { return scopedQuery(sql, values); },
        };
        try {
          await client.query('BEGIN');
          // Transaction-local settings also work with transaction-pooling providers.
          await client.query("SET LOCAL statement_timeout = '12s'");
          await client.query("SET LOCAL lock_timeout = '5s'");
          const result = await callback(tx);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          try { await client.query('ROLLBACK'); }
          catch (rollbackError) { releaseError = rollbackError; }
          throw error;
        } finally { client.release(releaseError); }
      },
      async close() { await pool.end(); },
    };
    try { await migrateDatabase(db, (tx) => tx.run(schema)); }
    catch (error) { await db.close(); throw error; }
    return db;
  }
  if (process.env.VERCEL) {
    throw Object.assign(new Error('DATABASE_URL is required on Vercel. Connect a PostgreSQL database before deploying.'), { code: 'DATABASE_URL_REQUIRED' });
  }
  const path = databasePath ?? process.env.SQLITE_PATH ?? resolve('.data/workspace.sqlite');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  let pending = Promise.resolve();
  const schedule = (callback) => {
    const result = pending.then(callback);
    pending = result.catch(() => {});
    return result;
  };
  const tx = {
    kind: 'sqlite',
    async get(sql, values = []) { return sqlite.prepare(sql).get(...values); },
    async all(sql, values = []) { return sqlite.prepare(sql).all(...values); },
    async run(sql, values = []) { return sqlite.prepare(sql).run(...values); },
  };
  const db = {
    kind: 'sqlite',
    get: (sql, values) => schedule(() => tx.get(sql, values)),
    all: (sql, values) => schedule(() => tx.all(sql, values)),
    run: (sql, values) => schedule(() => tx.run(sql, values)),
    transaction: (callback) => schedule(async () => {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = await callback(tx);
        sqlite.exec('COMMIT');
        return result;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }),
    close: () => schedule(() => sqlite.close()),
  };
  try { await migrateDatabase(db, () => sqlite.exec(schema)); }
  catch (error) { await db.close(); throw error; }
  return db;
}
