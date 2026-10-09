import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import { createApp } from './app.js';
import { openDatabase } from './database.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';

async function startServer(databasePath, options = {}) {
  const app = await createApp({ databasePath, databaseUrl: '', mailMode: 'preview', disableRateLimit: true, distPath: '/nonexistent-test-dist', ...options });
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  return {
    app,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
      await app.locals.close();
    },
    client(cookie = '') {
      return {
        cookie,
        async request(path, method = 'GET', body) {
          const response = await fetch(`${baseUrl}${path}`, {
            method, headers: {
              ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
              ...(this.cookie ? { Cookie: this.cookie } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          const setCookie = response.headers.getSetCookie()[0];
          if (setCookie) this.cookie = setCookie.split(';')[0];
          return { response, data: response.status === 204 ? null : await response.json() };
        },
      };
    },
  };
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'teamflow-domain-test-'));
  const databasePath = join(directory, 'test.sqlite');
  const server = await startServer(databasePath, options);
  t.after(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { ...server, databasePath };
}

async function request(client, path, method = 'GET', body, status = 200) {
  const result = await client.request(path, method, body);
  assert.equal(result.response.status, status, `${method} ${path}: ${JSON.stringify(result.data)}`);
  return result.data;
}

async function demo(server) {
  const client = server.client();
  client.user = (await request(client, '/api/auth/demo', 'POST', undefined, 201)).user;
  const projects = (await request(client, '/api/projects')).projects;
  return { client, project: projects.find((project) => project.name === 'Regagar') };
}

async function asUser(server, userId) {
  const token = randomBytes(32).toString('hex');
  await server.app.locals.db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [
    createHash('sha256').update(token).digest('hex'), userId, new Date(Date.now() + 3_600_000).toISOString(),
  ]);
  return server.client(`teamflow_session=${token}`);
}

async function verifiedAccount(server, email) {
  const client = server.client();
  await request(client, '/api/auth/register', 'POST', { name: email.split('@')[0], email, password: 'test-password-123' }, 201);
  const mail = (await request(client, '/api/auth/mail-preview')).messages.findLast((entry) => entry.kind === 'verify');
  assert.ok(mail);
  client.user = (await request(client, '/api/auth/verify-email', 'POST', { token: new URL(mail.actionUrl).searchParams.get('token') })).user;
  return client;
}

async function addTask(client, project, input) {
  return (await request(client, `/api/projects/${project.id}/tasks`, 'POST', { title: 'Domain test task', ...input }, 201)).task;
}

test('multiple assignees and tags normalize duplicates and retain first-value legacy aliases', async (t) => {
  const server = await fixture(t);
  const { client, project } = await demo(server);
  const member = project.members.find((entry) => entry.userId !== client.user.id);
  const task = await addTask(client, project, {
    assigneeIds: [client.user.id, member.userId, member.userId], assigneeId: member.userId,
    contentTypes: ['  VDO  ', 'vdo', 'Infographic'], contentType: 'Ignored singular',
    channels: ['Facebook', ' facebook ', 'TikTok'], channel: 'Ignored singular',
  });
  assert.deepEqual(task.assigneeIds, [client.user.id, member.userId]);
  assert.equal(task.assigneeId, client.user.id);
  assert.equal(task.contentTypes.length, 2);
  assert.equal(task.contentTypes[0], 'VDO');
  assert.equal(task.contentType, task.contentTypes[0]);
  assert.deepEqual(task.channels, ['Facebook', 'TikTok']);
  assert.equal(task.channel, 'Facebook');
  const empty = await addTask(client, project, {
    assigneeIds: [], assigneeId: member.userId, contentTypes: [], contentType: 'Ignored', channels: [], channel: 'Ignored',
  });
  assert.deepEqual(empty.assigneeIds, []);
  assert.equal(empty.assigneeId, null);
  assert.deepEqual(empty.contentTypes, []);
  assert.equal(empty.contentType, '');
  assert.deepEqual(empty.channels, []);
  assert.equal(empty.channel, '');
});

test('partial updates preserve arrays and legacy singular changes intentionally replace them', async (t) => {
  const server = await fixture(t);
  const { client, project } = await demo(server);
  const teammates = project.members.filter((entry) => entry.userId !== client.user.id);
  const task = await addTask(client, project, {
    assigneeIds: [client.user.id, teammates[0].userId], contentTypes: ['VDO', 'Infographic'],
    channels: ['TikTok', 'Facebook'], dueDate: '2026-12-20',
  });
  const patch = (await request(client, `/api/tasks/${task.id}`, 'PATCH', { status: 'in_progress' })).task;
  for (const field of ['assigneeIds', 'assigneeId', 'contentTypes', 'contentType', 'channels', 'channel', 'dueDate']) {
    assert.deepEqual(patch[field], task[field], `${field} must survive an unrelated patch`);
  }
  const legacy = (await request(client, `/api/tasks/${task.id}`, 'PATCH', {
    assigneeId: teammates[1].userId, contentType: 'Photo album', channel: 'Instagram',
  })).task;
  assert.deepEqual(legacy.assigneeIds, [teammates[1].userId]);
  assert.deepEqual(legacy.contentTypes, ['Photo album']);
  assert.deepEqual(legacy.channels, ['Instagram']);
  const cleared = (await request(client, `/api/tasks/${task.id}`, 'PATCH', { assigneeId: null, contentType: '', channel: '' })).task;
  assert.deepEqual(cleared.assigneeIds, []);
  assert.deepEqual(cleared.contentTypes, []);
  assert.deepEqual(cleared.channels, []);
  assert.equal(cleared.dueDate, task.dueDate);
});

test('subtasks added through a task PATCH receive stable unique IDs in the saved result', async (t) => {
  const server = await fixture(t);
  const { client, project } = await demo(server);
  const task = await addTask(client, project, { subtasks: [{ title: 'Existing step', done: true }] });
  const patched = (await request(client, `/api/tasks/${task.id}`, 'PATCH', {
    subtasks: [task.subtasks[0], { title: 'New review step' }, { title: 'New final artwork step' }],
  })).task;
  assert.deepEqual(patched.subtasks[0], task.subtasks[0]);
  const newIds = patched.subtasks.slice(1).map((subtask) => subtask.id);
  assert.ok(newIds.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)));
  assert.equal(new Set(patched.subtasks.map((subtask) => subtask.id)).size, 3);
  assert.ok(patched.subtasks.slice(1).every((subtask) => subtask.done === false));
  const saved = (await request(client, `/api/projects/${project.id}/tasks`)).tasks.find((entry) => entry.id === task.id);
  assert.deepEqual(saved.subtasks, patched.subtasks);
  const statusOnly = (await request(client, `/api/tasks/${task.id}`, 'PATCH', { status: 'review' })).task;
  assert.deepEqual(statusOnly.subtasks, patched.subtasks);
  const editedSubtasks = patched.subtasks.map((subtask, index) => ({ ...subtask, done: index < 2 }));
  const checked = (await request(client, `/api/tasks/${task.id}`, 'PATCH', { subtasks: editedSubtasks })).task;
  assert.deepEqual(checked.subtasks, editedSubtasks);
});

test('project tag catalogs persist after deleting tasks and deduplicate manual additions', async (t) => {
  const server = await fixture(t);
  const { client, project } = await demo(server);
  const task = await addTask(client, project, { contentTypes: ['New format'], channels: ['New platform'] });
  await request(client, `/api/tasks/${task.id}`, 'DELETE', undefined, 204);
  let fresh = (await request(client, `/api/projects/${project.id}`)).project;
  assert.ok(fresh.contentTypeOptions.includes('New format'));
  assert.ok(fresh.channelOptions.includes('New platform'));
  await request(client, `/api/projects/${project.id}/tags`, 'PATCH', { kind: 'contentType', value: '  NEW FORMAT  ' });
  await request(client, `/api/projects/${project.id}/tags`, 'PATCH', { kind: 'channel', value: '  new PLATFORM ' });
  fresh = (await request(client, `/api/projects/${project.id}`)).project;
  assert.equal(fresh.contentTypeOptions.filter((value) => value.toLowerCase() === 'new format').length, 1);
  assert.equal(fresh.channelOptions.filter((value) => value.toLowerCase() === 'new platform').length, 1);
  await request(client, `/api/projects/${project.id}/tags`, 'PATCH', { kind: 'unknown', value: 'Tag' }, 400);
  await request(client, `/api/projects/${project.id}/tags`, 'PATCH', { kind: 'channel', value: '   ' }, 400);
  const teammate = await asUser(server, project.members.find((member) => member.role === 'editor').userId);
  const refreshed = (await request(teammate, `/api/projects/${project.id}`)).project;
  assert.deepEqual(refreshed.contentTypeOptions, fresh.contentTypeOptions);
  assert.deepEqual(refreshed.channelOptions, fresh.channelOptions);
  await server.close();
  const restarted = await startServer(server.databasePath);
  try {
    const persisted = (await request(restarted.client(client.cookie), `/api/projects/${project.id}`)).project;
    assert.deepEqual(persisted.contentTypeOptions, fresh.contentTypeOptions);
    assert.deepEqual(persisted.channelOptions, fresh.channelOptions);
  } finally {
    await restarted.close();
  }
});

test('invalid array values and nonmember assignments do not partially overwrite a task', async (t) => {
  const server = await fixture(t);
  const { client, project } = await demo(server);
  const { client: outsider } = await demo(server);
  const task = await addTask(client, project, { assigneeIds: [client.user.id], contentTypes: ['VDO'], channels: ['TikTok'] });
  for (const body of [
    { assigneeIds: [client.user.id, outsider.user.id] },
    { assigneeIds: ['invalid/id'] },
    { assigneeIds: 'not-an-array' },
    { contentTypes: [''] },
    { contentTypes: ['x'.repeat(101)] },
    { channels: [123] },
    { channels: Array.from({ length: 21 }, (_, index) => `Channel ${index}`) },
  ]) await request(client, `/api/tasks/${task.id}`, 'PATCH', body, 400);
  const stored = (await request(client, `/api/projects/${project.id}/tasks`)).tasks.find((entry) => entry.id === task.id);
  assert.deepEqual(stored, task);
});

test('project covers accept HTTPS and PNG uploads and reject unsafe, invalid or oversized data', async (t) => {
  const server = await fixture(t);
  const { client } = await demo(server);
  const project = (await request(client, '/api/projects', 'POST', { name: 'Image project', coverImage: 'https://example.com/cover.png' }, 201)).project;
  assert.equal(project.coverImage, 'https://example.com/cover.png');
  const upload = (await request(client, `/api/projects/${project.id}`, 'PATCH', { coverImage: PNG })).project;
  assert.equal(upload.coverImage, PNG);
  const renamed = (await request(client, `/api/projects/${project.id}`, 'PATCH', { name: 'Renamed image project' })).project;
  assert.equal(renamed.coverImage, PNG);
  for (const coverImage of ['not a url', 'javascript:alert(1)', 'http://example.com/image.png', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'data:image/png;base64,!!!', `data:image/png;base64,${'A'.repeat(650000)}`]) {
    await request(client, `/api/projects/${project.id}`, 'PATCH', { coverImage }, 400);
  }
  assert.equal((await request(client, `/api/projects/${project.id}`)).project.coverImage, PNG);
  for (const coverImage of ['', null]) {
    const cleared = (await request(client, `/api/projects/${project.id}`, 'PATCH', { coverImage })).project;
    assert.equal(cleared.coverImage, null);
  }
  assert.equal((await request(client, '/api/projects', 'POST', { name: 'Default cover project' }, 201)).project.coverImage, null);
});

test('assignments notify new recipients including the actor, with scoped read state and membership revocation', async (t) => {
  const server = await fixture(t);
  const { client: owner, project } = await demo(server);
  const teammates = project.members.filter((entry) => entry.userId !== owner.user.id);
  const first = await asUser(server, teammates[0].userId);
  const second = await asUser(server, teammates[1].userId);
  const task = await addTask(owner, project, { assigneeIds: [owner.user.id, teammates[0].userId] });
  const ownNotifications = await request(owner, '/api/notifications');
  assert.equal(ownNotifications.notifications.filter((entry) => entry.taskId === task.id).length, 1);
  let firstInbox = await request(first, '/api/notifications');
  const firstNotice = firstInbox.notifications.find((entry) => entry.taskId === task.id);
  assert.ok(firstNotice);
  assert.equal(firstNotice.userId, teammates[0].userId);
  assert.equal(firstNotice.actorId, owner.user.id);
  assert.equal(firstNotice.projectId, project.id);
  assert.equal(firstNotice.type, 'assignment');
  assert.equal(firstNotice.readAt, null);
  assert.equal(firstInbox.unreadCount, firstInbox.notifications.filter((entry) => !entry.readAt).length);
  await request(owner, `/api/tasks/${task.id}`, 'PATCH', { status: 'done' });
  firstInbox = await request(first, '/api/notifications');
  assert.equal(firstInbox.notifications.filter((entry) => entry.taskId === task.id).length, 1);
  await request(owner, `/api/tasks/${task.id}`, 'PATCH', { assigneeIds: [teammates[0].userId, teammates[1].userId] });
  assert.equal((await request(first, '/api/notifications')).notifications.filter((entry) => entry.taskId === task.id).length, 1);
  const secondInbox = await request(second, '/api/notifications');
  assert.equal(secondInbox.notifications.filter((entry) => entry.taskId === task.id).length, 1);
  await request(second, `/api/notifications/${firstNotice.id}/read`, 'PATCH', undefined, 404);
  const read = (await request(first, `/api/notifications/${firstNotice.id}/read`, 'PATCH')).notification;
  assert.ok(read.readAt);
  const readAgain = (await request(first, `/api/notifications/${firstNotice.id}/read`, 'PATCH')).notification;
  assert.equal(readAgain.readAt, read.readAt);
  await request(second, '/api/notifications/read-all', 'POST', undefined, 204);
  assert.equal((await request(second, '/api/notifications')).unreadCount, 0);
  await request(owner, `/api/projects/${project.id}/members/${teammates[0].userId}`, 'DELETE');
  assert.ok(!(await request(first, '/api/notifications')).notifications.some((entry) => entry.projectId === project.id));
  await request(first, `/api/notifications/${firstNotice.id}/read`, 'PATCH', undefined, 404);
  const changed = (await request(owner, `/api/projects/${project.id}/tasks`)).tasks.find((entry) => entry.id === task.id);
  assert.deepEqual(changed.assigneeIds, [teammates[1].userId]);
  assert.equal(changed.assigneeId, teammates[1].userId);
});

test('a real superadmin sees normal workspaces while demo projects and teammates stay isolated', async (t) => {
  const server = await fixture(t, { superadminEmail: 'admin@example.com' });
  const admin = await verifiedAccount(server, 'admin@example.com');
  // Domain authorization tests use an administrator provisioned by the system owner;
  // preview mail verification must never grant real administrator privileges.
  await server.app.locals.db.run('UPDATE users SET global_role = ? WHERE id = ?', ['superadmin', admin.user.id]);
  admin.user = (await request(admin, '/api/auth/me')).user;
  assert.equal(admin.user.globalRole, 'superadmin');
  const normal = await verifiedAccount(server, 'normal@example.com');
  const project = (await request(normal, '/api/projects', 'POST', { name: 'Normal project' }, 201)).project;
  const { client: demoUser, project: demoProject } = await demo(server);
  assert.ok((await request(admin, '/api/projects')).projects.some((entry) => entry.id === project.id));
  assert.ok(!(await request(admin, '/api/projects')).projects.some((entry) => entry.id === demoProject.id));
  await request(admin, `/api/projects/${demoProject.id}`, 'GET', undefined, 404);
  await request(demoUser, `/api/projects/${project.id}`, 'GET', undefined, 404);
  await request(normal, `/api/projects/${project.id}/members`, 'POST', { email: demoUser.user.email, role: 'viewer' }, 404);
  await request(demoUser, `/api/projects/${demoProject.id}/members`, 'POST', { email: normal.user.email, role: 'viewer' }, 404);
  const task = await addTask(normal, project, {});
  assert.equal((await request(admin, `/api/tasks/${task.id}`, 'PATCH', { status: 'done' })).task.status, 'done');
  const users = (await request(admin, '/api/users')).users;
  assert.ok(!users.some((user) => user.id === demoUser.user.id));
  const { client: anotherDemo, project: anotherProject } = await demo(server);
  assert.ok(!(await request(demoUser, '/api/projects')).projects.some((entry) => entry.id === anotherProject.id));
  await request(anotherDemo, `/api/projects/${demoProject.id}`, 'GET', undefined, 404);
});

test('additive SQLite migration preserves legacy accounts and task data while adding arrays and catalogs', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'teamflow-legacy-test-'));
  const databasePath = join(directory, 'legacy.sqlite');
  let migrated;
  t.after(async () => {
    await migrated?.close();
    await rm(directory, { recursive: true, force: true });
  });
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, avatar_color TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, color TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, fields_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE project_members (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL, PRIMARY KEY (project_id, user_id));
    CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, data_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  const now = '2026-10-08T10:00:00.000Z';
  const oldTask = {
    id: 'legacy-task', projectId: 'legacy-project', title: 'Original legacy brief', description: 'Do not lose me',
    assigneeId: 'legacy-member', contentType: 'VDO', channel: 'TikTok', status: 'todo', priority: 'high',
    dueDate: '2026-10-31', links: [], subtasks: [], customFields: {}, createdAt: now, updatedAt: now,
  };
  const lookalikePasswordHash = await bcrypt.hash('normal-account-password', 4);
  for (const [id, email, passwordHash = 'existing-password-hash'] of [
    ['legacy-owner', 'owner@example.com'], ['legacy-member', 'member@example.com'],
    ['legacy-demo-owner', 'demo-a1b2c3d4-0@example.invalid', '!demo-only-no-login'],
    ['legacy-demo-member', 'demo-a1b2c3d4-1@example.invalid', '!demo-only-no-login'],
    ['demo-lookalike', 'demo-a1b2c3d5-0@example.invalid', lookalikePasswordHash],
  ]) {
    legacy.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run(id, id, email, passwordHash, '#f97316', now);
  }
  legacy.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('existing-session-hash', 'legacy-owner', '2030-01-01T00:00:00.000Z');
  legacy.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?)').run('legacy-project', 'Legacy room', 'Preserve project', '#f97316', 'legacy-owner', '[]', now);
  legacy.prepare('INSERT INTO project_members VALUES (?, ?, ?)').run('legacy-project', 'legacy-member', 'editor');
  legacy.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?)').run(oldTask.id, oldTask.projectId, JSON.stringify(oldTask), now, now);
  legacy.close();
  migrated = await openDatabase({ databasePath, databaseUrl: '' });
  assert.equal((await migrated.get('SELECT * FROM users WHERE id = ?', ['legacy-owner'])).password_hash, 'existing-password-hash');
  assert.equal((await migrated.get('SELECT * FROM sessions WHERE user_id = ?', ['legacy-owner'])).token_hash, 'existing-session-hash');
  assert.equal((await migrated.get('SELECT * FROM project_members WHERE project_id = ?', ['legacy-project'])).role, 'editor');
  const migratedTask = JSON.parse((await migrated.get('SELECT data_json FROM tasks WHERE id = ?', [oldTask.id])).data_json);
  for (const [key, value] of Object.entries(oldTask)) assert.deepEqual(migratedTask[key], value);
  assert.deepEqual(migratedTask.assigneeIds, ['legacy-member']);
  assert.deepEqual(migratedTask.contentTypes, ['VDO']);
  assert.deepEqual(migratedTask.channels, ['TikTok']);
  const migratedProject = await migrated.get('SELECT * FROM projects WHERE id = ?', ['legacy-project']);
  assert.deepEqual(JSON.parse(migratedProject.content_type_options_json), ['VDO']);
  assert.deepEqual(JSON.parse(migratedProject.channel_options_json), ['TikTok']);
  const demoOwner = await migrated.get('SELECT * FROM users WHERE id = ?', ['legacy-demo-owner']);
  const demoMember = await migrated.get('SELECT * FROM users WHERE id = ?', ['legacy-demo-member']);
  assert.ok(demoOwner.demo_scope_id);
  assert.equal(demoOwner.demo_scope_id, demoMember.demo_scope_id);
  assert.equal(demoOwner.email_verified, 1);
  assert.equal(demoOwner.global_role, 'superadmin');
  assert.equal(demoMember.global_role, 'member');
  const lookalike = await migrated.get('SELECT * FROM users WHERE id = ?', ['demo-lookalike']);
  assert.equal(lookalike.password_hash, lookalikePasswordHash);
  assert.equal(lookalike.demo_scope_id, null);
  assert.equal(lookalike.email_verified, 0);
  assert.equal(lookalike.global_role, 'member');
  const userColumns = (await migrated.all('PRAGMA table_info(users)')).map((column) => column.name);
  const projectColumns = (await migrated.all('PRAGMA table_info(projects)')).map((column) => column.name);
  assert.ok(userColumns.length > 6, 'Account columns must be added to the legacy schema');
  assert.ok(projectColumns.some((column) => column.includes('content_type') || column.includes('tag')), 'Project tag storage must be added');
  assert.ok((await migrated.all("SELECT name FROM sqlite_master WHERE type = 'table'")).some((table) => table.name === 'notifications'));
  await migrated.close();
  migrated = await openDatabase({ databasePath, databaseUrl: '' });
  assert.deepEqual(JSON.parse((await migrated.get('SELECT data_json FROM tasks WHERE id = ?', [oldTask.id])).data_json), migratedTask);
  assert.deepEqual(await migrated.get('SELECT * FROM users WHERE id = ?', ['demo-lookalike']), lookalike);
});
