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

async function registerVerified(request, name) {
  const email = `ui-${randomUUID()}@example.test`;
  const password = `Workspace-${randomUUID()}`;
  const response = await request.post('/api/auth/register', { data: { name, email, password } });
  expect(response.status()).toBe(201);
  const inbox = await (await request.get('/api/auth/mail-preview')).json();
  const action = new URL(inbox.messages.find(message => message.kind === 'verify').actionUrl);
  const verified = await request.post('/api/auth/verify-email', { data: { token: action.searchParams.get('token') } });
  expect(verified.status()).toBe(200);
  const { user } = await verified.json();
  return { user, email, password };
}

async function selectMultiple(editor, label, options) {
  await editor.getByRole('button', { name: label, exact: true }).click();
  const popup = editor.getByRole('group', { name: `${label} options`, exact: true });
  for (const option of options) await popup.getByRole('checkbox', { name: option, exact: true }).check();
  await popup.getByRole('button', { name: 'เสร็จแล้ว', exact: true }).click();
}

async function createTag(editor, label, value) {
  await editor.getByRole('button', { name: label, exact: true }).click();
  const popup = editor.getByRole('group', { name: `${label} options`, exact: true });
  await popup.getByRole('textbox', { name: `Search ${label}`, exact: true }).fill(value);
  await popup.getByRole('button', { name: /เพิ่มตัวเลือก/ }).click();
  await expect(popup.getByRole('checkbox', { name: value, exact: true })).toBeChecked();
  await popup.getByRole('button', { name: 'เสร็จแล้ว', exact: true }).click();
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
  await selectMultiple(editor, 'Type Content', ['Video', 'ขายของ']);
  await createTag(editor, 'Type Content', 'รีวิวจากทีม');
  await selectMultiple(editor, 'Channels', ['TikTok', 'Facebook']);
  await createTag(editor, 'Channels', 'Shopee Live');
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
  expect(tasks[0]).toMatchObject({ title: taskTitle, dueDate, priority: 'urgent', contentTypes: ['Video', 'ขายของ', 'รีวิวจากทีม'], channels: ['TikTok', 'Facebook', 'Shopee Live'], status: 'review' });
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
  await editor.getByRole('button', { name: 'Type Content', exact: true }).click();
  await expect(editor.getByRole('group', { name: 'Type Content options' }).getByRole('checkbox', { name: 'รีวิวจากทีม', exact: true })).toBeChecked();
  await editor.getByRole('group', { name: 'Type Content options' }).getByRole('button', { name: 'เสร็จแล้ว', exact: true }).click();
  await editor.getByLabel('Task name', { exact: true }).fill('Publish launch campaign — approved');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await (await visibleTab(page, 'List')).click();
  await page.getByLabel('ค้นหางาน', { exact: true }).fill('approved');
  const editedTitle = 'Publish launch campaign — approved';
  await expect(page.getByRole('button', { name: editedTitle, exact: true })).toBeVisible();
  await page.getByLabel(`Status for ${editedTitle}`, { exact: true }).selectOption('done');
  await expect(page.getByLabel(`Status for ${editedTitle}`, { exact: true })).toHaveValue('done');
  await page.getByRole('button', { name: editedTitle, exact: true }).click();
  editor = page.getByRole('dialog', { name: 'Task details' });
  await editor.getByRole('button', { name: 'Delete task', exact: true }).click();
  await editor.getByRole('alert').getByRole('button', { name: 'Delete task', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('button', { name: editedTitle, exact: true })).toHaveCount(0);

  // Catalog additions remain available after deleting the only task that used them.
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  editor = page.getByRole('dialog', { name: 'Create a task' });
  await selectMultiple(editor, 'Type Content', ['รีวิวจากทีม']);
  await selectMultiple(editor, 'Channels', ['Shopee Live']);
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await editor.getByRole('button', { name: 'Discard changes', exact: true }).click();

  // Owners edit the room name directly and upload an image that survives a reload.
  await page.getByRole('button', { name: 'แก้ไขชื่อและรูปโปรเจกต์', exact: true }).click();
  const imageSettings = page.getByRole('dialog', { name: 'ตั้งค่าโปรเจกต์' });
  const renamedProject = `${projectName} updated`;
  await imageSettings.getByLabel('ชื่อโปรเจกต์', { exact: true }).fill(renamedProject);
  const coverBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 160;
    const context = canvas.getContext('2d'); context.fillStyle = '#0e8778'; context.fillRect(0, 0, 320, 160);
    context.fillStyle = '#ffffff'; context.font = 'bold 32px sans-serif'; context.fillText('Creative studio', 28, 88);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await imageSettings.getByLabel('อัปโหลดรูปโปรเจกต์', { exact: true }).setInputFiles({ name: 'studio.png', mimeType: 'image/png', buffer: Buffer.from(coverBase64, 'base64') });
  await expect(imageSettings.getByRole('img', { name: 'ตัวอย่างรูปโปรเจกต์' })).toBeVisible();
  await imageSettings.getByRole('button', { name: 'บันทึกการตั้งค่า', exact: true }).click();
  await expect(imageSettings).toHaveCount(0);
  await expect(page.locator('.project-heading h1')).toHaveText(renamedProject);
  await page.reload();
  await page.locator('.project-nav').getByRole('button', { name: renamedProject }).click();
  await expect(page.getByRole('img', { name: `ภาพโปรเจกต์ ${renamedProject}` })).toBeVisible();
  const updated = await (await page.request.get(`/api/projects/${project.id}`)).json();
  expect(updated.project.coverImage).toMatch(/^data:image\/webp;base64,/);
  expect(updated.project.contentTypeOptions).toContain('รีวิวจากทีม');
  expect(updated.project.channelOptions).toContain('Shopee Live');
  expect(errors).toEqual([]);
});

test('registration requires verification and password reset revokes sessions and used links', async ({ page, browser }) => {
  const email = `ui-${randomUUID()}@example.test`;
  const password = `Workspace-${randomUUID()}`;
  await page.goto('/');
  await page.getByRole('button', { name: 'สร้างบัญชีใหม่', exact: true }).click();
  await page.getByLabel('ชื่อของคุณ', { exact: true }).fill('Ploy Test');
  await page.getByLabel('อีเมล', { exact: true }).fill(email);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'สร้างบัญชี', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ยืนยันอีเมลก่อนเริ่มงาน', exact: true })).toBeVisible();
  expect((await page.request.get('/api/projects')).status()).toBe(403);
  const initialMail = await (await page.request.get('/api/auth/mail-preview')).json();
  const firstVerification = initialMail.messages.find(message => message.kind === 'verify').actionUrl;
  await page.getByRole('button', { name: 'ขออีเมลยืนยันใหม่', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('เตรียมอีเมลยืนยันใหม่');
  expect((await page.request.post('/api/auth/verify-email', { data: { token: new URL(firstVerification).searchParams.get('token') } })).status()).toBe(400);
  const inbox = await (await page.request.get('/api/auth/mail-preview')).json();
  const verificationUrl = new URL(inbox.messages.find(message => message.kind === 'verify').actionUrl);
  await page.goto(`${verificationUrl.pathname}${verificationUrl.search}`);
  await page.getByRole('button', { name: 'ยืนยันอีเมลของฉัน', exact: true }).click();
  await expect(page.getByText('A fresh start for your team.', { exact: true })).toBeVisible();
  expect((await page.request.post('/api/auth/verify-email', { data: { token: verificationUrl.searchParams.get('token') } })).status()).toBe(400);
  await expect(page.getByRole('button', { name: 'จัดการผู้ใช้งาน', exact: true })).toHaveCount(0);
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

  const otherSession = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    expect((await otherSession.request.post('/api/auth/login', { data: { email, password } })).status()).toBe(200);
    await page.getByRole('button', { name: 'บัญชีและความปลอดภัย', exact: true }).click();
    const security = page.getByRole('dialog', { name: 'บัญชีและความปลอดภัย', exact: true });
    await security.getByRole('button', { name: 'ขอลิงก์ตั้งรหัสผ่านใหม่', exact: true }).click();
    await expect(security.getByRole('link', { name: 'เปิดลิงก์ตั้งรหัสผ่านใหม่' })).toBeVisible();
    const resetInbox = await (await page.request.get('/api/auth/mail-preview')).json();
    const resetUrl = new URL(resetInbox.messages.find(message => message.kind === 'reset').actionUrl);
    await security.getByRole('link', { name: 'เปิดลิงก์ตั้งรหัสผ่านใหม่' }).click();
    const newPassword = `Updated-${randomUUID()}`;
    await page.getByLabel('รหัสผ่านใหม่', { exact: true }).fill(newPassword);
    await page.getByLabel('ยืนยันรหัสผ่านใหม่', { exact: true }).fill(`${newPassword}-different`);
    await page.getByRole('button', { name: 'บันทึกรหัสผ่านใหม่', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    await page.getByLabel('ยืนยันรหัสผ่านใหม่', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'บันทึกรหัสผ่านใหม่', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome to your room.' })).toBeVisible();
    expect((await otherSession.request.get('/api/auth/me')).status()).toBe(401);
    expect((await page.request.post('/api/auth/login', { data: { email, password } })).status()).toBe(401);
    expect((await page.request.post('/api/auth/reset-password', { data: { token: resetUrl.searchParams.get('token'), password: newPassword } })).status()).toBe(400);
    await page.getByLabel('อีเมล', { exact: true }).fill(email);
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
    await expect(page.locator('.project-heading h1')).toHaveText('Private studio');
  } finally { await otherSession.close(); }
});

test('membership gates project visibility and viewer mutations in the UI and API', async ({ page, browser }) => {
  await registerVerified(page.request, 'Project Owner');
  const { project } = await (await page.request.post('/api/projects', { data: { name: 'Private team' } })).json();
  const { task } = await (await page.request.post(`/api/projects/${project.id}/tasks`, { data: { title: 'Private work item' } })).json();
  await page.goto('/');
  await expect(page.locator('.project-heading h1')).toHaveText('Private team');
  const viewerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1440, height: 1000 } });
  try {
    const { email, user: viewerUser } = await registerVerified(viewerContext.request, 'Viewer Test');
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
    await expect(viewer.locator('.project-heading h1')).toHaveText('Private team');
    await expect(viewer.locator('.project-role')).toHaveText('View only');
    await expect(viewer.getByRole('button', { name: 'New task', exact: true })).toHaveCount(0);
    await expect(viewer.getByLabel(`Status for ${task.title}`, { exact: true })).toBeDisabled();
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

    const revoke = await page.request.delete(`/api/projects/${project.id}/members/${viewerUser.id}`);
    expect(revoke.status()).toBe(200);
    await viewer.reload();
    await expect(viewer.getByText('A fresh start for your team.', { exact: true })).toBeVisible();
    expect((await viewerContext.request.get(`/api/projects/${project.id}/tasks`)).status()).toBe(404);
  } finally {
    await viewerContext.close();
  }
});

test('multiple assignees receive independent notifications and read state', async ({ page, browser }) => {
  const owner = await registerVerified(page.request, 'Notification Owner');
  const firstContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const secondContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const first = await registerVerified(firstContext.request, 'First Editor');
    const second = await registerVerified(secondContext.request, 'Second Editor');
    const { project } = await (await page.request.post('/api/projects', { data: { name: 'Shared assignment' } })).json();
    for (const editor of [first, second]) {
      expect((await page.request.post(`/api/projects/${project.id}/members`, { data: { email: editor.email, role: 'editor' } })).status()).toBe(200);
    }
    const firstPage = await firstContext.newPage();
    const secondPage = await secondContext.newPage();
    await firstPage.goto('/');
    await secondPage.goto('/');
    await expect(firstPage.locator('.project-heading h1')).toHaveText('Shared assignment');
    await expect(secondPage.locator('.project-heading h1')).toHaveText('Shared assignment');
    await expect(firstPage.locator('.notification-count')).toHaveCount(0);
    await expect(secondPage.locator('.notification-count')).toHaveCount(0);
    await page.goto('/');
    await expect(page.locator('.project-heading h1')).toHaveText('Shared assignment');
    await page.getByRole('button', { name: 'New task', exact: true }).click();
    const taskEditor = page.getByRole('dialog', { name: 'Create a task' });
    await taskEditor.getByLabel('Task name', { exact: true }).fill('Review the shared campaign');
    await selectMultiple(taskEditor, 'Assignees', [owner.user.name, first.user.name, second.user.name]);
    await taskEditor.getByRole('button', { name: 'Create task', exact: true }).click();
    await expect(taskEditor).toHaveCount(0);
    await expect(page.locator('.notification-count')).toHaveText('1');
    const { tasks } = await (await page.request.get(`/api/projects/${project.id}/tasks`)).json();
    expect(tasks[0].assigneeIds).toEqual([owner.user.id, first.user.id, second.user.id]);

    const ownerNotifications = await (await page.request.get('/api/notifications')).json();
    const firstNotifications = await (await firstContext.request.get('/api/notifications')).json();
    const secondNotifications = await (await secondContext.request.get('/api/notifications')).json();
    for (const inbox of [ownerNotifications, firstNotifications, secondNotifications]) {
      expect(inbox.unreadCount).toBe(1);
      expect(inbox.notifications).toHaveLength(1);
      expect(inbox.notifications[0].taskId).toBe(tasks[0].id);
    }
    expect((await firstContext.request.patch(`/api/notifications/${secondNotifications.notifications[0].id}/read`)).status()).toBe(404);
    expect((await secondContext.request.patch(`/api/notifications/${ownerNotifications.notifications[0].id}/read`)).status()).toBe(404);

    // Reading the owner's own notification does not affect the two recipient inboxes.
    await page.getByRole('button', { name: 'การแจ้งเตือน', exact: true }).click();
    const ownerPanel = page.getByRole('dialog', { name: 'การแจ้งเตือน', exact: true });
    await expect(ownerPanel.getByText('Review the shared campaign', { exact: true })).toBeVisible();
    await ownerPanel.getByRole('button', { name: 'อ่านแล้ว', exact: true }).click();
    await expect(ownerPanel.getByText('อ่านครบแล้ว', { exact: true })).toBeVisible();
    expect((await (await firstContext.request.get('/api/notifications')).json()).unreadCount).toBe(1);
    expect((await (await secondContext.request.get('/api/notifications')).json()).unreadCount).toBe(1);
    await ownerPanel.getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true }).click();

    // The receiving pages were already open when the assignment was made.
    await expect(firstPage.locator('.notification-count')).toHaveText('1', { timeout: 20_000 });
    await firstPage.getByRole('button', { name: 'การแจ้งเตือน', exact: true }).click();
    await firstPage.getByRole('dialog', { name: 'การแจ้งเตือน', exact: true }).getByRole('button', { name: 'เปิดงาน', exact: true }).click();
    const openedTask = firstPage.getByRole('dialog', { name: 'Task details' });
    await expect(openedTask.getByLabel('Task name', { exact: true })).toHaveValue('Review the shared campaign');
    await openedTask.getByRole('button', { name: 'Close task details', exact: true }).click();
    expect((await (await firstContext.request.get('/api/notifications')).json()).unreadCount).toBe(0);

    await expect(secondPage.locator('.notification-count')).toHaveText('1', { timeout: 20_000 });
    await secondPage.getByRole('button', { name: 'การแจ้งเตือน', exact: true }).click();
    await secondPage.getByRole('dialog', { name: 'การแจ้งเตือน', exact: true }).getByRole('button', { name: 'อ่านทั้งหมด', exact: true }).click();
    await expect(secondPage.locator('.notification-count')).toHaveCount(0);
    await secondPage.reload();
    expect((await (await secondContext.request.get('/api/notifications')).json()).unreadCount).toBe(0);

    // A status update must not create another assignment notification.
    expect((await page.request.patch(`/api/tasks/${tasks[0].id}`, { data: { status: 'review' } })).status()).toBe(200);
    for (const request of [page.request, firstContext.request, secondContext.request]) {
      expect((await (await request.get('/api/notifications')).json()).notifications).toHaveLength(1);
    }
  } finally { await firstContext.close(); await secondContext.close(); }
});

test('demo administration scopes users and supports edit, suspend, reactivate and ownership handoff', async ({ page, browser }) => {
  await openDemo(page);
  const { user: admin } = await (await page.request.get('/api/auth/me')).json();
  const initial = await (await page.request.get('/api/admin/users')).json();
  expect(initial.users).toHaveLength(4);
  const outsiderContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const outsiderResponse = await outsiderContext.request.post('/api/auth/demo');
    expect(outsiderResponse.status()).toBe(201);
    const outsider = (await outsiderResponse.json()).user;
    expect((await page.request.patch(`/api/admin/users/${outsider.id}`, { data: { disabled: true } })).status()).toBe(404);
    expect((await page.request.delete(`/api/admin/users/${outsider.id}`, { data: {} })).status()).toBe(404);
    expect((await page.request.patch(`/api/admin/users/${admin.id}`, { data: { disabled: true } })).status()).toBe(400);
    expect((await page.request.delete(`/api/admin/users/${admin.id}`, { data: {} })).status()).toBe(400);
    expect(initial.users.every(user => user.demoScopeId === admin.demoScopeId)).toBe(true);

    await page.getByRole('button', { name: 'จัดการผู้ใช้งาน', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'จัดการทีมและผู้ใช้งาน', exact: true });
    await expect(panel.locator('.room-admin-user')).toHaveCount(4);
    await page.screenshot({ path: '/tmp/room-admin.png', fullPage: true });
    const self = panel.locator('.room-admin-user').filter({ hasText: admin.email });
    await expect(self.getByRole('button', { name: 'ระงับบัญชี', exact: true })).toBeDisabled();
    await expect(self.getByRole('button', { name: `ลบบัญชี ${admin.name}`, exact: true })).toBeDisabled();

    const member = initial.users.find(user => user.name === 'Nat Studio');
    await panel.getByRole('button', { name: `แก้ไขชื่อ ${member.name}`, exact: true }).click();
    let confirmation = page.getByRole('dialog', { name: 'แก้ไขชื่อสมาชิก', exact: true });
    await confirmation.getByLabel('ชื่อที่แสดง', { exact: true }).fill('Nat Creative');
    await confirmation.getByRole('button', { name: 'บันทึกชื่อ', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    const memberRow = panel.locator('.room-admin-user').filter({ hasText: member.email });
    await expect(memberRow.getByText('Nat Creative', { exact: true })).toBeVisible();
    await memberRow.getByRole('button', { name: 'ระงับบัญชี', exact: true }).click();
    confirmation = page.getByRole('dialog', { name: 'ระงับบัญชีสมาชิก', exact: true });
    await confirmation.getByRole('button', { name: 'ยืนยันระงับบัญชี', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await panel.getByLabel('กรองสถานะสมาชิก', { exact: true }).selectOption('suspended');
    await expect(panel.locator('.room-admin-user')).toHaveCount(1);
    await expect(memberRow.getByText('ถูกระงับ', { exact: true })).toBeVisible();
    await memberRow.getByRole('button', { name: 'เปิดใช้งาน', exact: true }).click();
    confirmation = page.getByRole('dialog', { name: 'เปิดใช้งานบัญชีอีกครั้ง', exact: true });
    await confirmation.getByRole('button', { name: 'เปิดใช้งานบัญชี', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await panel.getByLabel('กรองสถานะสมาชิก', { exact: true }).selectOption('all');
    await expect(memberRow.getByText('ใช้งานได้', { exact: true })).toBeVisible();

    const outgoingOwner = initial.users.find(user => user.name === 'Sarah Chen');
    const owned = initial.projects.filter(project => project.ownerId === outgoingOwner.id);
    expect(owned.length).toBeGreaterThan(0);
    await panel.getByRole('button', { name: `ลบบัญชี ${outgoingOwner.name}`, exact: true }).click();
    confirmation = page.getByRole('dialog', { name: 'ลบบัญชีสมาชิกถาวร', exact: true });
    const deleteButton = confirmation.getByRole('button', { name: 'ยืนยันลบบัญชี', exact: true });
    await expect(deleteButton).toBeDisabled();
    await confirmation.getByLabel('พิมพ์อีเมลของสมาชิกเพื่อยืนยัน', { exact: true }).fill('wrong@example.test');
    await expect(deleteButton).toBeDisabled();
    await confirmation.getByLabel('พิมพ์อีเมลของสมาชิกเพื่อยืนยัน', { exact: true }).fill(outgoingOwner.email);
    await expect(deleteButton).toBeDisabled();
    await confirmation.getByRole('combobox', { name: 'ผู้รับโอนโปรเจกต์', exact: true }).selectOption(admin.id);
    await expect(deleteButton).toBeEnabled();
    await deleteButton.click();
    await expect(confirmation).toHaveCount(0);
    await expect(panel.locator('.room-admin-user')).toHaveCount(3);
    const remaining = await (await page.request.get('/api/admin/users')).json();
    expect(remaining.users.some(user => user.id === outgoingOwner.id)).toBe(false);
    for (const project of owned) {
      expect(remaining.projects.find(entry => entry.id === project.id)).toMatchObject({ ownerId: admin.id, taskCount: project.taskCount });
      const { tasks } = await (await page.request.get(`/api/projects/${project.id}/tasks`)).json();
      expect(tasks.every(task => !task.assigneeIds.includes(outgoingOwner.id))).toBe(true);
    }
    await panel.getByRole('button', { name: 'ปิดหน้าผู้ดูแลระบบ', exact: true }).click();
  } finally { await outsiderContext.close(); }
});

test('mobile workspace and multi-select menus fit the screen in all three views', async ({ page }) => {
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
  for (const label of ['Assignees', 'Type Content', 'Channels']) {
    await editor.getByRole('button', { name: label, exact: true }).click();
    const popup = editor.getByRole('group', { name: `${label} options`, exact: true });
    await expect(popup).toBeVisible();
    const bounds = await popup.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await expectNoPageOverflow(page);
    await popup.getByRole('textbox', { name: `Search ${label}`, exact: true }).press('Escape');
    await expect(popup).toHaveCount(0);
    await expect(editor).toBeVisible();
  }
  await editor.getByRole('button', { name: 'Close task details', exact: true }).click();
  await (await visibleTab(page, 'Calendar')).click();
  await expect(page.locator('.tm-calendar-grid')).toBeVisible();
  await expectNoPageOverflow(page);
  await page.getByRole('button', { name: 'เปิดเมนู', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ออกจากระบบ', exact: true })).toBeVisible();
  await expectNoPageOverflow(page);
});
