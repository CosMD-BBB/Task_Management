// Exercise the public URL before publishing it. Never log session credentials.
import { setTimeout } from 'node:timers/promises';
const base = process.argv[2];
if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(base || '')) throw new Error('Unexpected preview URL');
let healthy = false;
for (let attempt = 0; attempt < 24; attempt++) {
  try {
    const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(10_000) });
    healthy = response.ok && (await response.json()).status === 'ok';
    if (healthy) break;
  } catch { /* The newly created tunnel may still be propagating. */ }
  await setTimeout(5_000);
}
if (!healthy) throw new Error('Public preview did not become healthy');
const frontend = await fetch(base);
if (!frontend.ok || !(await frontend.text()).includes('id="root"')) throw new Error('Public frontend unavailable');
const demo = await fetch(`${base}/api/auth/demo`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: '{}',
});
if (demo.status !== 201) throw new Error(`Public demo failed (${demo.status})`);
const cookie = demo.headers.getSetCookie()[0]?.split(';')[0];
if (!cookie) throw new Error('Session cookie was not issued');
const headers = { cookie, 'content-type': 'application/json', origin: base };
const projectsResponse = await fetch(`${base}/api/projects`, { headers });
if (!projectsResponse.ok) throw new Error('Public authenticated request failed');
const { projects } = await projectsResponse.json();
if (!projects.length) throw new Error('Demo project missing');
const tasksResponse = await fetch(`${base}/api/projects/${projects[0].id}/tasks`, { headers });
const { tasks } = await tasksResponse.json();
if (!tasksResponse.ok || !tasks.length) throw new Error('Seeded tasks missing');
const created = await fetch(`${base}/api/projects/${projects[0].id}/tasks`, {
  method: 'POST', headers, body: JSON.stringify({ title: 'Public preview readiness check', priority: 'high' }),
});
if (created.status !== 201) throw new Error('Public task creation failed');
const { task } = await created.json();
const deleted = await fetch(`${base}/api/tasks/${task.id}`, { method: 'DELETE', headers });
if (deleted.status !== 204) throw new Error('Public task cleanup failed');
console.log('Public frontend, login, project access and task CRUD verified.');
