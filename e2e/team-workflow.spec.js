import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

const runtimeErrors = new WeakMap();
test.beforeEach(async ({ context }) => {
  const errors = [];
  runtimeErrors.set(context, errors);
  const observe = page => page.on('pageerror', error => errors.push(error.message));
  context.pages().forEach(observe);
  context.on('page', observe);
});
test.afterEach(async ({ context }) => {
  expect(runtimeErrors.get(context)).toEqual([]);
});

async function openDemo(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'ทดลองใช้ด้วยข้อมูลตัวอย่าง', exact: true }).click();
  await expect(page.locator('.project-heading h1')).toHaveText('Regagar');
  await expect(page.locator('.content-loader')).toHaveCount(0);
  const response = await page.request.get('/api/projects');
  expect(response.status()).toBe(200);
  const { projects } = await response.json();
  return projects.find(project => project.name === 'Regagar');
}

async function createTask(request, project, data) {
  const response = await request.post(`/api/projects/${project.id}/tasks`, { data });
  expect(response.status()).toBe(201);
  return (await response.json()).task;
}

async function tasksFor(request, project) {
  const response = await request.get(`/api/projects/${project.id}/tasks`);
  expect(response.status()).toBe(200);
  return (await response.json()).tasks;
}

async function openTask(page, title) {
  await page.getByRole('button', { name: title, exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Task details', exact: true });
  await expect(editor).toBeVisible();
  await expect(editor).toHaveCSS('opacity', '1');
  return editor;
}

function projectButton(page, name) {
  return page.locator('.project-nav').getByRole('button').filter({ has: page.getByText(name, { exact: true }) });
}

async function expectNoOverflow(page) {
  const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
}

async function holdNextResponse(page, pattern, method) {
  let release, started, finished;
  const released = new Promise(resolve => { release = resolve; });
  const startedPromise = new Promise(resolve => { started = resolve; });
  const finishedPromise = new Promise(resolve => { finished = resolve; });
  let held = false;
  await page.route(pattern, async route => {
    if (held || route.request().method() !== method) { await route.continue(); return; }
    held = true;
    const response = await route.fetch();
    started(response.status());
    await released;
    await route.fulfill({ response });
    finished();
  });
  return { release, started: startedPromise, finished: finishedPromise };
}

async function finishResponseRendering(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test('task filters distinguish no matches from an empty project and my-task totals include the displayed completed tasks', async ({ page }) => {
  await openDemo(page);
  const userResponse = await page.request.get('/api/auth/me');
  expect(userResponse.status()).toBe(200);
  const { user } = await userResponse.json();
  const projectName = `ทีมตรวจตัวกรอง ${randomUUID().slice(0, 6)}`;
  const projectResponse = await page.request.post('/api/projects', { data: { name: projectName } });
  expect(projectResponse.status()).toBe(201);
  const { project } = await projectResponse.json();
  const fixtures = [
    { title: 'ทำวิดีโอขายสินค้า', priority: 'urgent', status: 'todo', contentTypes: ['Video', 'ขายของ'], channels: ['Facebook', 'Instagram'], assigneeIds: [user.id] },
    { title: 'งานเสร็จแล้วของฉัน', priority: 'normal', status: 'done', contentTypes: ['Infographic'], channels: ['LINE'], assigneeIds: [user.id] },
    { title: 'รอทีมตรวจภาพ', priority: 'high', status: 'review', contentTypes: ['Photo album'], channels: ['YouTube'], assigneeIds: [] },
  ];
  for (const fixture of fixtures) await createTask(page.request, project, fixture);
  await page.reload();
  await projectButton(page, projectName).click();
  await expect(page.locator('.tm-task-title')).toHaveCount(3);
  const mine = page.locator('.sidebar-nav').getByRole('button', { name: /^งานของฉัน/ });
  await expect(mine.locator('.nav-count')).toHaveText('2');
  await mine.click();
  await expect(page.locator('.tm-task-title')).toHaveCount(2);
  await expect(page.getByRole('button', { name: fixtures[1].title, exact: true })).toBeVisible();
  await page.locator('.sidebar-nav').getByRole('button', { name: /^งานทั้งหมด/ }).click();
  await page.getByRole('button', { name: 'ตัวกรอง', exact: true }).click();
  const filters = page.locator('.filter-panel');
  await filters.getByLabel(/^ประเภทคอนเทนต์/).selectOption('Video');
  await filters.getByLabel(/^ช่องทางโพสต์/).selectOption('Instagram');
  await expect(page.locator('.tm-task-title')).toHaveCount(1);
  await expect(page.getByRole('button', { name: fixtures[0].title, exact: true })).toBeVisible();
  await filters.getByLabel(/^ความสำคัญ/).selectOption('low');
  await expect(page.getByRole('heading', { name: 'ไม่พบงานที่ตรงกับตัวกรอง', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'เพิ่มงานแรก', exact: true })).toHaveCount(0);
  await page.locator('.tm-empty').getByRole('button', { name: 'ล้างตัวกรอง', exact: true }).click();
  await expect(page.locator('.tm-task-title')).toHaveCount(3);
  for (const label of [/^ประเภทคอนเทนต์/, /^ช่องทางโพสต์/, /^ความสำคัญ/]) await expect(filters.getByLabel(label)).toHaveValue('all');
  await page.locator('.view-tabs').getByRole('button', { name: /^Calendar/ }).click();
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  const selectedMonth = await page.locator('.tm-calendar-month h2').textContent();
  await filters.getByLabel(/^ความสำคัญ/).selectOption('low');
  await expect(page.getByRole('heading', { name: 'ไม่พบงานที่ตรงกับตัวกรอง', exact: true })).toBeVisible();
  await expect(page.locator('.tm-calendar-month h2')).toHaveText(selectedMonth);
  await page.locator('.tm-empty').getByRole('button', { name: 'ล้างตัวกรอง', exact: true }).click();
  await expect(page.locator('.tm-calendar-view')).toBeVisible();
  await expect(page.locator('.tm-calendar-month h2')).toHaveText(selectedMonth);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('.sidebar').evaluate(node => node.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  await expectNoOverflow(page);
  await page.screenshot({ path: '/tmp/room-audit-filters-fixed-mobile.png' });
});

test('project settings keeps keyboard focus inside and guards unsaved changes before discarding or saving', async ({ page }) => {
  await openDemo(page);
  const visibleChannelStyles = new Map();
  for (const value of ['Facebook', 'Instagram', 'TikTok']) {
    visibleChannelStyles.set(value, await page.locator(`.tm-task-tags [data-tag-kind="channel"][data-tag-value="${value}"]`).first().evaluate(node => {
      const css = getComputedStyle(node); return { background: css.backgroundColor, image: css.backgroundImage, color: css.color };
    }));
  }
  const trigger = page.getByRole('button', { name: 'ตั้งค่าโปรเจกต์', exact: true });
  await trigger.click();
  let settings = page.getByRole('dialog', { name: 'ตั้งค่าโปรเจกต์', exact: true });
  const name = settings.getByLabel('ชื่อโปรเจกต์', { exact: true });
  const description = settings.getByRole('textbox', { name: 'รายละเอียด', exact: true });
  const originalDescription = await description.inputValue();
  await expect(name).toBeFocused();
  for (const value of ['Facebook', 'Instagram', 'TikTok']) {
    const appearance = await settings.locator(`[data-tag-kind="channel"][data-tag-value="${value}"]`).evaluate(node => {
      const css = getComputedStyle(node); return { background: css.backgroundColor, image: css.backgroundImage, color: css.color };
    });
    expect(appearance).toEqual(visibleChannelStyles.get(value));
  }
  const close = settings.getByRole('button', { name: 'ปิด', exact: true });
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  expect(await settings.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await name.fill('Regagar บรีฟที่ยังไม่บันทึก');
  const unsavedDescription = 'บรีฟสำหรับทีม\nรอยืนยันก่อนเริ่มเผยแพร่';
  await description.fill(unsavedDescription);
  await page.keyboard.press('Escape');
  const warning = page.getByRole('alertdialog', { name: 'มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก', exact: true });
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: 'แก้ไขต่อ', exact: true }).click();
  await expect(name).toHaveValue('Regagar บรีฟที่ยังไม่บันทึก');
  await expect(description).toHaveValue(unsavedDescription);
  await close.click();
  await warning.getByRole('button', { name: 'ทิ้งการเปลี่ยนแปลง', exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  settings = page.getByRole('dialog', { name: 'ตั้งค่าโปรเจกต์', exact: true });
  await expect(settings.getByLabel('ชื่อโปรเจกต์', { exact: true })).toHaveValue('Regagar');
  await expect(settings.getByRole('textbox', { name: 'รายละเอียด', exact: true })).toHaveValue(originalDescription);
  const savedName = `ทีมคอนเทนต์ ${randomUUID().slice(0, 6)}`;
  await settings.getByLabel('ชื่อโปรเจกต์', { exact: true }).fill(savedName);
  await settings.getByRole('textbox', { name: 'รายละเอียด', exact: true }).fill(unsavedDescription);
  await settings.getByRole('button', { name: 'บันทึกการตั้งค่า', exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect(page.locator('.project-heading h1')).toHaveText(savedName);
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  settings = page.getByRole('dialog', { name: 'ตั้งค่าโปรเจกต์', exact: true });
  await expect(settings.getByLabel('ชื่อโปรเจกต์', { exact: true })).toBeFocused();
  await expect(settings.getByRole('textbox', { name: 'รายละเอียด', exact: true })).toHaveValue(unsavedDescription);
  await expectNoOverflow(page);
  await page.screenshot({ path: '/tmp/room-audit-settings-fixed-mobile.png' });
  await settings.getByRole('button', { name: 'ปิด', exact: true }).click();
});

test('content and channel cells focus their visible picker and Enter in tag search never saves or creates a task', async ({ page }) => {
  const project = await openDemo(page);
  const title = await page.locator('.tm-task-title').first().innerText();
  const before = (await tasksFor(page.request, project)).find(task => task.title === title);
  for (const [kind, label] of [['ประเภทคอนเทนต์', 'Type Content'], ['ช่องทางโพสต์', 'Channels']]) {
    await page.getByRole('button', { name: `แก้ไข${kind}ของ ${title}`, exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Task details', exact: true });
    const search = editor.getByRole('textbox', { name: `Search ${label}`, exact: true });
    await expect(search).toBeFocused();
    await expect(search).toBeInViewport();
    await search.fill(label === 'Channels' ? 'Facebook' : 'Video');
    await search.press('Enter');
    await expect(editor).toBeVisible();
    const after = (await tasksFor(page.request, project)).find(task => task.id === before.id);
    expect(after.updatedAt).toBe(before.updatedAt);
    await editor.getByRole('button', { name: 'Close task details', exact: true }).click();
    if (await editor.getByRole('button', { name: 'Discard changes', exact: true }).count()) await editor.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(editor).toHaveCount(0);
  }
  const countBefore = (await tasksFor(page.request, project)).length;
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Create a task', exact: true });
  const newTitle = `ค้นหาแท็กก่อนบันทึก ${randomUUID().slice(0, 6)}`;
  await editor.getByLabel('Task name', { exact: true }).fill(newTitle);
  const search = editor.getByRole('textbox', { name: 'Search Type Content', exact: true });
  await search.fill('Video');
  await search.press('Enter');
  await expect(editor).toBeVisible();
  expect(await tasksFor(page.request, project)).toHaveLength(countBefore);
  await editor.getByRole('group', { name: 'Type Content options', exact: true }).getByRole('checkbox', { name: 'Video', exact: true }).check();
  await editor.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const saved = await tasksFor(page.request, project);
  expect(saved).toHaveLength(countBefore + 1);
  expect(saved.find(task => task.title === newTitle).contentTypes).toContain('Video');

  // An old assignment stays understandable after suspension but cannot be added to new work.
  const { user } = await (await page.request.get('/api/auth/me')).json();
  const member = project.members.find(entry => entry.userId !== user.id);
  const historicalTitle = `งานเดิมของสมาชิก ${randomUUID().slice(0, 6)}`;
  const historical = await createTask(page.request, project, { title: historicalTitle, assigneeIds: [member.userId] });
  const suspended = await page.request.patch(`/api/admin/users/${member.userId}`, { data: { disabled: true } });
  expect(suspended.status()).toBe(200);
  await page.reload();
  const historicalEditor = await openTask(page, historicalTitle);
  await historicalEditor.getByRole('button', { name: 'Assignees', exact: true }).click();
  const existingChoices = historicalEditor.getByRole('group', { name: 'Assignees options', exact: true });
  const historicalChoice = existingChoices.getByRole('checkbox', { name: member.user.name, exact: true });
  await expect(historicalChoice).toBeChecked();
  await expect(existingChoices.getByText(`${member.user.email} · ระงับบัญชี`, { exact: true })).toBeVisible();
  await historicalChoice.click();
  await expect(historicalChoice).toHaveCount(0);
  await existingChoices.getByRole('button', { name: 'เสร็จแล้ว', exact: true }).click();
  await historicalEditor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(historicalEditor).toHaveCount(0);
  expect((await tasksFor(page.request, project)).find(task => task.id === historical.id).assigneeIds).toEqual([]);
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  const freshEditor = page.getByRole('dialog', { name: 'Create a task', exact: true });
  await freshEditor.getByRole('button', { name: 'Assignees', exact: true }).click();
  await expect(freshEditor.getByRole('group', { name: 'Assignees options', exact: true }).getByRole('checkbox', { name: member.user.name, exact: true })).toHaveCount(0);
  await freshEditor.getByRole('group', { name: 'Assignees options', exact: true }).getByRole('button', { name: 'เสร็จแล้ว', exact: true }).click();
  await freshEditor.getByRole('button', { name: 'Close task details', exact: true }).click();
  await expect(freshEditor).toHaveCount(0);
});

test('two tabs cannot silently overwrite a newer task and loading the latest version requires discarding the visible draft', async ({ page, context }) => {
  const project = await openDemo(page);
  const title = `งานตรวจเวอร์ชัน ${randomUUID().slice(0, 6)}`;
  const task = await createTask(page.request, project, { title, description: 'บรีฟเริ่มต้น' });
  await page.reload();
  const firstEditor = await openTask(page, title);
  const firstDraft = 'ร่างจากแท็บแรกที่ยังไม่บันทึก\nต้องเก็บข้อความนี้ไว้';
  await firstEditor.getByLabel('Description', { exact: true }).fill(firstDraft);
  await firstEditor.getByLabel('Status', { exact: true }).selectOption('in_progress');
  const secondPage = await context.newPage();
  try {
    await secondPage.goto('/');
    const secondEditor = await openTask(secondPage, title);
    const latestTitle = `${title} ล่าสุด`;
    const latestBody = 'บรีฟที่ทีมแก้ไขและบันทึกแล้ว';
    await secondEditor.getByLabel('Task name', { exact: true }).fill(latestTitle);
    await secondEditor.getByLabel('Description', { exact: true }).fill(latestBody);
    await secondEditor.getByLabel('Status', { exact: true }).selectOption('review');
    await secondEditor.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(secondEditor).toHaveCount(0);
    const rejected = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith(`/api/tasks/${task.id}`));
    await firstEditor.getByRole('button', { name: 'Save changes', exact: true }).click();
    expect((await rejected).status()).toBe(409);
    await expect(firstEditor.getByLabel('Description', { exact: true })).toHaveValue(firstDraft);
    await expect(firstEditor.getByLabel('Status', { exact: true })).toHaveValue('in_progress');
    await expect(firstEditor.getByRole('alert', { name: 'งานนี้มีข้อมูลใหม่', exact: true })).toBeVisible();
    await expect(firstEditor.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await page.screenshot({ path: '/tmp/room-audit-task-conflict-desktop.png' });
    await expect(firstEditor.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true })).toBeVisible();
    let current = (await tasksFor(page.request, project)).find(item => item.id === task.id);
    expect(current).toMatchObject({ title: latestTitle, description: latestBody, status: 'review' });
    await firstEditor.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click();
    await firstEditor.getByRole('button', { name: 'กลับไปแก้ไขต่อ', exact: true }).click();
    await expect(firstEditor.getByLabel('Description', { exact: true })).toHaveValue(firstDraft);
    await firstEditor.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click();
    await firstEditor.getByRole('button', { name: 'ยืนยันโหลดข้อมูลล่าสุด', exact: true }).click();
    const refreshed = page.getByRole('dialog', { name: 'Task details', exact: true });
    await expect(refreshed.getByLabel('Task name', { exact: true })).toHaveValue(latestTitle);
    await expect(refreshed.getByLabel('Description', { exact: true })).toHaveValue(latestBody);
    await expect(refreshed.getByLabel('Status', { exact: true })).toHaveValue('review');
    await page.screenshot({ path: '/tmp/room-audit-task-refreshed-desktop.png' });
    const resolvedBody = `${latestBody}\nยืนยันหลังตรวจเวอร์ชันล่าสุด`;
    await refreshed.getByLabel('Description', { exact: true }).fill(resolvedBody);
    await refreshed.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(refreshed).toHaveCount(0);
    current = (await tasksFor(page.request, project)).find(item => item.id === task.id);
    expect(current).toMatchObject({ title: latestTitle, description: resolvedBody, status: 'review' });
  } finally { await secondPage.close(); }
});

test('a failed project load shows a retry action rather than a misleading first-project form', async ({ page }) => {
  let failed = false;
  await page.route('**/api/projects', async route => {
    if (!failed && route.request().method() === 'GET') {
      failed = true;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary project outage', code: 'SERVICE_UNAVAILABLE' }) });
    } else await route.continue();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'ทดลองใช้ด้วยข้อมูลตัวอย่าง', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ลองโหลดโปรเจกต์อีกครั้ง', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'สร้างโปรเจกต์แรก', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'ลองโหลดโปรเจกต์อีกครั้ง', exact: true }).click();
  await expect(page.locator('.project-heading h1')).toHaveText('Regagar');
  await expect(page.locator('.content-loader')).toHaveCount(0);
  expect(failed).toBe(true);
  await expect(page.locator('.tm-task-title')).not.toHaveCount(0);
  const { projects } = await (await page.request.get('/api/projects')).json();
  const another = projects.find(project => project.name !== 'Regagar');
  let failedTasks = false;
  await page.route(`**/api/projects/${another.id}/tasks`, async route => {
    if (!failedTasks && route.request().method() === 'GET') {
      failedTasks = true;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary task outage', code: 'SERVICE_UNAVAILABLE' }) });
    } else await route.continue();
  });
  await projectButton(page, another.name).click();
  await expect(page.getByRole('heading', { name: 'โหลดงานไม่สำเร็จ', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New task', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'เพิ่มงานแรก', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'ลองโหลดงานอีกครั้ง', exact: true }).click();
  await expect(page.locator('.content-loader')).toHaveCount(0);
  await expect(page.locator('.tm-task-title')).not.toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New task', exact: true })).toBeEnabled();
});

test('returning to a workspace refreshes new team tasks while preserving an open brief draft', async ({ page }) => {
  const project = await openDemo(page);
  const title = await page.locator('.tm-task-title').first().innerText();
  const editedTask = (await tasksFor(page.request, project)).find(task => task.title === title);
  const editor = await openTask(page, title);
  const draft = 'บรีฟที่กำลังเขียน\nยังต้องเก็บไว้หลังอัปเดตงานทีม';
  await editor.getByLabel('Description', { exact: true }).fill(draft);
  const addedTitle = `งานใหม่จากทีม ${randomUUID().slice(0, 6)}`;
  await createTask(page.request, project, { title: addedTitle, status: 'todo' });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: addedTitle, exact: true })).toHaveCount(1);
  await expect(editor.getByLabel('Description', { exact: true })).toHaveValue(draft);
  await expect(editor.getByLabel('Task name', { exact: true })).toHaveValue(title);
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const tasks = await tasksFor(page.request, project);
  expect(tasks.find(task => task.id === editedTask.id).description).toBe(draft);
  expect(tasks.some(task => task.title === addedTitle)).toBe(true);
});

test('a delayed notification fetch cannot replace a different project or its open task draft', async ({ page }) => {
  const project = await openDemo(page);
  const { projects } = await (await page.request.get('/api/projects')).json();
  const another = projects.find(item => item.id !== project.id);
  const otherTasks = await tasksFor(page.request, another);
  const { notifications } = await (await page.request.get('/api/notifications')).json();
  const notification = notifications.find(item => item.projectId === project.id && item.taskId);
  expect(notification).toBeTruthy();
  const delayed = await holdNextResponse(page, `**/api/projects/${project.id}/tasks`, 'GET');
  try {
    await page.getByRole('button', { name: 'การแจ้งเตือน', exact: true }).click();
    const inbox = page.getByRole('dialog', { name: 'การแจ้งเตือน', exact: true });
    await inbox.getByRole('button', { name: notification.type === 'mention' ? 'ดูความคิดเห็น' : 'เปิดงาน', exact: true }).click();
    expect(await delayed.started).toBe(200);
    await inbox.getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true }).click();
    await projectButton(page, another.name).click();
    await expect(page.locator('.project-heading h1')).toHaveText(another.name);
    await expect(page.locator('.tm-task-title')).toHaveCount(otherTasks.length);
    const editor = await openTask(page, otherTasks[0].title);
    const draft = 'ร่างบรีฟในโปรเจกต์ที่เลือกใหม่';
    await editor.getByLabel('Description', { exact: true }).fill(draft);
    delayed.release();
    await delayed.finished;
    await finishResponseRendering(page);
    await expect(page.locator('.project-heading h1')).toHaveText(another.name);
    await expect(editor.getByLabel('Task name', { exact: true })).toHaveValue(otherTasks[0].title);
    await expect(editor.getByLabel('Description', { exact: true })).toHaveValue(draft);
    await expect(page.locator('.tm-task-title')).toHaveCount(otherTasks.length);
    await expect(page.getByRole('button', { name: notification.title, exact: true })).toHaveCount(0);
    await expect(page.locator('.content-loader')).toHaveCount(0);
  } finally { delayed.release(); }
});

test('an old status response after logout cannot update the next session or leave its task controls loading', async ({ page }) => {
  const project = await openDemo(page);
  const { user: originalUser } = await (await page.request.get('/api/auth/me')).json();
  const title = await page.locator('.tm-task-title').first().innerText();
  const task = (await tasksFor(page.request, project)).find(item => item.title === title);
  const delayed = await holdNextResponse(page, `**/api/tasks/${task.id}`, 'PATCH');
  try {
    await page.getByLabel(`Status for ${title}`, { exact: true }).selectOption('in_progress');
    expect(await delayed.started).toBe(200);
    await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).click();
    await expect(page.getByRole('button', { name: 'ทดลองใช้ด้วยข้อมูลตัวอย่าง', exact: true })).toBeVisible();
    const nextProject = await openDemo(page);
    const { user: nextUser } = await (await page.request.get('/api/auth/me')).json();
    expect(nextUser.id).not.toBe(originalUser.id);
    const nextTasks = await tasksFor(page.request, nextProject);
    const sameNamedTask = nextTasks.find(item => item.title === title);
    delayed.release();
    await delayed.finished;
    await finishResponseRendering(page);
    await expect(page.locator('.project-heading h1')).toHaveText(nextProject.name);
    await expect(page.locator('.tm-task-title')).toHaveCount(nextTasks.length);
    await expect(page.getByLabel(`Status for ${title}`, { exact: true })).toHaveValue(sameNamedTask.status);
    await expect(page.getByRole('status').filter({ hasText: 'อัปเดตสถานะแล้ว' })).toHaveCount(0);
    await expect(page.locator('.content-loader')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New task', exact: true })).toBeEnabled();
    const nextTitle = `งานหลังเข้าสู่ระบบใหม่ ${randomUUID().slice(0, 6)}`;
    await createTask(page.request, nextProject, { title: nextTitle });
    await page.getByRole('button', { name: 'รีเฟรชงาน', exact: true }).click();
    await expect(page.getByRole('button', { name: nextTitle, exact: true })).toBeVisible();
  } finally { delayed.release(); }
});
