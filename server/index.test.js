import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { startServer } from './index.js';
import { createHandler } from '../api/index.js';

test('startup exits unsuccessfully without claiming readiness when its port is occupied', async (t) => {
  const occupied = createServer();
  occupied.listen(0, '0.0.0.0');
  await once(occupied, 'listening');
  t.after(() => new Promise((resolve) => occupied.close(resolve)));
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(occupied.address().port), DATABASE_URL: '', SQLITE_PATH: ':memory:', MAIL_MODE: 'preview' },
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const [code] = await once(child, 'close');
  assert.equal(code, 1);
  assert.match(output, /EADDRINUSE/);
  assert.doesNotMatch(output, /running on/);
});

test('the server reports readiness after binding and serves its health endpoint', async (t) => {
  const { app, server } = await startServer({ port: 0, databasePath: ':memory:', databaseUrl: '', mailMode: 'preview', distPath: '/nonexistent-startup-test-dist' });
  t.after(async () => {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    await app.locals.close();
  });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  assert.deepEqual(await response.json(), { status: 'ok', storage: 'sqlite' });
});

test('Vercel startup refuses to create a temporary SQLite database when PostgreSQL is missing', async () => {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, VERCEL: '1', DATABASE_URL: '', SQLITE_PATH: ':memory:' },
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const [code] = await once(child, 'close');
  assert.equal(code, 1);
  assert.match(output, /DATABASE_URL_REQUIRED/);
  assert.doesNotMatch(output, /running on/);
});

test('serverless requests share initialization and recover after a failed database startup', async (t) => {
  let attempts = 0;
  const firstBatch = Promise.withResolvers();
  const handler = createHandler(async () => {
    attempts++;
    if (attempts === 1) {
      await firstBatch.promise;
      throw Object.assign(new Error('Unavailable'), { code: 'TEST_DATABASE_UNAVAILABLE' });
    }
    return (req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ path: req.url })); };
  });
  let received = 0;
  const server = createServer((req, res) => {
    received++;
    void handler(req, res);
    if (received === 3) firstBatch.resolve();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const failed = await Promise.all(Array.from({ length: 3 }, () => fetch(`${base}/api/health`)));
  assert.equal(attempts, 1);
  for (const response of failed) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).code, 'DATABASE_UNAVAILABLE');
  }
  const ready = await Promise.all(Array.from({ length: 3 }, () => fetch(`${base}/api/health`)));
  assert.equal(attempts, 2);
  for (const response of ready) {
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { path: '/api/health' });
  }
});
