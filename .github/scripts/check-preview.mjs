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
const { user } = await demo.json();
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
const assigneeIds = [...new Set([user.id, ...projects[0].members.map(member => member.userId)])].slice(0, 2);
const catalogResponse = await fetch(`${base}/api/projects/${projects[0].id}/tags`, {
  method: 'PATCH', headers, body: JSON.stringify({ kind: 'contentType', value: 'Readiness custom content' }),
});
if (!catalogResponse.ok) throw new Error('Public custom content catalog failed');
const created = await fetch(`${base}/api/projects/${projects[0].id}/tasks`, {
  method: 'POST', headers, body: JSON.stringify({ title: 'Public preview readiness check', priority: 'high', assigneeIds, contentTypes: ['Infographic', 'Readiness custom content'], channels: ['Facebook', 'Instagram'] }),
});
if (created.status !== 201) throw new Error('Public task creation failed');
const { task } = await created.json();
if (task.assigneeIds.length !== 2 || task.contentTypes.length !== 2 || task.channels.length !== 2) throw new Error('Public multi-value task fields failed');
const changed = await fetch(`${base}/api/tasks/${task.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'review' }) });
if (!changed.ok) throw new Error('Public direct status update failed');
const { task: updated } = await changed.json();
if (updated.status !== 'review' || updated.assigneeIds.length !== 2 || updated.contentTypes.length !== 2) throw new Error('Status update did not preserve task details');
const teammate = projects[0].members.find(member => member.userId !== user.id);
const mentionLabel = `@${teammate.user.name}`;
const commentBody = `${mentionLabel} ช่วยตรวจแคปชั่นและแนะนำจุดที่ควรปรับ\nข้อความตัวอย่างสำหรับตรวจความพร้อม`;
const commentInput = { body: commentBody, kind: 'caption', mentions: [{ userId: teammate.userId, start: 0, end: mentionLabel.length }] };
const commentResponse = await fetch(`${base}/api/tasks/${task.id}/comments`, { method: 'POST', headers, body: JSON.stringify(commentInput) });
if (commentResponse.status !== 201) throw new Error('Public task comment creation failed');
const { comment } = await commentResponse.json();
if (comment.body !== commentBody || comment.kind !== 'caption' || comment.mentions[0]?.userId !== teammate.userId) throw new Error('Public caption or mention persistence failed');
const commentListResponse = await fetch(`${base}/api/tasks/${task.id}/comments`, { headers });
if (!commentListResponse.ok || !(await commentListResponse.json()).comments.some(entry => entry.id === comment.id && entry.body === commentBody)) throw new Error('Public comment reading failed');
const countedTasksResponse = await fetch(`${base}/api/projects/${projects[0].id}/tasks`, { headers });
if (!countedTasksResponse.ok || (await countedTasksResponse.json()).tasks.find(entry => entry.id === task.id)?.commentsCount !== 1) throw new Error('Public task comment count failed');
const changedComment = await fetch(`${base}/api/tasks/${task.id}/comments/${comment.id}`, { method: 'PATCH', headers, body: JSON.stringify({ ...commentInput, kind: 'revision' }) });
if (!changedComment.ok || (await changedComment.json()).comment.kind !== 'revision') throw new Error('Public comment editing failed');
const notificationResponse = await fetch(`${base}/api/notifications`, { headers });
if (!notificationResponse.ok || !(await notificationResponse.json()).notifications.some(notification => notification.taskId === task.id)) throw new Error('Public assignment notification failed');
const adminResponse = await fetch(`${base}/api/admin/users`, { headers });
if (!adminResponse.ok || !(await adminResponse.json()).users.every(member => member.demoScopeId === user.demoScopeId)) throw new Error('Public demo administrator isolation failed');
const deletedComment = await fetch(`${base}/api/tasks/${task.id}/comments/${comment.id}`, { method: 'DELETE', headers });
if (deletedComment.status !== 204) throw new Error('Public comment cleanup failed');
const deleted = await fetch(`${base}/api/tasks/${task.id}`, { method: 'DELETE', headers });
if (deleted.status !== 204) throw new Error('Public task cleanup failed');
console.log('Public frontend, login, task CRUD, multiple assignees/tags, direct status, comments/captions/revisions/mentions, notifications and isolated demo administration verified.');
