import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import { createApp } from './app.js';

const PASSWORD = 'correct-horse-battery';

async function startServer(databasePath) {
  const app = await createApp({ databasePath, databaseUrl: '', disableRateLimit: true, distPath: '/nonexistent-test-dist' });
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  return {
    app, baseUrl,
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
        async request(path, { method = 'GET', body, headers = {} } = {}) {
          const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: {
              ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
              ...(this.cookie ? { Cookie: this.cookie } : {}),
              ...headers,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          const setCookie = response.headers.getSetCookie()[0];
          if (setCookie) this.cookie = setCookie.split(';')[0];
          const data = response.status === 204 ? null : await response.json();
          return { response, data, setCookie };
        },
      };
    },
  };
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'teamflow-api-test-'));
  const server = await startServer(join(directory, 'test.sqlite'));
  t.after(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  return server;
}

async function expectRequest(client, path, method, body, expectedStatus = 200, headers) {
  const result = await client.request(path, { method, body, headers });
  assert.equal(result.response.status, expectedStatus, `${method} ${path}: ${JSON.stringify(result.data)}`);
  return result;
}

async function register(server, email, name = email.split('@')[0]) {
  const client = server.client();
  const { data } = await expectRequest(client, '/api/auth/register', 'POST', { name, email, password: PASSWORD }, 201);
  client.user = data.user;
  return client;
}

async function createProject(client, extra = {}) {
  const { data } = await expectRequest(client, '/api/projects', 'POST', { name: 'Content studio', ...extra }, 201);
  return data.project;
}

async function createTask(client, project, extra = {}) {
  const { data } = await expectRequest(client, `/api/projects/${project.id}/tasks`, 'POST', { title: 'Prepare campaign', ...extra }, 201);
  return data.task;
}

test('authentication normalizes email, hashes credentials, rotates sessions and revokes logout', async (t) => {
  const server = await fixture(t);
  const client = server.client();
  const registration = await expectRequest(client, '/api/auth/register', 'POST', {
    name: '  Content Lead  ', email: '  LEAD@EXAMPLE.COM ', password: PASSWORD,
  }, 201, { 'X-Forwarded-Proto': 'https' });
  assert.equal(registration.data.user.name, 'Content Lead');
  assert.equal(registration.data.user.email, 'lead@example.com');
  assert.deepEqual(Object.keys(registration.data.user).sort(), ['avatarColor', 'email', 'id', 'name']);
  assert.match(registration.setCookie, /HttpOnly/);
  assert.match(registration.setCookie, /SameSite=Lax/);
  assert.match(registration.setCookie, /Secure/);
  assert.match(registration.setCookie, /Path=\//);
  assert.equal(registration.response.headers.get('cache-control'), 'no-store');
  assert.equal(registration.response.headers.get('x-content-type-options'), 'nosniff');
  const user = await server.app.locals.db.get('SELECT * FROM users WHERE id = ?', [registration.data.user.id]);
  assert.notEqual(user.password_hash, PASSWORD);
  assert.match(user.password_hash, /^\$2[aby]\$/);
  assert.equal(await bcrypt.compare(PASSWORD, user.password_hash), true);
  const oldCookie = client.cookie;
  const token = oldCookie.split('=')[1];
  const stored = await server.app.locals.db.get('SELECT * FROM sessions WHERE user_id = ?', [user.id]);
  assert.notEqual(stored.token_hash, token);
  assert.equal(stored.token_hash, createHash('sha256').update(token).digest('hex'));
  assert.ok(new Date(stored.expires_at).getTime() > Date.now());
  await expectRequest(server.client(), '/api/auth/register', 'POST', {
    name: 'Duplicate', email: 'LEAD@example.com', password: PASSWORD,
  }, 409);
  for (const password of ['short', 'x'.repeat(73), 'ก'.repeat(25)]) {
    await expectRequest(server.client(), '/api/auth/register', 'POST', {
      name: 'Invalid password', email: 'invalid@example.com', password,
    }, 400);
  }
  const badPassword = await expectRequest(client, '/api/auth/login', 'POST', { email: user.email, password: 'incorrect' }, 401);
  const unknownEmail = await expectRequest(client, '/api/auth/login', 'POST', { email: 'missing@example.com', password: 'incorrect' }, 401);
  assert.deepEqual(badPassword.data, unknownEmail.data);
  await expectRequest(client, '/api/auth/login', 'POST', { email: user.email, password: PASSWORD });
  assert.notEqual(client.cookie, oldCookie);
  await expectRequest(server.client(oldCookie), '/api/auth/me', 'GET', undefined, 401);
  const currentCookie = client.cookie;
  assert.equal((await expectRequest(client, '/api/auth/me', 'GET')).data.user.id, user.id);
  await expectRequest(client, '/api/auth/logout', 'POST', undefined, 204);
  await expectRequest(server.client(currentCookie), '/api/auth/me', 'GET', undefined, 401);
  assert.equal((await server.app.locals.db.all('SELECT * FROM sessions')).length, 0);
});

test('private projects and tasks are hidden from nonmembers and unauthenticated requests', async (t) => {
  const server = await fixture(t);
  const owner = await register(server, 'owner@example.com');
  const outsider = await register(server, 'outsider@example.com');
  const project = await createProject(owner);
  const task = await createTask(owner, project);
  const anonymous = server.client();
  for (const path of ['/api/projects', `/api/projects/${project.id}`, `/api/projects/${project.id}/tasks`, '/api/users']) {
    await expectRequest(anonymous, path, 'GET', undefined, 401);
  }
  for (const [path, method, body] of [
    [`/api/projects/${project.id}`, 'GET'],
    [`/api/projects/${project.id}`, 'PATCH', { name: 'Stolen' }],
    [`/api/projects/${project.id}`, 'DELETE'],
    [`/api/projects/${project.id}/tasks`, 'GET'],
    [`/api/projects/${project.id}/tasks`, 'POST', { title: 'Unauthorized task' }],
    [`/api/tasks/${task.id}`, 'PATCH', { status: 'done' }],
    [`/api/tasks/${task.id}`, 'DELETE'],
  ]) {
    const result = await expectRequest(outsider, path, method, body, 404);
    assert.equal(result.data.code, 'NOT_FOUND');
  }
  assert.deepEqual((await expectRequest(outsider, '/api/projects', 'GET')).data.projects, []);
  assert.deepEqual((await expectRequest(outsider, '/api/users', 'GET')).data.users.map((user) => user.id), [outsider.user.id]);
  assert.equal((await expectRequest(owner, `/api/projects/${project.id}/tasks`, 'GET')).data.tasks.length, 1);
});

test('owner, editor and viewer roles enforce task editing and project administration', async (t) => {
  const server = await fixture(t);
  const owner = await register(server, 'owner@example.com');
  const editor = await register(server, 'editor@example.com');
  const viewer = await register(server, 'viewer@example.com');
  const project = await createProject(owner);
  await expectRequest(owner, `/api/projects/${project.id}/members`, 'POST', { email: 'unknown@example.com', role: 'editor' }, 404);
  await expectRequest(owner, `/api/projects/${project.id}/members`, 'POST', { email: owner.user.email, role: 'editor' }, 400);
  await expectRequest(owner, `/api/projects/${project.id}/members`, 'POST', { email: editor.user.email, role: 'owner' }, 400);
  await expectRequest(owner, `/api/projects/${project.id}/members`, 'POST', { email: editor.user.email.toUpperCase(), role: 'editor' });
  await expectRequest(owner, `/api/projects/${project.id}/members`, 'POST', { email: viewer.user.email, role: 'viewer' });
  assert.equal((await expectRequest(editor, `/api/projects/${project.id}`, 'GET')).data.project.yourRole, 'editor');
  assert.equal((await expectRequest(viewer, `/api/projects/${project.id}`, 'GET')).data.project.yourRole, 'viewer');
  const task = await createTask(editor, project, { assigneeId: editor.user.id });
  await expectRequest(editor, `/api/tasks/${task.id}`, 'PATCH', { status: 'review' });
  assert.equal((await expectRequest(viewer, `/api/projects/${project.id}/tasks`, 'GET')).data.tasks[0].status, 'review');
  for (const [path, method, body] of [
    [`/api/projects/${project.id}/tasks`, 'POST', { title: 'No permission' }],
    [`/api/tasks/${task.id}`, 'PATCH', { title: 'No permission' }],
    [`/api/tasks/${task.id}`, 'DELETE'],
  ]) await expectRequest(viewer, path, method, body, 403);
  for (const member of [editor, viewer]) {
    await expectRequest(member, `/api/projects/${project.id}`, 'PATCH', { name: 'No permission' }, 403);
    await expectRequest(member, `/api/projects/${project.id}`, 'DELETE', undefined, 403);
    await expectRequest(member, `/api/projects/${project.id}/members`, 'POST', { email: owner.user.email, role: 'viewer' }, 403);
    await expectRequest(member, `/api/projects/${project.id}/members/${viewer.user.id}`, 'DELETE', undefined, 403);
  }
  const disposable = await createTask(editor, project, { title: 'Disposable' });
  await expectRequest(editor, `/api/tasks/${disposable.id}`, 'DELETE', undefined, 204);
  await expectRequest(owner, `/api/projects/${project.id}/members/${owner.user.id}`, 'DELETE', undefined, 400);
  await expectRequest(owner, `/api/projects/${project.id}/members/${editor.user.id}`, 'DELETE');
  await expectRequest(editor, `/api/projects/${project.id}`, 'GET', undefined, 404);
  await expectRequest(editor, `/api/tasks/${task.id}`, 'PATCH', { status: 'done' }, 404);
  const remaining = (await expectRequest(owner, `/api/projects/${project.id}/tasks`, 'GET')).data.tasks;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].assigneeId, null);
  assert.equal(remaining[0].status, 'review');
  const visibleUsers = (await expectRequest(viewer, '/api/users', 'GET')).data.users.map((user) => user.id).sort();
  assert.deepEqual(visibleUsers, [owner.user.id, viewer.user.id].sort());
});

test('invalid task inputs are rejected without inserting or corrupting existing tasks', async (t) => {
  const server = await fixture(t);
  const owner = await register(server, 'owner@example.com');
  const outsider = await register(server, 'outsider@example.com');
  const project = await createProject(owner, {
    fields: [{ id: 'campaign', name: 'Campaign', type: 'select', options: ['Launch', 'Always-on'] }],
  });
  const invalid = [
    { title: '   ' },
    { title: 'x'.repeat(301) },
    { title: 'Task', status: 'unknown' },
    { title: 'Task', priority: 'critical' },
    { title: 'Task', dueDate: '2026-02-30' },
    { title: 'Task', dueDate: '2026-2-01' },
    { title: 'Task', links: [{ url: 'not a url' }] },
    { title: 'Task', links: [{ url: 'javascript:alert(1)' }] },
    { title: 'Task', links: [{ url: 'ftp://example.com/file' }] },
    { title: 'Task', assigneeId: outsider.user.id },
    { title: 'Task', customFields: { missing: 'value' } },
    { title: 'Task', customFields: { campaign: 'Other' } },
    { title: 'Task', subtasks: [{ id: 'duplicate', title: 'One' }, { id: 'duplicate', title: 'Two' }] },
    { title: 'Task', id: 'client-controlled-id' },
    { title: 'Task', projectId: 'other-project' },
  ];
  for (const body of invalid) {
    await expectRequest(owner, `/api/projects/${project.id}/tasks`, 'POST', body, 400);
  }
  assert.deepEqual((await expectRequest(owner, `/api/projects/${project.id}/tasks`, 'GET')).data.tasks, []);
  const task = await createTask(owner, project, {
    title: '  Valid leap day  ', dueDate: '2024-02-29', customFields: { campaign: 'Launch' },
    links: [{ url: 'https://drive.google.com/file/example' }], subtasks: [{ title: 'First step' }],
  });
  assert.equal(task.title, 'Valid leap day');
  assert.ok(task.subtasks[0].id);
  assert.equal(task.subtasks[0].done, false);
  assert.equal(task.links[0].label, 'Attachment');
  for (const body of [{ id: 'replaced' }, { projectId: 'replaced' }, { createdAt: 'replaced' }, { title: '' }, { status: 'invalid' }, { dueDate: '2025-02-29' }, { assigneeId: outsider.user.id }]) {
    await expectRequest(owner, `/api/tasks/${task.id}`, 'PATCH', body, 400);
  }
  const stored = (await expectRequest(owner, `/api/projects/${project.id}/tasks`, 'GET')).data.tasks[0];
  assert.deepEqual(stored, task);
});

test('a status-only PATCH preserves task details and explicit null clears the due date', async (t) => {
  const server = await fixture(t);
  const owner = await register(server, 'owner@example.com');
  const project = await createProject(owner, { fields: [{ id: 'note', name: 'Note', type: 'text' }] });
  const task = await createTask(owner, project, {
    description: 'Keep this brief', priority: 'high', dueDate: '2026-12-31', assigneeId: owner.user.id,
    contentType: 'VDO', channel: 'TikTok', links: [{ label: 'Source files', url: 'https://example.com/files' }],
    subtasks: [{ title: 'Write copy', done: true }, { title: 'Review' }], customFields: { note: 'Launch day' },
  });
  const patched = (await expectRequest(owner, `/api/tasks/${task.id}`, 'PATCH', { status: 'done' })).data.task;
  for (const key of Object.keys(task).filter((key) => !['status', 'updatedAt'].includes(key))) {
    assert.deepEqual(patched[key], task[key], `${key} must be preserved by a partial update`);
  }
  assert.equal(patched.status, 'done');
  assert.equal((await expectRequest(owner, `/api/projects/${project.id}`, 'GET')).data.project.completedCount, 1);
  const cleared = (await expectRequest(owner, `/api/tasks/${task.id}`, 'PATCH', { dueDate: null })).data.task;
  assert.equal(cleared.dueDate, null);
  assert.equal(cleared.status, 'done');
  assert.deepEqual(cleared.subtasks, task.subtasks);
});

test('project field changes retain valid values and remove obsolete field data', async (t) => {
  const server = await fixture(t);
  const owner = await register(server, 'owner@example.com');
  const fields = [
    { id: 'campaign', name: 'Campaign', type: 'select', options: ['Launch', 'Evergreen'] },
    { id: 'notes', name: 'Notes', type: 'text' },
    { id: 'remove', name: 'Remove', type: 'text' },
  ];
  const project = await createProject(owner, { description: 'Original description', fields });
  const first = await createTask(owner, project, { customFields: { campaign: 'Launch', notes: 'Keep me', remove: 'Old' } });
  const second = await createTask(owner, project, { customFields: { campaign: 'Evergreen', notes: 'Also keep' } });
  await expectRequest(owner, `/api/projects/${project.id}`, 'PATCH', { fields: [fields[0], fields[0]] }, 400);
  const changed = (await expectRequest(owner, `/api/projects/${project.id}`, 'PATCH', {
    name: 'New studio', color: '#8b5cf6', fields: [{ ...fields[0], options: ['Evergreen'] }, fields[1]],
  })).data.project;
  assert.equal(changed.name, 'New studio');
  assert.equal(changed.color, '#8b5cf6');
  assert.equal(changed.description, 'Original description');
  assert.equal(changed.taskCount, 2);
  const tasks = (await expectRequest(owner, `/api/projects/${project.id}/tasks`, 'GET')).data.tasks;
  assert.deepEqual(tasks.find((task) => task.id === first.id).customFields, { notes: 'Keep me' });
  assert.deepEqual(tasks.find((task) => task.id === second.id).customFields, { campaign: 'Evergreen', notes: 'Also keep' });
  await expectRequest(owner, `/api/tasks/${first.id}`, 'PATCH', { customFields: { campaign: 'Launch' } }, 400);
});

test('SQLite persists accounts, sessions and tasks across restart and project deletion cascades', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'teamflow-persistence-test-'));
  const databasePath = join(directory, 'persistent.sqlite');
  const first = await startServer(databasePath);
  let second;
  t.after(async () => {
    await first.close();
    await second?.close();
    await rm(directory, { recursive: true, force: true });
  });
  const owner = await register(first, 'owner@example.com');
  const editor = await register(first, 'editor@example.com');
  const project = await createProject(owner);
  await expectRequest(owner, `/api/projects/${project.id}/members`, 'POST', { email: editor.user.email, role: 'editor' });
  const task = await createTask(editor, project, { dueDate: '2026-10-31', assigneeId: editor.user.id });
  await first.close();
  second = await startServer(databasePath);
  const restoredOwner = second.client(owner.cookie);
  const restoredEditor = second.client(editor.cookie);
  assert.equal((await expectRequest(restoredOwner, '/api/auth/me', 'GET')).data.user.id, owner.user.id);
  assert.deepEqual((await expectRequest(restoredEditor, `/api/projects/${project.id}/tasks`, 'GET')).data.tasks, [task]);
  await expectRequest(restoredOwner, `/api/projects/${project.id}`, 'DELETE', undefined, 204);
  await expectRequest(restoredEditor, `/api/projects/${project.id}`, 'GET', undefined, 404);
  await expectRequest(restoredOwner, `/api/tasks/${task.id}`, 'PATCH', { status: 'done' }, 404);
  assert.equal((await second.app.locals.db.all('SELECT * FROM tasks')).length, 0);
  assert.equal((await second.app.locals.db.all('SELECT * FROM project_members')).length, 0);
  assert.equal((await expectRequest(restoredOwner, '/api/auth/me', 'GET')).data.user.id, owner.user.id);
});

test('demo sessions receive separate populated workspaces and cannot inspect one another', async (t) => {
  const server = await fixture(t);
  const first = server.client();
  const second = server.client();
  const firstUser = (await expectRequest(first, '/api/auth/demo', 'POST', undefined, 201)).data.user;
  const secondUser = (await expectRequest(second, '/api/auth/demo', 'POST', undefined, 201)).data.user;
  assert.notEqual(firstUser.id, secondUser.id);
  const firstProjects = (await expectRequest(first, '/api/projects', 'GET')).data.projects;
  const secondProjects = (await expectRequest(second, '/api/projects', 'GET')).data.projects;
  assert.equal(firstProjects.length, 3);
  assert.equal(secondProjects.length, 3);
  assert.ok(firstProjects.every((project) => project.yourRole === 'owner' && project.members.length === 4));
  assert.ok(firstProjects.every((project) => !secondProjects.some((other) => project.id === other.id)));
  const contentProject = firstProjects.find((project) => project.name === 'Regagar');
  const tasks = (await expectRequest(first, `/api/projects/${contentProject.id}/tasks`, 'GET')).data.tasks;
  assert.equal(tasks.length, 18);
  assert.deepEqual([...new Set(tasks.map((task) => task.status))].sort(), ['done', 'in_progress', 'review', 'scheduled', 'todo']);
  assert.ok(tasks.some((task) => task.links.length > 0 && task.subtasks.length > 0));
  assert.ok(tasks.every((task) => /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate)));
  await expectRequest(second, `/api/projects/${contentProject.id}`, 'GET', undefined, 404);
  await expectRequest(second, `/api/tasks/${tasks[0].id}`, 'PATCH', { title: 'Cross-workspace edit' }, 404);
  const firstUsers = (await expectRequest(first, '/api/users', 'GET')).data.users;
  const secondUsers = (await expectRequest(second, '/api/users', 'GET')).data.users;
  assert.equal(firstUsers.length, 4);
  assert.ok(firstUsers.every((user) => !secondUsers.some((other) => other.id === user.id)));
});

test('cross-origin mutations and expired or malformed sessions fail safely', async (t) => {
  const server = await fixture(t);
  const client = await register(server, 'owner@example.com');
  const blocked = await expectRequest(client, '/api/projects', 'POST', { name: 'Blocked' }, 403, { Origin: 'https://attacker.example' });
  assert.equal(blocked.data.code, 'ORIGIN_MISMATCH');
  await expectRequest(client, '/api/projects', 'POST', { name: 'Allowed' }, 201, { Origin: server.baseUrl });
  assert.equal((await expectRequest(client, '/api/projects', 'GET')).data.projects.length, 1);
  await expectRequest(server.client('teamflow_session=malformed'), '/api/auth/me', 'GET', undefined, 401);
  await server.app.locals.db.run('UPDATE sessions SET expires_at = ?', ['2000-01-01T00:00:00.000Z']);
  await expectRequest(client, '/api/auth/me', 'GET', undefined, 401);
});
