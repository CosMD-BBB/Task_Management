import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from './app.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'teamflow-concurrency-test-'));
  const app = await createApp({
    databasePath: join(directory, 'test.sqlite'), databaseUrl: '', mailMode: 'preview',
    disableRateLimit: true, distPath: '/nonexistent-test-dist',
  });
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    await app.locals.close();
    await rm(directory, { recursive: true, force: true });
  });
  const client = (cookie = '') => ({
    cookie,
    async request(path, method = 'GET', body) {
      const response = await fetch(`${baseUrl}${path}`, {
        method, headers: {
          ...(this.cookie ? { Cookie: this.cookie } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = response.headers.getSetCookie()[0];
      if (setCookie) this.cookie = setCookie.split(';')[0];
      return { status: response.status, data: response.status === 204 ? null : await response.json() };
    },
  });
  const asUser = async (userId) => {
    const token = randomBytes(32).toString('hex');
    await app.locals.db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [
      createHash('sha256').update(token).digest('hex'), userId, new Date(Date.now() + 3_600_000).toISOString(),
    ]);
    return client(`teamflow_session=${token}`);
  };
  const owner = client();
  owner.user = (await request(owner, '/api/auth/demo', 'POST', undefined, 201)).user;
  const project = (await request(owner, '/api/projects')).projects.find((entry) => entry.name === 'Regagar');
  const editorMembers = project.members.filter((entry) => entry.role === 'editor');
  const editor = await asUser(editorMembers[0].userId);
  const secondEditor = await asUser(editorMembers[1].userId);
  return { app, owner, editor, secondEditor, editorMembers, project, client };
}

async function request(client, path, method = 'GET', body, expectedStatus = 200) {
  const result = await client.request(path, method, body);
  assert.equal(result.status, expectedStatus, `${method} ${path}: ${JSON.stringify(result.data)}`);
  return result.data;
}

async function addTask(context, input = {}) {
  return (await request(context.owner, `/api/projects/${context.project.id}/tasks`, 'POST', {
    title: 'Original task title', ...input,
  }, 201)).task;
}

async function savedTask(context, taskId) {
  const data = await request(context.owner, `/api/projects/${context.project.id}/tasks`);
  return data.tasks.find((task) => task.id === taskId);
}

/** Pause before acquiring the real transaction so another request can commit first. */
async function queuedMutation(db, beginMutation, commitInterveningChange) {
  const originalTransaction = db.transaction;
  const entered = Promise.withResolvers();
  const released = Promise.withResolvers();
  let interceptNext = true;
  db.transaction = async (callback) => {
    if (interceptNext) {
      interceptNext = false;
      entered.resolve();
      await released.promise;
    }
    return originalTransaction.call(db, callback);
  };
  const pending = beginMutation();
  let timeout;
  let failure;
  try {
    await Promise.race([
      entered.promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('The queued mutation did not reach its transaction.')), 5000);
      }),
    ]);
    await commitInterveningChange();
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(timeout);
    db.transaction = originalTransaction;
    released.resolve();
  }
  const result = await pending;
  if (failure) throw failure;
  return result;
}

test('project custom field cleanup preserves a teammate status update committed first', async (t) => {
  const context = await fixture(t);
  const task = await addTask(context, { customFields: { campaign: 'Always-on' }, dueDate: '2026-12-31' });
  const result = await queuedMutation(context.app.locals.db,
    () => context.owner.request(`/api/projects/${context.project.id}`, 'PATCH', { fields: [] }),
    async () => {
      const updated = await request(context.editor, `/api/tasks/${task.id}`, 'PATCH', { status: 'done' });
      assert.equal(updated.task.status, 'done');
    },
  );
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const saved = await savedTask(context, task.id);
  assert.equal(saved.status, 'done');
  assert.deepEqual(saved.customFields, {});
  assert.equal(saved.dueDate, task.dueDate);
});

test('a queued project PATCH preserves tags and cover committed by other requests', async (t) => {
  const context = await fixture(t);
  const result = await queuedMutation(context.app.locals.db,
    () => context.owner.request(`/api/projects/${context.project.id}`, 'PATCH', { name: 'Renamed after concurrent edits' }),
    async () => {
      await request(context.editor, `/api/projects/${context.project.id}/tags`, 'PATCH', { kind: 'channel', value: 'New concurrent platform' });
      await request(context.owner, `/api/projects/${context.project.id}`, 'PATCH', {
        coverImage: 'https://example.com/concurrent-cover.png', description: 'Description from another request',
      });
    },
  );
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const project = (await request(context.owner, `/api/projects/${context.project.id}`)).project;
  assert.equal(project.name, 'Renamed after concurrent edits');
  assert.equal(project.description, 'Description from another request');
  assert.equal(project.coverImage, 'https://example.com/concurrent-cover.png');
  assert.ok(project.channelOptions.includes('New concurrent platform'));
  const row = await context.app.locals.db.get('SELECT channel_options_json FROM projects WHERE id = ?', [project.id]);
  assert.ok(JSON.parse(row.channel_options_json).includes('New concurrent platform'));
});

test('a task PATCH queued before membership removal cannot write after access is revoked', async (t) => {
  const context = await fixture(t);
  const task = await addTask(context);
  const result = await queuedMutation(context.app.locals.db,
    () => context.editor.request(`/api/tasks/${task.id}`, 'PATCH', { title: 'Unauthorized queued edit' }),
    () => request(context.owner, `/api/projects/${context.project.id}/members/${context.editorMembers[0].userId}`, 'DELETE'),
  );
  assert.equal(result.status, 404, JSON.stringify(result.data));
  assert.equal(result.data.code, 'NOT_FOUND');
  assert.equal((await savedTask(context, task.id)).title, task.title);
});

test('a task PATCH queued before an editor becomes a viewer respects the new role', async (t) => {
  const context = await fixture(t);
  const task = await addTask(context);
  const result = await queuedMutation(context.app.locals.db,
    () => context.editor.request(`/api/tasks/${task.id}`, 'PATCH', { status: 'done' }),
    () => request(context.owner, `/api/projects/${context.project.id}/members`, 'POST', {
      email: context.editorMembers[0].user.email, role: 'viewer',
    }),
  );
  assert.equal(result.status, 403, JSON.stringify(result.data));
  assert.equal(result.data.code, 'FORBIDDEN');
  assert.equal((await savedTask(context, task.id)).status, task.status);
});

test('a task PATCH queued before its actor is suspended cannot commit', async (t) => {
  const context = await fixture(t);
  const task = await addTask(context);
  const result = await queuedMutation(context.app.locals.db,
    () => context.editor.request(`/api/tasks/${task.id}`, 'PATCH', { title: 'Suspended actor edit' }),
    () => request(context.owner, `/api/admin/users/${context.editorMembers[0].userId}`, 'PATCH', { disabled: true }),
  );
  assert.ok([401, 403, 404].includes(result.status), JSON.stringify(result.data));
  assert.ok(!result.data.currentTask, 'A rejected suspended request must not receive task conflict data');
  assert.equal((await savedTask(context, task.id)).title, task.title);
  assert.equal((await context.app.locals.db.all('SELECT token_hash FROM sessions WHERE user_id = ?', [context.editorMembers[0].userId])).length, 0);
});

test('an assignee removed while a PATCH waits is rejected without a partial task or notification', async (t) => {
  const context = await fixture(t);
  const task = await addTask(context);
  const removedUserId = context.editorMembers[0].userId;
  const result = await queuedMutation(context.app.locals.db,
    () => context.owner.request(`/api/tasks/${task.id}`, 'PATCH', { title: 'Must not be saved', assigneeIds: [removedUserId] }),
    () => request(context.owner, `/api/projects/${context.project.id}/members/${removedUserId}`, 'DELETE'),
  );
  assert.equal(result.status, 400, JSON.stringify(result.data));
  assert.equal(result.data.code, 'INVALID_ASSIGNEE');
  const saved = await savedTask(context, task.id);
  assert.equal(saved.title, task.title);
  assert.deepEqual(saved.assigneeIds, []);
  assert.equal(saved.updatedAt, task.updatedAt);
  assert.equal((await context.app.locals.db.all('SELECT id FROM notifications WHERE task_id = ? AND user_id = ?', [task.id, removedUserId])).length, 0);
});

test('historical assignments survive suspension and allow unrelated edits, while new assignments reject disabled users', async (t) => {
  const context = await fixture(t);
  const disabledUserId = context.editorMembers[0].userId;
  const historical = await addTask(context, { assigneeIds: [disabledUserId] });
  await request(context.owner, `/api/admin/users/${disabledUserId}`, 'PATCH', { disabled: true });
  const status = (await request(context.owner, `/api/tasks/${historical.id}`, 'PATCH', { status: 'review' })).task;
  assert.equal(status.status, 'review');
  assert.deepEqual(status.assigneeIds, [disabledUserId]);
  const renamed = (await request(context.owner, `/api/tasks/${historical.id}`, 'PATCH', { title: 'Updated historical task' })).task;
  assert.equal(renamed.title, 'Updated historical task');
  assert.deepEqual(renamed.assigneeIds, [disabledUserId]);
  const unassigned = await addTask(context);
  await request(context.owner, `/api/tasks/${unassigned.id}`, 'PATCH', { assigneeIds: [disabledUserId] }, 400);
  await request(context.owner, `/api/projects/${context.project.id}/tasks`, 'POST', { title: 'New disabled assignment', assigneeIds: [disabledUserId] }, 400);
  assert.deepEqual((await savedTask(context, unassigned.id)).assigneeIds, []);
});

test('task update preconditions prevent stale edits and advance versions monotonically', async (t) => {
  const context = await fixture(t);
  const task = await addTask(context, { description: 'Original brief' });
  const futureVersion = new Date(Date.now() + 86_400_000).toISOString();
  const futureTask = { ...task, updatedAt: futureVersion };
  delete futureTask.commentsCount;
  await context.app.locals.db.run('UPDATE tasks SET data_json = ?, updated_at = ? WHERE id = ?', [JSON.stringify(futureTask), futureVersion, task.id]);
  let first;
  const queued = await queuedMutation(context.app.locals.db,
    () => context.secondEditor.request(`/api/tasks/${task.id}`, 'PATCH', {
      title: 'Stale second editor title', description: 'Stale brief', expectedUpdatedAt: futureVersion,
    }),
    async () => {
      first = (await request(context.editor, `/api/tasks/${task.id}`, 'PATCH', {
        title: 'First editor wins', expectedUpdatedAt: futureVersion,
      })).task;
    },
  );
  assert.ok(new Date(first.updatedAt).getTime() > new Date(futureVersion).getTime());
  assert.ok(!Object.hasOwn(first, 'expectedUpdatedAt'));
  assert.equal(queued.status, 409, JSON.stringify(queued.data));
  const conflict = queued.data;
  assert.equal(conflict.code, 'TASK_CONFLICT');
  assert.equal(conflict.currentTask.id, task.id);
  assert.equal(conflict.currentTask.title, 'First editor wins');
  assert.equal(conflict.currentTask.updatedAt, first.updatedAt);
  const afterConflict = await savedTask(context, task.id);
  assert.equal(afterConflict.title, 'First editor wins');
  assert.equal(afterConflict.description, 'Original brief');
  assert.equal(afterConflict.updatedAt, first.updatedAt);
  const compatible = (await request(context.secondEditor, `/api/tasks/${task.id}`, 'PATCH', { status: 'done' })).task;
  assert.equal(compatible.status, 'done');
  assert.equal(compatible.title, 'First editor wins');
  assert.ok(new Date(compatible.updatedAt).getTime() > new Date(first.updatedAt).getTime());
  await request(context.editor, `/api/tasks/${task.id}`, 'PATCH', { expectedUpdatedAt: 'invalid-date', title: 'Invalid precondition' }, 400);
});

test('task conflicts do not expose private or unknown task data', async (t) => {
  const context = await fixture(t);
  const task = await addTask(context);
  const outsider = context.client();
  await request(outsider, '/api/auth/demo', 'POST', undefined, 201);
  for (const taskId of [task.id, 'missing-task-id']) {
    const result = await outsider.request(`/api/tasks/${taskId}`, 'PATCH', {
      title: 'Unauthorized stale payload', expectedUpdatedAt: task.updatedAt,
    });
    assert.equal(result.status, 404, JSON.stringify(result.data));
    assert.equal(result.data.code, 'NOT_FOUND');
    assert.ok(!Object.hasOwn(result.data, 'currentTask'));
  }
  const unknown = await request(context.owner, '/api/tasks/missing-task-id', 'PATCH', {
    title: 'Unknown task', expectedUpdatedAt: task.updatedAt,
  }, 404);
  assert.ok(!Object.hasOwn(unknown, 'currentTask'));
});
