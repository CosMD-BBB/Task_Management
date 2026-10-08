import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

async function openDemo(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'ทดลองใช้ด้วยข้อมูลตัวอย่าง' }).click();
  await expect(page.locator('.project-heading h1')).toHaveText('Regagar');
  await expect(page.locator('.content-loader')).toHaveCount(0);
}

async function visibleTab(page, name) {
  return page.locator('.view-tabs').getByRole('button', { name: new RegExp(`^${name}`) });
}

async function expectNoPageOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.width);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.width);
}

test('demo workspace persists a full task across List, Board and Calendar', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openDemo(page);
  await page.screenshot({ path: '/tmp/room-desktop.png', fullPage: true });
  await expectNoPageOverflow(page);

  // A project-specific column is created through the same owner controls as real users.
  await page.getByRole('button', { name: 'New project room' }).click();
  const settings = page.getByRole('dialog', { name: 'สร้างห้องโปรเจกต์' });
  const projectName = `Content launch ${randomUUID().slice(0, 8)}`;
  await settings.getByLabel('ชื่อโปรเจกต์', { exact: true }).fill(projectName);
  await settings.getByRole('textbox', { name: 'รายละเอียด', exact: true }).fill('Campaign tasks with private team access');
  await expect(settings.getByLabel('ชื่อคอลัมน์', { exact: true })).toHaveCount(0);
  await settings.getByLabel('ชื่อคอลัมน์ใหม่').fill('Mockup');
  await settings.getByRole('button', { name: 'เพิ่ม', exact: true }).click();
  await settings.getByLabel('ชื่อคอลัมน์ใหม่').fill('Approval owner');
  await settings.getByRole('button', { name: 'เพิ่ม', exact: true }).click();
  await settings.getByLabel('ประเภทคอลัมน์').nth(1).selectOption('select');
  await settings.getByLabel('ตัวเลือกของ Approval owner').fill('Client, Studio');
  await settings.getByRole('button', { name: 'สร้างโปรเจกต์', exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect(page.locator('.project-heading h1')).toHaveText(projectName);

  await page.getByRole('button', { name: 'New task', exact: true }).click();
  let editor = page.getByRole('dialog', { name: 'Create a task' });
  const taskTitle = 'Publish launch campaign';
  const dueDate = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date()));
  await editor.getByLabel('Task name', { exact: true }).fill(taskTitle);
  await editor.getByLabel('Description', { exact: true }).fill('Prepare creative assets and send the client review link.');
  await editor.getByLabel('Priority', { exact: true }).selectOption('urgent');
  await editor.getByLabel('Status', { exact: true }).selectOption('review');
  await editor.getByLabel('Due date', { exact: true }).fill(dueDate);
  await editor.getByLabel('Content type', { exact: true }).fill('Video');
  await editor.getByLabel('Channel', { exact: true }).fill('TikTok');
  await editor.getByLabel('Mockup', { exact: true }).fill('creative-v1.fig');
  await editor.getByLabel('Approval owner', { exact: true }).selectOption('Client');
  await editor.getByLabel('New checklist item', { exact: true }).fill('Draft the story');
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await editor.getByLabel('New checklist item', { exact: true }).fill('Review the cut');
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await editor.getByLabel('Complete checklist item 1', { exact: true }).check();
  await editor.getByRole('button', { name: 'Add link', exact: true }).click();
  await editor.getByLabel('Link 1 name', { exact: true }).fill('Design files');
  await editor.getByLabel('Link 1 URL', { exact: true }).fill('https://drive.google.com/example');
  await editor.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('button', { name: taskTitle, exact: true })).toBeVisible();

  const { projects } = await (await page.request.get('/api/projects')).json();
  const project = projects.find(p => p.name === projectName);
  const { tasks } = await (await page.request.get(`/api/projects/${project.id}/tasks`)).json();
  expect(tasks).toHaveLength(1);
  expect(tasks[0]).toMatchObject({ title: taskTitle, dueDate, priority: 'urgent', contentType: 'Video', channel: 'TikTok', status: 'review' });
  expect(tasks[0].links).toEqual([{ label: 'Design files', url: 'https://drive.google.com/example' }]);
  expect(tasks[0].subtasks.map(({ title, done }) => ({ title, done }))).toEqual([{ title: 'Draft the story', done: true }, { title: 'Review the cut', done: false }]);
  expect(tasks[0].customFields[project.fields.find(f => f.name === 'Mockup').id]).toBe('creative-v1.fig');
  expect(tasks[0].customFields[project.fields.find(f => f.name === 'Approval owner').id]).toBe('Client');

  await page.reload();
  await page.locator('.project-nav').getByRole('button', { name: projectName }).click();
  await expect(page.getByRole('button', { name: taskTitle, exact: true })).toBeVisible();
  await (await visibleTab(page, 'Board')).click();
  await page.getByLabel(`Move ${taskTitle} to status`, { exact: true }).selectOption('scheduled');
  await expect(page.locator('.tm-board-column').filter({ has: page.locator('.tm-status-badge', { hasText: 'SCHEDULED' }) }).getByRole('button', { name: taskTitle, exact: true })).toBeVisible();
  await (await visibleTab(page, 'Calendar')).click();
  await page.locator('.tm-calendar-day-tasks').getByRole('button', { name: taskTitle, exact: true }).click();
  editor = page.getByRole('dialog', { name: 'Task details' });
  await expect(editor.getByLabel('Due date', { exact: true })).toHaveValue(dueDate);
  await expect(editor.getByLabel('Status', { exact: true })).toHaveValue('scheduled');
  await expect(editor.getByLabel('Complete checklist item 1', { exact: true })).toBeChecked();
  await editor.getByLabel('Task name', { exact: true }).fill('Publish launch campaign — approved');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await (await visibleTab(page, 'List')).click();
  await page.getByLabel('ค้นหางาน', { exact: true }).fill('approved');
  const editedTitle = 'Publish launch campaign — approved';
  await expect(page.getByRole('button', { name: editedTitle, exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Mark ${editedTitle} complete`, exact: true }).click();
  await expect(page.getByRole('button', { name: `Reopen ${editedTitle}`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: editedTitle, exact: true }).click();
  editor = page.getByRole('dialog', { name: 'Task details' });
  await editor.getByRole('button', { name: 'Delete task', exact: true }).click();
  await editor.getByRole('alert').getByRole('button', { name: 'Delete task', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('button', { name: editedTitle, exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('registration, logout and email/password login retain a private project', async ({ page }) => {
  const email = `ui-${randomUUID()}@example.test`;
  const password = `Workspace-${randomUUID()}`;
  await page.goto('/');
  await page.getByRole('button', { name: 'สร้างบัญชีใหม่', exact: true }).click();
  await page.getByLabel('ชื่อของคุณ', { exact: true }).fill('Ploy Test');
  await page.getByLabel('อีเมล', { exact: true }).fill(email);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'สร้างบัญชี', exact: true }).click();
  await expect(page.getByText('A fresh start for your team.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'สร้างโปรเจกต์แรก', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'สร้างห้องโปรเจกต์' });
  await settings.getByLabel('ชื่อโปรเจกต์', { exact: true }).fill('Private studio');
  await settings.getByRole('button', { name: 'สร้างโปรเจกต์', exact: true }).click();
  await expect(page.locator('.project-heading h1')).toHaveText('Private studio');
  await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to your room.' })).toBeVisible();
  expect((await page.request.get('/api/projects')).status()).toBe(401);
  await page.getByLabel('อีเมล', { exact: true }).fill(email);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  await expect(page.locator('.project-heading h1')).toHaveText('Private studio');
});

test('membership gates project visibility and viewer mutations in the UI and API', async ({ page, browser }) => {
  await openDemo(page);
  const { projects } = await (await page.request.get('/api/projects')).json();
  const project = projects.find(p => p.name === 'Regagar');
  const { tasks } = await (await page.request.get(`/api/projects/${project.id}/tasks`)).json();
  const task = tasks[0];
  const viewerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1440, height: 1000 } });
  try {
    const email = `viewer-${randomUUID()}@example.test`;
    const registered = await viewerContext.request.post('/api/auth/register', { data: { name: 'Viewer Test', email, password: `Viewer-${randomUUID()}` } });
    expect(registered.status()).toBe(201);
    expect((await viewerContext.request.get(`/api/projects/${project.id}`)).status()).toBe(404);
    expect((await viewerContext.request.get(`/api/projects/${project.id}/tasks`)).status()).toBe(404);
    expect((await viewerContext.request.patch(`/api/tasks/${task.id}`, { data: { title: 'Unauthorized change' } })).status()).toBe(404);
    const before = await (await viewerContext.request.get('/api/projects')).json();
    expect(before.projects).toEqual([]);

    // Owner invites a registered teammate with the actual membership interface.
    await page.getByRole('button', { name: 'จัดการสมาชิก', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'ตั้งค่าโปรเจกต์' });
    await settings.getByLabel('เพิ่มสมาชิกด้วยอีเมล', { exact: true }).fill(email);
    await settings.getByLabel('สิทธิ์สมาชิกใหม่', { exact: true }).selectOption('viewer');
    await settings.getByRole('button', { name: 'เพิ่มสมาชิก', exact: true }).click();
    await expect(settings.getByText(email, { exact: true })).toBeVisible();
    await settings.getByRole('button', { name: 'ปิด', exact: true }).click();

    const viewer = await viewerContext.newPage();
    await viewer.goto('/');
    await expect(viewer.locator('.project-heading h1')).toHaveText('Regagar');
    await expect(viewer.locator('.project-role')).toHaveText('View only');
    await expect(viewer.getByRole('button', { name: 'New task', exact: true })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: `Mark ${task.title} complete`, exact: true })).toBeDisabled();
    await viewer.getByRole('button', { name: task.title, exact: true }).click();
    const editor = viewer.getByRole('dialog', { name: 'Task details' });
    await expect(editor.getByLabel('Task name', { exact: true })).toBeDisabled();
    await expect(editor.getByLabel('Status', { exact: true })).toBeDisabled();
    await expect(editor.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(0);
    await expect(editor.getByRole('button', { name: 'Delete task', exact: true })).toHaveCount(0);
    await editor.getByRole('button', { name: 'Close', exact: true }).click();
    await (await visibleTab(viewer, 'Board')).click();
    await expect(viewer.locator('.tm-board-card[draggable="true"]')).toHaveCount(0);
    await expect(viewer.locator('.tm-card-status-control')).toHaveCount(0);
    expect((await viewerContext.request.patch(`/api/tasks/${task.id}`, { data: { title: 'Viewer change' } })).status()).toBe(403);
    expect((await viewerContext.request.post(`/api/projects/${project.id}/tasks`, { data: { title: 'Viewer addition' } })).status()).toBe(403);
    expect((await viewerContext.request.delete(`/api/tasks/${task.id}`)).status()).toBe(403);
    expect((await viewerContext.request.patch(`/api/projects/${project.id}`, { data: { name: 'Viewer rename' } })).status()).toBe(403);

    const viewerUser = (await registered.json()).user;
    const revoke = await page.request.delete(`/api/projects/${project.id}/members/${viewerUser.id}`);
    expect(revoke.status()).toBe(200);
    await viewer.reload();
    await expect(viewer.getByText('A fresh start for your team.', { exact: true })).toBeVisible();
    expect((await viewerContext.request.get(`/api/projects/${project.id}/tasks`)).status()).toBe(404);
  } finally {
    await viewerContext.close();
  }
});

test('mobile workspace supports all three views and task details without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expectNoPageOverflow(page);
  await page.getByRole('button', { name: 'ทดลองใช้ด้วยข้อมูลตัวอย่าง' }).click();
  await expect(page.locator('.project-heading h1')).toHaveText('Regagar');
  await expect(page.locator('.content-loader')).toHaveCount(0);
  await expectNoPageOverflow(page);
  await page.screenshot({ path: '/tmp/room-mobile.png', fullPage: true });
  await (await visibleTab(page, 'Board')).click();
  await expect(page.locator('.tm-board-column')).toHaveCount(5);
  await expectNoPageOverflow(page);
  await page.locator('.tm-card-title').first().click();
  const editor = page.getByRole('dialog', { name: 'Task details' });
  await expect(editor).toBeVisible();
  await expectNoPageOverflow(page);
  await editor.getByRole('button', { name: 'Close task details', exact: true }).click();
  await (await visibleTab(page, 'Calendar')).click();
  await expect(page.locator('.tm-calendar-grid')).toBeVisible();
  await expectNoPageOverflow(page);
  await page.getByRole('button', { name: 'เปิดเมนู', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ออกจากระบบ', exact: true })).toBeVisible();
  await expectNoPageOverflow(page);
});
