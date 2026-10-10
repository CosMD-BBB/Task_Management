import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import pg from 'pg';
import { openDatabase } from './database.js';

async function sqliteFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'room-migration-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'workspace.sqlite');
}

test('a recorded migration preserves data without rewriting projects at every startup', async (t) => {
  const databasePath = await sqliteFixture(t);
  let db = await openDatabase({ databasePath, databaseUrl: '' });
  t.after(() => db?.close());
  const now = new Date().toISOString();
  await db.run('INSERT INTO users (id, name, email, password_hash, avatar_color, created_at) VALUES (?, ?, ?, ?, ?, ?)', ['owner', 'Owner', 'owner@example.invalid', 'hash', '#f97316', now]);
  await db.run('INSERT INTO projects (id, name, description, color, owner_id, fields_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', ['project', 'Saved room', '', '#f97316', 'owner', '[]', now]);
  await db.run('CREATE TABLE migration_rewrites (project_id TEXT)');
  await db.run('CREATE TRIGGER detect_project_rewrites AFTER UPDATE ON projects BEGIN INSERT INTO migration_rewrites VALUES (NEW.id); END');
  await db.close();
  db = await openDatabase({ databasePath, databaseUrl: '' });
  assert.equal((await db.get('SELECT COUNT(*) AS count FROM schema_migrations')).count, 1);
  assert.equal((await db.get('SELECT name FROM projects WHERE id = ?', ['project'])).name, 'Saved room');
  assert.equal((await db.get('SELECT COUNT(*) AS count FROM migration_rewrites')).count, 0);
});

test('a failed data migration rolls back schema changes and can be retried after repair', async (t) => {
  const databasePath = await sqliteFixture(t);
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, avatar_color TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, color TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), fields_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO users VALUES ('owner', 'Owner', 'owner@example.invalid', 'preserved-hash', '#f97316', '2026-01-01');
    INSERT INTO projects VALUES ('project', 'Legacy room', '', '#f97316', 'owner', '[]', '2026-01-01');
    INSERT INTO tasks VALUES ('task', 'project', 'invalid-json', '2026-01-01', '2026-01-01');
  `);
  legacy.close();
  await assert.rejects(openDatabase({ databasePath, databaseUrl: '' }), SyntaxError);
  const repaired = new DatabaseSync(databasePath);
  assert.equal(repaired.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'schema_migrations'").get().count, 0);
  assert.equal(repaired.prepare('PRAGMA table_info(users)').all().length, 6);
  repaired.prepare('UPDATE tasks SET data_json = ?').run(JSON.stringify({ id: 'task', title: 'Saved task', contentType: 'VDO', channel: 'TikTok' }));
  repaired.close();
  const db = await openDatabase({ databasePath, databaseUrl: '' });
  t.after(() => db.close());
  assert.equal((await db.get('SELECT password_hash FROM users WHERE id = ?', ['owner'])).password_hash, 'preserved-hash');
  assert.deepEqual(JSON.parse((await db.get('SELECT data_json FROM tasks WHERE id = ?', ['task'])).data_json).contentTypes, ['VDO']);
  assert.equal((await db.get('SELECT COUNT(*) AS count FROM schema_migrations')).count, 1);
});

test('PostgreSQL concurrent initialization commits one migration and releases transaction locks', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const schema = `room_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const databases = [];
  t.after(async () => {
    await Promise.all(databases.map((db) => db.close()));
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options', `${url.searchParams.get('options') ?? ''} -c search_path=${schema}`.trim());
  await Promise.all(Array.from({ length: 4 }, async () => {
    const db = await openDatabase({ databaseUrl: url.href });
    databases.push(db);
  }));
  const [db] = databases;
  assert.equal(Number((await db.get('SELECT COUNT(*) AS count FROM schema_migrations')).count), 1);
  assert.equal(Number((await admin.query("SELECT COUNT(*) AS count FROM pg_locks WHERE locktype = 'advisory' AND objid = 814721900 AND database = (SELECT oid FROM pg_database WHERE datname = current_database())")).rows[0].count), 0);
  await assert.rejects(db.transaction(async (tx) => {
    await tx.run('INSERT INTO users (id, name, email, password_hash, avatar_color, created_at) VALUES (?, ?, ?, ?, ?, ?)', ['rolled-back', 'Transient', 'transient@example.invalid', 'hash', '#f97316', new Date().toISOString()]);
    throw new Error('Deliberate rollback');
  }), /Deliberate rollback/);
  assert.equal(await db.get('SELECT id FROM users WHERE id = ?', ['rolled-back']), undefined);
});

test('PostgreSQL upgrades legacy data atomically and skips data rewrites after the version is recorded', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const schema = `room_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let db;
  let legacy;
  t.after(async () => {
    await db?.close();
    await legacy?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options', `${url.searchParams.get('options') ?? ''} -c search_path=${schema}`.trim());
  legacy = new pg.Pool({ connectionString: url.href });
  await legacy.query(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, avatar_color TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, color TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), fields_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO users VALUES ('owner', 'Owner', 'owner@example.invalid', 'preserved-hash', '#f97316', '2026-01-01');
    INSERT INTO projects VALUES ('project', 'Legacy room', '', '#f97316', 'owner', '[]', '2026-01-01');
    INSERT INTO tasks VALUES ('task', 'project', 'invalid-json', '2026-01-01', '2026-01-01');
  `);
  await assert.rejects(openDatabase({ databaseUrl: url.href }), SyntaxError);
  assert.equal((await legacy.query('SELECT to_regclass($1) AS relation', [`${schema}.schema_migrations`])).rows[0].relation, null);
  assert.equal((await legacy.query("SELECT COUNT(*)::integer AS count FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'users'", [schema])).rows[0].count, 6);
  await legacy.query('UPDATE tasks SET data_json = $1', [JSON.stringify({ id: 'task', title: 'Saved task', contentType: 'VDO', channel: 'TikTok' })]);
  db = await openDatabase({ databaseUrl: url.href });
  assert.equal((await db.get('SELECT password_hash FROM users WHERE id = ?', ['owner'])).password_hash, 'preserved-hash');
  assert.deepEqual(JSON.parse((await db.get('SELECT data_json FROM tasks WHERE id = ?', ['task'])).data_json).contentTypes, ['VDO']);
  await legacy.query(`
    CREATE TABLE migration_rewrites (project_id TEXT);
    CREATE FUNCTION detect_project_rewrites() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO migration_rewrites VALUES (NEW.id); RETURN NEW; END; $$;
    CREATE TRIGGER detect_project_rewrites AFTER UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION detect_project_rewrites();
  `);
  await db.close();
  db = undefined;
  db = await openDatabase({ databaseUrl: url.href });
  assert.equal(Number((await db.get('SELECT COUNT(*) AS count FROM migration_rewrites')).count), 0);
  assert.equal(Number((await db.get('SELECT COUNT(*) AS count FROM schema_migrations')).count), 1);
});
