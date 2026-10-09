import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from './app.js';
import { createMailer } from './mailer.js';

const PASSWORD = 'Room-password-2026';
const NEW_PASSWORD = 'New-Room-password-2026';

async function fixture(t, options = {}) {
  const app = await createApp({ databasePath: ':memory:', databaseUrl: '', disableRateLimit: true, mailMode: 'preview', superadminEmail: 'admin@example.com', distPath: '/nonexistent-account-test-dist', ...options });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    await app.locals.close();
  };
  t.after(close);
  return {
    db: app.locals.db,
    close,
    client(cookie = '') {
      return {
        cookie,
        async request(path, method = 'GET', body) {
          const response = await fetch(`${base}/api${path}`, {
            method, headers: { ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          const setCookie = response.headers.getSetCookie()[0];
          if (setCookie) this.cookie = setCookie.split(';')[0];
          const data = response.status === 204 ? null : await response.json();
          return { status: response.status, data };
        },
      };
    },
  };
}
async function expect(client, path, method = 'GET', body, status = 200) {
  const result = await client.request(path, method, body);
  assert.equal(result.status, status, `${method} ${path}: ${JSON.stringify(result.data)}`);
  return result.data;
}
async function mailToken(client, kind) {
  const inbox = await expect(client, '/auth/mail-preview');
  assert.equal(inbox.mode, 'preview');
  const message = inbox.messages.find((entry) => entry.kind === kind);
  assert.ok(message, `Preview inbox contains ${kind} message`);
  return new URL(message.actionUrl).searchParams.get('token');
}
async function register(server, email, verified = true) {
  const client = server.client();
  const data = await expect(client, '/auth/register', 'POST', { name: email.split('@')[0], email, password: PASSWORD }, 201);
  client.user = data.user;
  if (verified) client.user = (await expect(client, '/auth/verify-email', 'POST', { token: await mailToken(client, 'verify') })).user;
  return client;
}
async function fixtureAdmin(server) {
  const client = await register(server, 'admin@example.com');
  // Fixture-only provisioning: simulated email verification never grants real administrator access.
  await server.db.run('UPDATE users SET global_role = ? WHERE id = ?', ['superadmin', client.user.id]);
  client.user.globalRole = 'superadmin';
  return client;
}

test('verification gates project data, stores hashed single-use links and never promotes the first signup', async (t) => {
  const server = await fixture(t);
  const user = await register(server, 'first@example.com', false);
  assert.equal(user.user.emailVerified, false);
  assert.equal(user.user.globalRole, 'member');
  assert.equal((await expect(user, '/projects', 'GET', undefined, 403)).code, 'EMAIL_NOT_VERIFIED');
  await expect(user, '/projects', 'POST', { name: 'Too early' }, 403);
  const token = await mailToken(user, 'verify');
  const stored = await server.db.get('SELECT * FROM account_tokens WHERE user_id = ?', [user.user.id]);
  assert.equal(stored.token_hash, createHash('sha256').update(token).digest('hex'));
  assert.notEqual(stored.token_hash, token);
  assert.equal(stored.issued_mode, 'preview');
  const data = await expect(user, '/auth/verify-email', 'POST', { token });
  assert.equal(data.user.emailVerified, true);
  assert.equal(data.user.globalRole, 'member');
  await expect(user, '/auth/verify-email', 'POST', { token }, 400);
  await expect(user, '/projects', 'POST', { name: 'Verified project' }, 201);
  const admin = await register(server, 'ADMIN@example.com');
  assert.equal(admin.user.globalRole, 'member', 'Preview email ownership must not grant a real administrator role');
});

test('expired and replaced verification links cannot be redeemed; inbox messages stay private', async (t) => {
  const server = await fixture(t);
  const user = await register(server, 'pending@example.com', false);
  const token = await mailToken(user, 'verify');
  await server.db.run('UPDATE account_tokens SET expires_at = ? WHERE user_id = ?', ['2000-01-01T00:00:00.000Z', user.user.id]);
  assert.equal((await expect(user, '/auth/verify-email', 'POST', { token }, 400)).code, 'INVALID_TOKEN');
  await expect(user, '/auth/resend-verification', 'POST');
  const replacement = await mailToken(user, 'verify');
  assert.notEqual(replacement, token);
  await expect(user, '/auth/verify-email', 'POST', { token }, 400);
  const unrelated = await register(server, 'private@example.com', false);
  const inbox = await expect(unrelated, '/auth/mail-preview');
  assert.equal(inbox.messages.length, 1);
  assert.equal(inbox.messages[0].to, unrelated.user.email);
  await expect(server.client(), '/auth/mail-preview', 'GET', undefined, 401);
  await expect(user, '/auth/verify-email', 'POST', { token: replacement });
});

test('password recovery returns uniform responses, invalidates sessions and permits one reset only', async (t) => {
  const server = await fixture(t);
  const user = await register(server, 'reset@example.com');
  const second = server.client();
  await expect(second, '/auth/login', 'POST', { email: user.user.email, password: PASSWORD });
  const oldFirst = server.client(user.cookie);
  const oldSecond = server.client(second.cookie);
  const publicClient = server.client();
  const known = await expect(publicClient, '/auth/forgot-password', 'POST', { email: user.user.email });
  const unknown = await expect(publicClient, '/auth/forgot-password', 'POST', { email: 'unknown@example.com' });
  assert.deepEqual(known, unknown);
  assert.deepEqual(Object.keys(known).sort(), ['mailMode', 'message']);
  const token = await mailToken(user, 'reset');
  await server.db.run('UPDATE account_tokens SET expires_at = ? WHERE kind = ? AND user_id = ?', ['2000-01-01T00:00:00.000Z', 'reset', user.user.id]);
  await expect(publicClient, '/auth/reset-password', 'POST', { token, password: NEW_PASSWORD }, 400);
  await expect(publicClient, '/auth/forgot-password', 'POST', { email: user.user.email });
  const currentToken = await mailToken(user, 'reset');
  const results = await Promise.all([
    publicClient.request('/auth/reset-password', 'POST', { token: currentToken, password: NEW_PASSWORD }),
    server.client().request('/auth/reset-password', 'POST', { token: currentToken, password: NEW_PASSWORD }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 400]);
  await expect(oldFirst, '/auth/me', 'GET', undefined, 401);
  await expect(oldSecond, '/auth/me', 'GET', undefined, 401);
  await expect(user, '/auth/login', 'POST', { email: user.user.email, password: PASSWORD }, 401);
  await expect(user, '/auth/login', 'POST', { email: user.user.email, password: NEW_PASSWORD });
});

test('administration is scoped and suspension immediately revokes access without destroying project history', async (t) => {
  const server = await fixture(t);
  const admin = await fixtureAdmin(server);
  const user = await register(server, 'member@example.com');
  const project = (await expect(user, '/projects', 'POST', { name: 'Keep my project' }, 201)).project;
  await expect(user, '/admin/users', 'GET', undefined, 403);
  const demo1 = server.client();
  const demo2 = server.client();
  const first = await expect(demo1, '/auth/demo', 'POST', undefined, 201);
  const second = await expect(demo2, '/auth/demo', 'POST', undefined, 201);
  const realUsers = (await expect(admin, '/admin/users')).users;
  assert.deepEqual(realUsers.map((entry) => entry.id).sort(), [admin.user.id, user.user.id].sort());
  const demoUsers = (await expect(demo1, '/admin/users')).users;
  assert.equal(demoUsers.length, 4);
  assert.ok(demoUsers.every((entry) => entry.demoScopeId === first.user.demoScopeId));
  assert.ok(demoUsers.every((entry) => entry.id !== second.user.id && entry.id !== admin.user.id));
  await expect(demo1, `/admin/users/${user.user.id}`, 'PATCH', { disabled: true }, 404);
  await expect(admin, `/admin/users/${first.user.id}`, 'DELETE', {}, 404);
  await expect(admin, `/admin/users/${admin.user.id}`, 'PATCH', { disabled: true }, 400);
  await expect(admin, `/admin/users/${admin.user.id}`, 'DELETE', {}, 400);
  const old = server.client(user.cookie);
  const result = await expect(admin, `/admin/users/${user.user.id}`, 'PATCH', { name: 'Former teammate', disabled: true });
  assert.equal(result.user.disabled, true);
  await expect(old, '/auth/me', 'GET', undefined, 401);
  await expect(user, '/auth/login', 'POST', { email: user.user.email, password: PASSWORD }, 401);
  assert.ok(await server.db.get('SELECT id FROM projects WHERE id = ?', [project.id]));
  await expect(admin, `/admin/users/${user.user.id}`, 'PATCH', { disabled: false });
  await expect(user, '/auth/login', 'POST', { email: user.user.email, password: PASSWORD });
  assert.equal((await expect(user, `/projects/${project.id}`)).project.id, project.id);
  const audit = await server.db.all('SELECT action FROM audit_log WHERE target_user_id = ?', [user.user.id]);
  assert.deepEqual(audit.map((row) => row.action), ['user.suspend', 'user.reactivate']);
});

test('deleting a project owner requires a valid transfer and strips all old task assignments', async (t) => {
  const server = await fixture(t);
  const admin = await fixtureAdmin(server);
  const departed = await register(server, 'departed@example.com');
  const nextOwner = await register(server, 'newowner@example.com');
  const pending = await register(server, 'pending@example.com', false);
  const project = (await expect(departed, '/projects', 'POST', { name: 'Preserve this work' }, 201)).project;
  await expect(departed, `/projects/${project.id}/members`, 'POST', { email: nextOwner.user.email, role: 'editor' });
  const task = (await expect(departed, `/projects/${project.id}/tasks`, 'POST', { title: 'Keep the task', assigneeIds: [departed.user.id, nextOwner.user.id] }, 201)).task;
  assert.equal((await expect(admin, `/admin/users/${departed.user.id}`, 'DELETE', {}, 409)).code, 'OWNER_TRANSFER_REQUIRED');
  assert.ok(await server.db.get('SELECT id FROM users WHERE id = ?', [departed.user.id]));
  await expect(admin, `/admin/users/${departed.user.id}`, 'DELETE', { transferToUserId: pending.user.id }, 400);
  assert.equal((await server.db.get('SELECT owner_id FROM projects WHERE id = ?', [project.id])).owner_id, departed.user.id);
  await expect(admin, `/admin/users/${departed.user.id}`, 'DELETE', { transferToUserId: nextOwner.user.id }, 204);
  assert.equal(await server.db.get('SELECT id FROM users WHERE id = ?', [departed.user.id]), undefined);
  const transferred = (await expect(nextOwner, `/projects/${project.id}`)).project;
  assert.equal(transferred.ownerId, nextOwner.user.id);
  assert.equal(transferred.members.filter((member) => member.userId === nextOwner.user.id).length, 1);
  const preservedTask = (await expect(nextOwner, `/projects/${project.id}/tasks`)).tasks.find((entry) => entry.id === task.id);
  assert.deepEqual(preservedTask.assigneeIds, [nextOwner.user.id]);
  const audit = await server.db.get('SELECT * FROM audit_log WHERE target_user_id = ? AND action = ?', [departed.user.id, 'user.delete']);
  assert.equal(JSON.parse(audit.details_json).transferredProjectCount, 1);
});

test('a suspended account cannot redeem an earlier recovery link or request an administrator promotion', async (t) => {
  const server = await fixture(t);
  const admin = await fixtureAdmin(server);
  const user = await register(server, 'suspend@example.com');
  await expect(user, '/auth/forgot-password', 'POST', { email: user.user.email });
  const token = await mailToken(user, 'reset');
  await expect(admin, `/admin/users/${user.user.id}`, 'PATCH', { globalRole: 'superadmin' }, 403);
  await expect(admin, `/admin/users/${user.user.id}`, 'PATCH', { disabled: true });
  await expect(server.client(), '/auth/reset-password', 'POST', { token, password: NEW_PASSWORD }, 400);
  assert.ok((await server.db.get('SELECT disabled_at FROM users WHERE id = ?', [user.user.id])).disabled_at);
  await expect(admin, `/admin/users/${user.user.id}`, 'PATCH', { disabled: false });
  await expect(server.client(), '/auth/reset-password', 'POST', { token, password: NEW_PASSWORD }, 400);
});

test('concurrent administrators cannot suspend each other and leave the system without an active administrator', async (t) => {
  const server = await fixture(t);
  const first = await fixtureAdmin(server);
  const second = await register(server, 'secondadmin@example.com');
  // Existing administrator accounts can be provisioned by the owner outside the public API.
  await server.db.run('UPDATE users SET global_role = ? WHERE id = ?', ['superadmin', second.user.id]);
  const results = await Promise.all([
    first.request(`/admin/users/${second.user.id}`, 'PATCH', { disabled: true }),
    second.request(`/admin/users/${first.user.id}`, 'PATCH', { disabled: true }),
  ]);
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  assert.ok(results.some((result) => [401, 403].includes(result.status)), 'The suspended actor loses authentication or administrator access immediately');
  const active = await server.db.all('SELECT id FROM users WHERE global_role = ? AND disabled_at IS NULL AND email_verified = 1', ['superadmin']);
  assert.equal(active.length, 1);
});

test('production refuses missing email settings and never exposes preview inboxes or untrusted email origins', async (t) => {
  const unavailable = await fixture(t, { mailMode: 'resend', resendApiKey: '', mailFrom: '', appUrl: '' });
  const client = unavailable.client();
  const registration = await expect(client, '/auth/register', 'POST', { name: 'Blocked', email: 'blocked@example.com', password: PASSWORD }, 503);
  assert.equal(registration.code, 'EMAIL_SERVICE_UNAVAILABLE');
  assert.equal((await unavailable.db.all('SELECT * FROM users')).length, 0);
  await expect(client, '/auth/forgot-password', 'POST', { email: 'anything@example.com' }, 503);
  const sent = [];
  const configured = await fixture(t, { mailMode: 'resend', resendApiKey: 'test-provider-key', mailFrom: 'Room <room@example.com>', appUrl: 'https://room.example.com', mailFetch: async (url, options) => { sent.push({ url, options }); return { ok: true }; } });
  const productionUser = configured.client();
  const result = await expect(productionUser, '/auth/register', 'POST', { name: 'Production', email: 'admin@example.com', password: PASSWORD }, 201);
  assert.equal(result.mailMode, 'resend');
  assert.equal(result.user.emailVerified, false);
  assert.equal('token' in result, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.resend.com/emails');
  assert.ok(JSON.parse(sent[0].options.body).text.includes('https://room.example.com/?action=verify-email&token='));
  assert.equal((await configured.db.all('SELECT * FROM mail_outbox')).length, 0);
  await expect(productionUser, '/auth/mail-preview', 'GET', undefined, 404);
  const actionUrl = JSON.parse(sent[0].options.body).text.match(/https:\/\/room\.example\.com\/\?action=verify-email&token=[a-f0-9]{64}/)[0];
  const verified = await expect(productionUser, '/auth/verify-email', 'POST', { token: new URL(actionUrl).searchParams.get('token') });
  assert.equal(verified.user.globalRole, 'superadmin', 'Configured administrator requires a real provider verification flow');
  assert.throws(() => createMailer({ mailMode: 'resend', resendApiKey: 'test', mailFrom: 'Room <room@example.com>', appUrl: 'http://unsafe.example.com' }).assertReady(), { code: 'EMAIL_SERVICE_UNAVAILABLE' });
});

test('switching preview storage to real email requires fresh verification and rejects all simulated account links', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'room-email-mode-test-'));
  let preview;
  let production;
  t.after(async () => {
    await preview?.close();
    await production?.close();
    await rm(directory, { recursive: true, force: true });
  });
  const databasePath = join(directory, 'same-database.sqlite');
  const superadminEmail = 'info@cosmdskin.com';
  preview = await fixture(t, { databasePath, superadminEmail });
  const user = await register(preview, superadminEmail);
  assert.equal(user.user.emailVerified, true);
  assert.equal(user.user.globalRole, 'member');
  const proof = await preview.db.get('SELECT email_verified_mode FROM users WHERE id = ?', [user.user.id]);
  assert.equal(proof.email_verified_mode, 'preview');
  await expect(user, '/projects', 'POST', { name: 'Saved preview workspace' }, 201);
  await expect(user, '/auth/forgot-password', 'POST', { email: superadminEmail });
  const previewReset = await mailToken(user, 'reset');
  const pending = await register(preview, 'pending-mode@example.com', false);
  const previewVerification = await mailToken(pending, 'verify');
  const savedCookie = user.cookie;
  await preview.close();
  const sent = [];
  production = await fixture(t, { databasePath, superadminEmail, mailMode: 'resend', resendApiKey: 'test-provider-key', mailFrom: 'Room <info@cosmdskin.com>', appUrl: 'https://room.example.com',
    mailFetch: async (url, options) => { sent.push(JSON.parse(options.body)); return { ok: true }; },
  });
  const restored = production.client(savedCookie);
  const session = await expect(restored, '/auth/me');
  assert.equal(session.user.emailVerified, false, 'Simulated email ownership must not survive into real delivery mode');
  await expect(restored, '/projects', 'GET', undefined, 403);
  const login = await expect(restored, '/auth/login', 'POST', { email: superadminEmail, password: PASSWORD });
  assert.equal(login.verificationRequired, true);
  await expect(production.client(), '/auth/verify-email', 'POST', { token: previewVerification }, 400);
  await expect(production.client(), '/auth/reset-password', 'POST', { token: previewReset, password: NEW_PASSWORD }, 400);
  await expect(restored, '/auth/resend-verification', 'POST');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, [superadminEmail]);
  const actionUrl = sent[0].text.match(/https:\/\/room\.example\.com\/\?action=verify-email&token=[a-f0-9]{64}/)[0];
  const token = new URL(actionUrl).searchParams.get('token');
  const verified = await expect(restored, '/auth/verify-email', 'POST', { token });
  assert.equal(verified.user.emailVerified, true);
  assert.equal(verified.user.globalRole, 'superadmin');
  assert.equal((await production.db.get('SELECT email_verified_mode FROM users WHERE id = ?', [user.user.id])).email_verified_mode, 'resend');
  assert.equal((await expect(restored, '/projects')).projects.length, 1);
  await expect(restored, '/admin/users');
});
