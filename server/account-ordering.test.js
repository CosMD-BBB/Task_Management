import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from './app.js';

const PASSWORD = 'original-password-2026';
const NEW_PASSWORD = 'recovered-password-2026';

async function fixture(t, options = {}) {
  const messages = [];
  const app = await createApp({
    databasePath: ':memory:', databaseUrl: '', disableRateLimit: true,
    mailMode: 'resend', resendApiKey: 'fixture-only', mailFrom: 'Room <room@example.com>',
    appUrl: 'https://room.example.com', superadminEmail: 'admin@example.com', distPath: '/nonexistent-account-ordering',
    mailFetch: async (_url, request) => { messages.push(JSON.parse(request.body)); return { ok: true }; },
    ...options,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await app.locals.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db: app.locals.db,
    token(email, kind) {
      const action = kind === 'verify' ? 'verify-email' : 'reset-password';
      const message = messages.findLast((mail) => mail.to.includes(email) && mail.text.includes(`action=${action}`));
      assert.ok(message, 'The fixture provider must receive the requested message');
      return message.text.match(/token=([a-f0-9]{64})/)[1];
    },
    client() {
      return {
        cookie: '',
        async request(path, method = 'GET', body) {
          const response = await fetch(`${base}/api${path}`, {
            method,
            headers: { ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          const cookie = response.headers.getSetCookie()[0];
          if (cookie) this.cookie = cookie.split(';')[0];
          return { status: response.status, data: response.status === 204 ? null : await response.json() };
        },
      };
    },
  };
}

async function request(client, path, method = 'GET', body, status = 200) {
  const result = await client.request(path, method, body);
  assert.equal(result.status, status, `${method} ${path}: ${JSON.stringify(result.data)}`);
  return result.data;
}

async function register(server, email, verified = true) {
  const client = server.client();
  const result = await request(client, '/auth/register', 'POST', { name: email.split('@')[0], email, password: PASSWORD }, 201);
  client.user = result.user;
  if (verified) client.user = (await request(client, '/auth/verify-email', 'POST', { token: server.token(email, 'verify') })).user;
  return client;
}

function pauseCredentialRead(db, email) {
  const original = db.get;
  let enter;
  let release;
  let once = true;
  const entered = new Promise((resolve) => { enter = resolve; });
  const waiting = new Promise((resolve) => { release = resolve; });
  db.get = async (sql, values) => {
    const row = await original(sql, values);
    if (once && sql === 'SELECT * FROM users WHERE email = ?' && values?.[0] === email) {
      once = false;
      enter();
      await waiting;
    }
    return row;
  };
  return { entered, release, restore: () => { db.get = original; } };
}

test('a queued login cannot create a session using the password replaced by recovery', async (t) => {
  const server = await fixture(t);
  const member = await register(server, 'member@example.com');
  await request(member, '/auth/forgot-password', 'POST', { email: member.user.email });
  const barrier = pauseCredentialRead(server.db, member.user.email);
  const loginClient = server.client();
  const login = loginClient.request('/auth/login', 'POST', { email: member.user.email, password: PASSWORD });
  await barrier.entered;
  try {
    await request(server.client(), '/auth/reset-password', 'POST', { token: server.token(member.user.email, 'reset'), password: NEW_PASSWORD });
    assert.equal(Number((await server.db.get('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?', [member.user.id])).count), 0);
  } finally { barrier.release(); barrier.restore(); }
  assert.equal((await login).status, 401);
  await request(loginClient, '/auth/me', 'GET', undefined, 401);
  assert.equal(Number((await server.db.get('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?', [member.user.id])).count), 0);
  await request(server.client(), '/auth/login', 'POST', { email: member.user.email, password: PASSWORD }, 401);
  const recovered = server.client();
  await request(recovered, '/auth/login', 'POST', { email: member.user.email, password: NEW_PASSWORD });
  await request(recovered, '/projects');
});

test('password recovery invalidates outstanding verification links and allows a fresh link', async (t) => {
  const server = await fixture(t);
  const pending = await register(server, 'pending@example.com', false);
  const oldVerification = server.token(pending.user.email, 'verify');
  await request(pending, '/auth/forgot-password', 'POST', { email: pending.user.email });
  await request(server.client(), '/auth/reset-password', 'POST', { token: server.token(pending.user.email, 'reset'), password: NEW_PASSWORD });
  await request(server.client(), '/auth/verify-email', 'POST', { token: oldVerification }, 400);
  const fresh = server.client();
  const login = await request(fresh, '/auth/login', 'POST', { email: pending.user.email, password: NEW_PASSWORD });
  assert.equal(login.verificationRequired, true);
  await request(fresh, '/projects', 'GET', undefined, 403);
  await request(fresh, '/auth/resend-verification', 'POST');
  const newVerification = server.token(pending.user.email, 'verify');
  assert.notEqual(newVerification, oldVerification);
  const verified = await request(fresh, '/auth/verify-email', 'POST', { token: newVerification });
  assert.equal(verified.user.emailVerified, true);
  await request(fresh, '/projects');
});

test('a queued login cannot leave a valid session after an administrator suspends the account', async (t) => {
  const server = await fixture(t);
  const admin = await register(server, 'admin@example.com');
  const member = await register(server, 'member@example.com');
  const barrier = pauseCredentialRead(server.db, member.user.email);
  const client = server.client();
  const login = client.request('/auth/login', 'POST', { email: member.user.email, password: PASSWORD });
  await barrier.entered;
  try { await request(admin, `/admin/users/${member.user.id}`, 'PATCH', { disabled: true }); }
  finally { barrier.release(); barrier.restore(); }
  assert.equal((await login).status, 401);
  await request(client, '/auth/me', 'GET', undefined, 401);
  assert.equal(Number((await server.db.get('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?', [member.user.id])).count), 0);
});

test('public demo capability is enabled only for an explicitly configured preview environment', async (t) => {
  const production = await fixture(t);
  assert.deepEqual(await request(production.client(), '/auth/config'), { demoEnabled: false });
  await request(production.client(), '/auth/demo', 'POST', undefined, 404);
  assert.equal(Number((await production.db.get('SELECT COUNT(*) AS count FROM users')).count), 0);
  const preview = await fixture(t, { mailMode: 'preview' });
  assert.deepEqual(await request(preview.client(), '/auth/config'), { demoEnabled: true });
  const result = await request(preview.client(), '/auth/demo', 'POST', undefined, 201);
  assert.ok(result.user.demoScopeId);
  assert.equal(result.user.emailVerified, true);
});
