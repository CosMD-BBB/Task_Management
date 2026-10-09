import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createApp } from './app.js';
import { openDatabase } from './database.js';

async function startServer(databasePath) {
  const app = await createApp({ databasePath, databaseUrl: '', mailMode: 'preview', disableRateLimit: true, distPath: '/nonexistent-test-dist' });
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
            method,
            headers: {
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

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'teamflow-comments-test-'));
  const databasePath = join(directory, 'test.sqlite');
  const server = await startServer(databasePath);
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
  return { client, projects, project: projects.find((project) => project.name === 'Regagar') };
}

async function asUser(server, userId) {
  const token = randomBytes(32).toString('hex');
  await server.app.locals.db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [
    createHash('sha256').update(token).digest('hex'), userId, new Date(Date.now() + 3_600_000).toISOString(),
  ]);
  return server.client(`teamflow_session=${token}`);
}

async function addTask(client, project, input = {}) {
  return (await request(client, `/api/projects/${project.id}/tasks`, 'POST', { title: 'Comment API test task', ...input }, 201)).task;
}

async function addComment(client, task, input) {
  return (await request(client, `/api/tasks/${task.id}/comments`, 'POST', input, 201)).comment;
}

async function comments(client, task) {
  return (await request(client, `/api/tasks/${task.id}/comments`)).comments;
}

async function mentionNotices(client, task) {
  return (await request(client, '/api/notifications')).notifications.filter((entry) => entry.taskId === task.id && entry.type === 'mention');
}

function mention(userId, body, text, from = 0) {
  const start = body.indexOf(text, from);
  assert.notEqual(start, -1);
  return { userId, start, end: start + text.length };
}

test('comments, captions and revisions persist with server-owned metadata and derived task counts', async (t) => {
  const server = await fixture(t);
  const { client, project } = await demo(server);
  const task = await addTask(client, project);
  assert.equal(task.commentsCount, 0);
  assert.deepEqual(await comments(client, task), []);
  const plain = await addComment(client, task, { body: '  Brief\nพร้อมเริ่มงาน  ' });
  assert.equal(plain.body, '  Brief\nพร้อมเริ่มงาน  ', 'Preserve the original text and mention offsets');
  assert.equal(plain.kind, 'comment');
  assert.deepEqual(plain.mentions, []);
  assert.equal(plain.taskId, task.id);
  assert.equal(plain.projectId, project.id);
  assert.deepEqual(plain.author, { id: client.user.id, name: client.user.name, avatarColor: client.user.avatarColor });
  assert.equal(plain.canEdit, true);
  assert.equal(plain.canDelete, true);
  assert.ok(!Number.isNaN(Date.parse(plain.createdAt)));
  assert.ok(!Number.isNaN(Date.parse(plain.updatedAt)));
  const caption = await addComment(client, task, { body: 'Caption for launch', kind: 'caption', mentions: [] });
  const revision = await addComment(client, task, { body: 'Revision 2: update the headline', kind: 'revision' });
  assert.equal(caption.kind, 'caption');
  assert.equal(revision.kind, 'revision');
  const savedComments = await comments(client, task);
  assert.equal(savedComments.length, 3);
  assert.deepEqual(savedComments.map((entry) => entry.id), [plain.id, caption.id, revision.id]);
  const saved = (await request(client, `/api/projects/${project.id}/tasks`)).tasks.find((entry) => entry.id === task.id);
  assert.equal(saved.commentsCount, 3);
  assert.equal((await request(client, `/api/tasks/${task.id}`, 'PATCH', { priority: 'high' })).task.commentsCount, 3);
  const json = JSON.parse((await server.app.locals.db.get('SELECT data_json FROM tasks WHERE id = ?', [task.id])).data_json);
  assert.equal(Object.hasOwn(json, 'commentsCount'), false, 'The count must be computed from comment records');
  await server.close();
  const restarted = await startServer(server.databasePath);
  try {
    const clientAfterRestart = restarted.client(client.cookie);
    assert.deepEqual(await comments(clientAfterRestart, task), savedComments);
    const persistedTask = (await request(clientAfterRestart, `/api/projects/${project.id}/tasks`)).tasks.find((entry) => entry.id === task.id);
    assert.equal(persistedTask.commentsCount, 3);
  } finally {
    await restarted.close();
  }
});

test('comment input rejects forged metadata, empty bodies, invalid kinds and oversized text without a write', async (t) => {
  const server = await fixture(t);
  const { client, project } = await demo(server);
  const task = await addTask(client, project);
  for (const input of [
    {}, { body: '' }, { body: ' \n\t ' }, { body: 42 }, { body: 'x'.repeat(10001) },
    { body: 'Text', kind: 'announcement' }, { body: 'Text', mentions: null },
    { body: 'Text', authorId: client.user.id }, { body: 'Text', projectId: project.id },
    { body: 'Text', createdAt: '2000-01-01T00:00:00.000Z' },
  ]) await request(client, `/api/tasks/${task.id}/comments`, 'POST', input, 400);
  assert.deepEqual(await comments(client, task), []);
  await request(client, `/api/projects/${project.id}/tasks`, 'POST', { title: 'Forged count', commentsCount: 9 }, 400);
  await request(client, `/api/tasks/${task.id}`, 'PATCH', { commentsCount: 9 }, 400);
  assert.equal((await request(client, `/api/projects/${project.id}/tasks`)).tasks.find((entry) => entry.id === task.id).commentsCount, 0);
  const comment = await addComment(client, task, { body: 'x'.repeat(10000) });
  assert.equal(comment.body.length, 10000);
  await request(client, `/api/tasks/${task.id}/comments/${comment.id}`, 'PATCH', {}, 400);
  await request(client, `/api/tasks/${task.id}/comments/${comment.id}`, 'PATCH', { body: '   ' }, 400);
  await request(client, `/api/tasks/${task.id}/comments/${comment.id}`, 'PATCH', { id: 'forged', body: 'New' }, 400);
  assert.deepEqual((await comments(client, task))[0], comment);
});

test('authors can edit while editors cannot change another author and owners may only moderate deletion', async (t) => {
  const server = await fixture(t);
  const { client: owner, project } = await demo(server);
  const teammates = project.members.filter((entry) => entry.role === 'editor');
  const author = await asUser(server, teammates[0].userId);
  const editor = await asUser(server, teammates[1].userId);
  const task = await addTask(owner, project);
  const comment = await addComment(author, task, { body: 'Draft caption', kind: 'caption' });
  const edited = (await request(author, `/api/tasks/${task.id}/comments/${comment.id}`, 'PATCH', { body: 'Final caption', kind: 'revision' })).comment;
  assert.equal(edited.body, 'Final caption');
  assert.equal(edited.kind, 'revision');
  assert.equal(edited.createdAt, comment.createdAt);
  assert.equal(edited.author.id, teammates[0].userId);
  const editorView = (await comments(editor, task))[0];
  assert.equal(editorView.canEdit, false);
  assert.equal(editorView.canDelete, false);
  const ownerView = (await comments(owner, task))[0];
  assert.equal(ownerView.canEdit, false);
  assert.equal(ownerView.canDelete, true);
  for (const actor of [editor, owner]) {
    await request(actor, `/api/tasks/${task.id}/comments/${comment.id}`, 'PATCH', { body: 'Unauthorized rewrite' }, 403);
  }
  await request(editor, `/api/tasks/${task.id}/comments/${comment.id}`, 'DELETE', undefined, 403);
  assert.equal((await comments(author, task))[0].body, 'Final caption');
  await request(owner, `/api/tasks/${task.id}/comments/${comment.id}`, 'DELETE', undefined, 204);
  assert.deepEqual(await comments(author, task), []);
  const own = await addComment(author, task, { body: 'My next note' });
  await request(author, `/api/tasks/${task.id}/comments/${own.id}`, 'DELETE', undefined, 204);
  assert.equal((await request(owner, `/api/projects/${project.id}/tasks`)).tasks.find((entry) => entry.id === task.id).commentsCount, 0);
});

test('a scoped superadmin can moderate another project without rewriting its comments', async (t) => {
  const server = await fixture(t);
  const { client: admin, projects } = await demo(server);
  const project = projects.find((entry) => entry.name === 'Team Operations');
  assert.notEqual(project.ownerId, admin.user.id);
  const authorId = project.members.find((entry) => entry.role === 'editor' && entry.userId !== admin.user.id).userId;
  const author = await asUser(server, authorId);
  const task = await addTask(author, project);
  const comment = await addComment(author, task, { body: 'Operations decision' });
  const adminView = (await comments(admin, task))[0];
  assert.equal(adminView.canEdit, false);
  assert.equal(adminView.canDelete, true);
  await request(admin, `/api/tasks/${task.id}/comments/${comment.id}`, 'PATCH', { body: 'Admin rewrite' }, 403);
  await request(admin, `/api/tasks/${task.id}/comments/${comment.id}`, 'DELETE', undefined, 204);
});

test('viewers can read comments but cannot create, edit or delete even their own earlier comments', async (t) => {
  const server = await fixture(t);
  const { client: owner, project } = await demo(server);
  const member = project.members.find((entry) => entry.role === 'editor');
  const viewer = await asUser(server, member.userId);
  const task = await addTask(owner, project);
  const old = await addComment(viewer, task, { body: 'Created before becoming a viewer' });
  await request(owner, `/api/projects/${project.id}/members`, 'POST', { email: member.user.email, role: 'viewer' });
  const list = await comments(viewer, task);
  assert.equal(list[0].id, old.id);
  assert.equal(list[0].canEdit, false);
  assert.equal(list[0].canDelete, false);
  await request(viewer, `/api/tasks/${task.id}/comments`, 'POST', { body: 'Viewer cannot post' }, 403);
  await request(viewer, `/api/tasks/${task.id}/comments/${old.id}`, 'PATCH', { body: 'Viewer cannot edit' }, 403);
  await request(viewer, `/api/tasks/${task.id}/comments/${old.id}`, 'DELETE', undefined, 403);
  assert.equal((await comments(owner, task))[0].body, old.body);
});

test('private project and cross-task comment IDs remain hidden and every endpoint requires a session', async (t) => {
  const server = await fixture(t);
  const { client: owner, project } = await demo(server);
  const { client: outsider } = await demo(server);
  const task = await addTask(owner, project);
  const otherTask = await addTask(owner, project);
  const comment = await addComment(owner, task, { body: 'Private project note' });
  for (const actor of [outsider, server.client()]) {
    const status = actor === outsider ? 404 : 401;
    await request(actor, `/api/tasks/${task.id}/comments`, 'GET', undefined, status);
    await request(actor, `/api/tasks/${task.id}/comments`, 'POST', { body: 'Should not appear' }, status);
    await request(actor, `/api/tasks/${task.id}/comments/${comment.id}`, 'PATCH', { body: 'Should not change' }, status);
    await request(actor, `/api/tasks/${task.id}/comments/${comment.id}`, 'DELETE', undefined, status);
  }
  await request(owner, `/api/tasks/${otherTask.id}/comments/${comment.id}`, 'PATCH', { body: 'Wrong task' }, 404);
  await request(owner, `/api/tasks/${otherTask.id}/comments/${comment.id}`, 'DELETE', undefined, 404);
  await request(owner, '/api/tasks/does-not-exist/comments', 'GET', undefined, 404);
  await request(owner, '/api/tasks/does-not-exist/comments', 'POST', { body: 'Missing task' }, 404);
  assert.equal((await comments(owner, task))[0].body, comment.body);
});

test('UTF-16 mention ranges preserve Thai and emoji text and notify unique recipients excluding the author', async (t) => {
  const server = await fixture(t);
  const { client: owner, project } = await demo(server);
  const recipient = project.members.find((entry) => entry.role === 'editor');
  const recipientClient = await asUser(server, recipient.userId);
  const task = await addTask(owner, project, { title: 'ตรวจ Caption ก่อนโพสต์' });
  const first = `@${recipient.user.name}`;
  const self = `@${owner.user.name}`;
  const body = `🎬 ช่วยตรวจ ${first} แล้ว ${first} ส่งให้ ${self}`;
  const firstMention = mention(recipient.userId, body, first);
  const secondMention = mention(recipient.userId, body, first, firstMention.end);
  const ownMention = mention(owner.user.id, body, self);
  const comment = await addComment(owner, task, { body, kind: 'caption', mentions: [firstMention, secondMention, ownMention] });
  assert.deepEqual(comment.mentions, [
    { ...firstMention, name: recipient.user.name }, { ...secondMention, name: recipient.user.name }, { ...ownMention, name: owner.user.name },
  ]);
  for (const entry of comment.mentions) assert.ok(comment.body.slice(entry.start, entry.end).startsWith('@'));
  const notices = await mentionNotices(recipientClient, task);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].commentId, comment.id);
  assert.equal(notices[0].userId, recipient.userId);
  assert.equal(notices[0].actorId, owner.user.id);
  assert.equal(notices[0].projectId, project.id);
  assert.equal(notices[0].taskId, task.id);
  assert.equal(notices[0].title, task.title);
  assert.equal(notices[0].readAt, null);
  assert.equal((await mentionNotices(owner, task)).length, 0);
});

test('malformed or overlapping mention ranges are rejected atomically before comments or notifications are saved', async (t) => {
  const server = await fixture(t);
  const { client: owner, project } = await demo(server);
  const member = project.members.find((entry) => entry.role === 'editor');
  const recipient = await asUser(server, member.userId);
  const task = await addTask(owner, project);
  const label = `@${member.user.name}`;
  const body = `${label} review`;
  const valid = { userId: member.userId, start: 0, end: label.length };
  const invalidMentions = [
    [{ ...valid, start: -1 }], [{ ...valid, start: 0.5 }], [{ ...valid, end: 1.5 }],
    [{ ...valid, end: body.length + 1 }], [{ ...valid, start: 2, end: 2 }], [{ ...valid, start: label.length + 1, end: body.length }],
    [{ ...valid, start: 3, end: 1 }], [{ ...valid, userId: 'unknown-user' }],
    [valid, { ...valid, start: 0, end: 2 }], [valid, valid],
    [{ ...valid, name: 'Forged recipient name' }], [{ ...valid, start: '0' }],
  ];
  for (const mentions of invalidMentions) await request(owner, `/api/tasks/${task.id}/comments`, 'POST', { body, mentions }, 400);
  const manyBody = Array.from({ length: 21 }, () => label).join(' ');
  const many = Array.from({ length: 21 }, (_, index) => ({ userId: member.userId, start: index * (label.length + 1), end: index * (label.length + 1) + label.length }));
  await request(owner, `/api/tasks/${task.id}/comments`, 'POST', { body: manyBody, mentions: many }, 400);
  assert.deepEqual(await comments(owner, task), []);
  assert.deepEqual(await mentionNotices(recipient, task), []);
  const comment = await addComment(owner, task, { body: 'Stored note' });
  await request(owner, `/api/tasks/${task.id}/comments/${comment.id}`, 'PATCH', { body, mentions: [valid, valid] }, 400);
  assert.deepEqual((await comments(owner, task))[0], comment);
  assert.deepEqual(await mentionNotices(recipient, task), []);
});

test('mention targets must be active verified project participants in the same scope', async (t) => {
  const server = await fixture(t);
  const { client: owner, project } = await demo(server);
  const { client: foreignUser } = await demo(server);
  const members = project.members.filter((entry) => entry.role === 'editor');
  const task = await addTask(owner, project);
  const input = (userId, name) => ({ body: `@${name} review`, mentions: [{ userId, start: 0, end: name.length + 1 }] });
  for (const member of members) {
    const control = await addComment(owner, task, input(member.userId, member.user.name));
    await request(owner, `/api/tasks/${task.id}/comments/${control.id}`, 'DELETE', undefined, 204);
  }
  await server.app.locals.db.run('UPDATE users SET disabled_at = ? WHERE id = ?', [new Date().toISOString(), members[0].userId]);
  await request(owner, `/api/tasks/${task.id}/comments`, 'POST', input(members[0].userId, members[0].user.name), 400);
  await server.app.locals.db.run('UPDATE users SET email_verified = 0 WHERE id = ?', [members[1].userId]);
  await request(owner, `/api/tasks/${task.id}/comments`, 'POST', input(members[1].userId, members[1].user.name), 400);
  await request(owner, `/api/projects/${project.id}/members/${members[2].userId}`, 'DELETE');
  await request(owner, `/api/tasks/${task.id}/comments`, 'POST', input(members[2].userId, members[2].user.name), 400);
  await request(owner, `/api/tasks/${task.id}/comments`, 'POST', input(foreignUser.user.id, foreignUser.user.name), 400);
  // A malformed legacy membership must not bypass the separate demo-scope check.
  await server.app.locals.db.run('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)', [project.id, foreignUser.user.id, 'editor']);
  await request(owner, `/api/tasks/${task.id}/comments`, 'POST', input(foreignUser.user.id, foreignUser.user.name), 400);
  assert.deepEqual(await comments(owner, task), []);
});

test('mention labels must match complete names and ranges cannot split emoji surrogate pairs', async (t) => {
  const server = await fixture(t);
  const { client: owner, project } = await demo(server);
  const member = project.members.find((entry) => entry.role === 'editor');
  const name = 'Nat 🎬 Studio';
  await request(owner, `/api/admin/users/${member.userId}`, 'PATCH', { name });
  const task = await addTask(owner, project);
  const label = `@${name}`;
  const body = `Ready ${label} review`;
  const valid = mention(member.userId, body, label);
  const emojiStart = body.indexOf('🎬');
  for (const range of [
    { ...valid, end: emojiStart + 1 },
    { ...valid, start: emojiStart + 1 },
    { ...valid, end: valid.end - 1 },
  ]) await request(owner, `/api/tasks/${task.id}/comments`, 'POST', { body, mentions: [range] }, 400);
  await request(owner, `/api/tasks/${task.id}/comments`, 'POST', { body: '@Someone else', mentions: [{ userId: member.userId, start: 0, end: 13 }] }, 400);
  const comment = await addComment(owner, task, { body, mentions: [valid] });
  assert.deepEqual(comment.mentions, [{ ...valid, name }]);
  assert.equal(comment.body.slice(comment.mentions[0].start, comment.mentions[0].end), label);
});

test('renaming a teammate preserves historical mentions during edits and new mentions use the current name', async (t) => {
  const server = await fixture(t);
  const { client: owner, project } = await demo(server);
  const member = project.members.find((entry) => entry.role === 'editor');
  const recipient = await asUser(server, member.userId);
  const task = await addTask(owner, project);
  const label = `@${member.user.name}`;
  const body = `${label} please review`;
  const range = mention(member.userId, body, label);
  const comment = await addComment(owner, task, { body, mentions: [range] });
  await request(owner, `/api/admin/users/${member.userId}`, 'PATCH', { name: 'Renamed teammate' });
  const edited = (await request(owner, `/api/tasks/${task.id}/comments/${comment.id}`, 'PATCH', { kind: 'revision', mentions: [range] })).comment;
  assert.deepEqual(edited.mentions, comment.mentions);
  assert.equal((await mentionNotices(recipient, task)).length, 1);
  const movedBody = `📝 แก้ไข ${body}`;
  const movedRange = mention(member.userId, movedBody, label);
  const moved = (await request(owner, `/api/tasks/${task.id}/comments/${comment.id}`, 'PATCH', { body: movedBody, mentions: [movedRange] })).comment;
  assert.deepEqual(moved.mentions, [{ ...movedRange, name: member.user.name }]);
  assert.equal((await mentionNotices(recipient, task)).length, 1, 'Moving the existing mention must not notify again');
  const otherMember = project.members.find((entry) => entry.role === 'editor' && entry.userId !== member.userId);
  await request(owner, `/api/tasks/${task.id}/comments/${comment.id}`, 'PATCH', { body: movedBody, mentions: [{ ...movedRange, userId: otherMember.userId }] }, 400);
  assert.deepEqual((await comments(owner, task))[0], moved);
  await request(owner, `/api/tasks/${task.id}/comments`, 'POST', { body, mentions: [range] }, 400);
  const nextBody = '@Renamed teammate please review';
  const current = await addComment(owner, task, { body: nextBody, mentions: [mention(member.userId, nextBody, '@Renamed teammate')] });
  assert.equal(current.mentions[0].name, 'Renamed teammate');
  assert.equal((await mentionNotices(recipient, task)).length, 2);
});

test('deleting one comment removes its mention notices while preserving another comment and notice', async (t) => {
  const server = await fixture(t);
  const { client: owner, project } = await demo(server);
  const member = project.members.find((entry) => entry.role === 'editor');
  const recipient = await asUser(server, member.userId);
  const task = await addTask(owner, project);
  const body = `@${member.user.name} please review`;
  const input = { body, mentions: [mention(member.userId, body, `@${member.user.name}`)] };
  const first = await addComment(owner, task, input);
  const retained = await addComment(owner, task, input);
  assert.equal((await mentionNotices(recipient, task)).length, 2);
  await request(owner, `/api/tasks/${task.id}/comments/${first.id}`, 'DELETE', undefined, 204);
  const notices = await mentionNotices(recipient, task);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].commentId, retained.id);
  assert.equal((await server.app.locals.db.get('SELECT COUNT(*) AS count FROM notifications WHERE comment_id = ?', [first.id])).count, 0);
  assert.deepEqual((await comments(owner, task)).map((entry) => entry.id), [retained.id]);
  assert.equal((await request(owner, `/api/projects/${project.id}/tasks`)).tasks.find((entry) => entry.id === task.id).commentsCount, 1);
});

test('editing mentions only notifies newly introduced recipients and body-only edits clear stale ranges', async (t) => {
  const server = await fixture(t);
  const { client: owner, project } = await demo(server);
  const members = project.members.filter((entry) => entry.role === 'editor');
  const first = await asUser(server, members[0].userId);
  const second = await asUser(server, members[1].userId);
  const task = await addTask(owner, project);
  const firstText = `@${members[0].user.name}`;
  const secondText = `@${members[1].user.name}`;
  const body = `${firstText} please review`;
  const initial = mention(members[0].userId, body, firstText);
  const comment = await addComment(owner, task, { body, mentions: [initial] });
  const firstNotice = (await mentionNotices(first, task))[0];
  await request(first, `/api/notifications/${firstNotice.id}/read`, 'PATCH');
  const kindOnly = (await request(owner, `/api/tasks/${task.id}/comments/${comment.id}`, 'PATCH', { kind: 'revision' })).comment;
  assert.equal(kindOnly.body, body);
  assert.deepEqual(kindOnly.mentions, comment.mentions);
  assert.equal((await mentionNotices(first, task)).length, 1);
  const nextBody = `${firstText} and ${secondText} please review`;
  const nextMentions = [mention(members[0].userId, nextBody, firstText), mention(members[1].userId, nextBody, secondText)];
  await request(owner, `/api/tasks/${task.id}/comments/${comment.id}`, 'PATCH', { body: nextBody, mentions: nextMentions });
  assert.equal((await mentionNotices(first, task)).length, 1);
  assert.ok((await mentionNotices(first, task))[0].readAt, 'An unchanged mention must not reset the recipient’s read state');
  assert.equal((await mentionNotices(second, task)).length, 1);
  await request(owner, `/api/tasks/${task.id}/comments/${comment.id}`, 'PATCH', { body: nextBody, mentions: nextMentions });
  assert.equal((await mentionNotices(second, task)).length, 1);
  const cleared = (await request(owner, `/api/tasks/${task.id}/comments/${comment.id}`, 'PATCH', { body: 'No mentions in the revised text' })).comment;
  assert.deepEqual(cleared.mentions, []);
  assert.equal(cleared.kind, 'revision');
  await request(owner, `/api/tasks/${task.id}/comments/${comment.id}`, 'DELETE', undefined, 204);
  assert.deepEqual(await mentionNotices(first, task), []);
  assert.deepEqual(await mentionNotices(second, task), []);
});

test('revoking membership hides the thread and mention notifications without deleting the shared comments', async (t) => {
  const server = await fixture(t);
  const { client: owner, project } = await demo(server);
  const member = project.members.find((entry) => entry.role === 'editor');
  const author = await asUser(server, member.userId);
  const task = await addTask(owner, project);
  const own = await addComment(author, task, { body: 'Keep this team discussion' });
  const body = `@${member.user.name} action required`;
  await addComment(owner, task, { body, mentions: [mention(member.userId, body, `@${member.user.name}`)] });
  const notice = (await mentionNotices(author, task))[0];
  assert.ok(notice);
  await request(owner, `/api/projects/${project.id}/members/${member.userId}`, 'DELETE');
  await request(author, `/api/tasks/${task.id}/comments`, 'GET', undefined, 404);
  await request(author, `/api/tasks/${task.id}/comments`, 'POST', { body: 'Former member' }, 404);
  await request(author, `/api/tasks/${task.id}/comments/${own.id}`, 'PATCH', { body: 'Former member rewrite' }, 404);
  await request(author, `/api/tasks/${task.id}/comments/${own.id}`, 'DELETE', undefined, 404);
  assert.deepEqual(await mentionNotices(author, task), []);
  await request(author, `/api/notifications/${notice.id}/read`, 'PATCH', undefined, 404);
  assert.equal((await comments(owner, task)).length, 2);
});

test('deleting an author preserves the comment name and avatar snapshot for the project', async (t) => {
  const server = await fixture(t);
  const { client: owner, project } = await demo(server);
  const member = project.members.find((entry) => entry.user.name === 'Nat Studio');
  const author = await asUser(server, member.userId);
  const task = await addTask(owner, project);
  const comment = await addComment(author, task, { body: 'Decision to preserve after account deletion' });
  await request(owner, `/api/admin/users/${member.userId}`, 'DELETE', undefined, 204);
  const preserved = (await comments(owner, task))[0];
  assert.equal(preserved.id, comment.id);
  assert.equal(preserved.body, comment.body);
  assert.deepEqual(preserved.author, { id: null, name: member.user.name, avatarColor: member.user.avatarColor });
  assert.equal(preserved.canEdit, false);
  assert.equal(preserved.canDelete, true);
  assert.equal((await request(owner, `/api/projects/${project.id}/tasks`)).tasks.find((entry) => entry.id === task.id).commentsCount, 1);
  await request(author, `/api/tasks/${task.id}/comments`, 'GET', undefined, 401);
});

test('task and project deletion remove comment threads and their mention notices', async (t) => {
  const server = await fixture(t);
  const { client: owner, project } = await demo(server);
  const member = project.members.find((entry) => entry.role === 'editor');
  const recipient = await asUser(server, member.userId);
  const body = `@${member.user.name} check the brief`;
  const input = { body, mentions: [mention(member.userId, body, `@${member.user.name}`)] };
  const task = await addTask(owner, project);
  const comment = await addComment(owner, task, input);
  await request(owner, `/api/tasks/${task.id}`, 'DELETE', undefined, 204);
  await request(owner, `/api/tasks/${task.id}/comments`, 'GET', undefined, 404);
  await request(owner, `/api/tasks/${task.id}/comments/${comment.id}`, 'DELETE', undefined, 404);
  assert.equal((await server.app.locals.db.get('SELECT COUNT(*) AS count FROM task_comments WHERE task_id = ?', [task.id])).count, 0);
  assert.deepEqual(await mentionNotices(recipient, task), []);
  assert.equal((await server.app.locals.db.get('SELECT COUNT(*) AS count FROM notifications WHERE task_id = ?', [task.id])).count, 0);
  const second = await addTask(owner, project);
  await addComment(owner, second, input);
  await request(owner, `/api/projects/${project.id}`, 'DELETE', undefined, 204);
  await request(owner, `/api/tasks/${second.id}/comments`, 'GET', undefined, 404);
  assert.equal((await server.app.locals.db.get('SELECT COUNT(*) AS count FROM task_comments WHERE project_id = ?', [project.id])).count, 0);
  assert.deepEqual(await mentionNotices(recipient, second), []);
  assert.equal((await server.app.locals.db.get('SELECT COUNT(*) AS count FROM notifications WHERE project_id = ?', [project.id])).count, 0);
});

test('additive comment migration retains original tasks, users, sessions and old notification rows', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'teamflow-comments-legacy-test-'));
  const databasePath = join(directory, 'legacy.sqlite');
  let db;
  let server;
  t.after(async () => {
    await server?.close();
    await db?.close();
    await rm(directory, { recursive: true, force: true });
  });
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, avatar_color TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, color TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, fields_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE project_members (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL, PRIMARY KEY (project_id, user_id));
    CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, data_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, actor_id TEXT REFERENCES users(id) ON DELETE SET NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT);
  `);
  const now = '2026-10-08T10:00:00.000Z';
  const originalTask = {
    id: 'legacy-task', projectId: 'legacy-project', title: 'Original task title', description: 'Keep the old brief',
    status: 'todo', priority: 'normal', dueDate: null, assigneeId: null, contentType: '', channel: '',
    links: [], subtasks: [], customFields: {}, createdAt: now, updatedAt: now,
  };
  for (const [id, name] of [['legacy-owner', 'Legacy Owner'], ['legacy-member', 'Legacy Member']]) {
    legacy.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run(id, name, `${id}@example.com`, 'preserved-hash', '#f97316', now);
  }
  legacy.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('original-session-hash', 'legacy-owner', '2030-01-01T00:00:00.000Z');
  legacy.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?)').run(originalTask.projectId, 'Original project', 'Original description', '#f97316', 'legacy-owner', '[]', now);
  legacy.prepare('INSERT INTO project_members VALUES (?, ?, ?)').run(originalTask.projectId, 'legacy-member', 'editor');
  legacy.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?)').run(originalTask.id, originalTask.projectId, JSON.stringify(originalTask), now, now);
  const oldNotice = { id: 'legacy-notification', user_id: 'legacy-member', actor_id: 'legacy-owner', project_id: originalTask.projectId, task_id: originalTask.id, type: 'assignment', title: originalTask.title, body: 'Original assignment message', created_at: now, read_at: now };
  legacy.prepare('INSERT INTO notifications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...Object.values(oldNotice));
  legacy.close();
  db = await openDatabase({ databasePath, databaseUrl: '' });
  const notification = await db.get('SELECT * FROM notifications WHERE id = ?', [oldNotice.id]);
  for (const [key, value] of Object.entries(oldNotice)) assert.equal(notification[key], value);
  assert.equal(notification.comment_id, null);
  assert.ok((await db.all('PRAGMA table_info(notifications)')).some((column) => column.name === 'comment_id'));
  assert.ok((await db.all("SELECT name FROM sqlite_master WHERE type = 'table'")).some((table) => /comments/.test(table.name)));
  assert.equal((await db.get('SELECT password_hash FROM users WHERE id = ?', ['legacy-owner'])).password_hash, 'preserved-hash');
  assert.equal((await db.get('SELECT token_hash FROM sessions WHERE user_id = ?', ['legacy-owner'])).token_hash, 'original-session-hash');
  const taskAfterMigration = JSON.parse((await db.get('SELECT data_json FROM tasks WHERE id = ?', [originalTask.id])).data_json);
  for (const [key, value] of Object.entries(originalTask)) assert.deepEqual(taskAfterMigration[key], value);
  await db.run("UPDATE users SET email_verified = 1, email_verified_mode = 'preview'");
  await db.close();
  db = undefined;
  server = await startServer(databasePath);
  const owner = await asUser(server, 'legacy-owner');
  const member = await asUser(server, 'legacy-member');
  assert.deepEqual(await comments(owner, originalTask), []);
  assert.equal((await request(owner, `/api/projects/${originalTask.projectId}/tasks`)).tasks[0].commentsCount, 0);
  const body = '@Legacy Member please review';
  const comment = await addComment(owner, originalTask, { body, mentions: [mention('legacy-member', body, '@Legacy Member')] });
  assert.equal((await mentionNotices(member, originalTask))[0].commentId, comment.id);
  const legacyNotice = (await request(member, '/api/notifications')).notifications.find((entry) => entry.id === oldNotice.id);
  assert.equal(legacyNotice.body, oldNotice.body);
  assert.equal(legacyNotice.readAt, oldNotice.read_at);
  assert.equal(legacyNotice.commentId, null);
});
