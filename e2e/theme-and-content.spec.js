import { test, expect } from '@playwright/test';

async function expectNoPageOverflow(page) {
  const { width, documentWidth, bodyWidth } = await page.evaluate(() => ({
    width: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(documentWidth).toBeLessThanOrEqual(width);
  expect(bodyWidth).toBeLessThanOrEqual(width);
}

async function expectReadableText(locator, minimum = 4.5) {
  const colors = await locator.evaluate(element => {
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = color => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    const layers = [];
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      const color = rgba(getComputedStyle(ancestor).backgroundColor);
      if (color[3]) layers.push(color);
      if (color[3] === 255) break;
    }
    const blend = (front, behind) => front.slice(0, 3).map((channel, index) => channel * front[3] / 255 + behind[index] * (1 - front[3] / 255));
    let background = [255, 255, 255];
    for (const layer of layers.reverse()) background = blend(layer, background);
    const foreground = blend(rgba(getComputedStyle(element).color), background);
    return { foreground, background, layers: layers.length };
  });
  const luminance = color => {
    const channels = color.map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  expect(colors.layers, 'Text must have an identifiable background').toBeGreaterThan(0);
  const values = [luminance(colors.foreground), luminance(colors.background)].sort((a, b) => b - a);
  const ratio = (values[0] + 0.05) / (values[1] + 0.05);
  expect(ratio, `Text contrast ${colors.foreground} on ${colors.background}`).toBeGreaterThanOrEqual(minimum);
}

async function setTheme(page, dark) {
  const toggle = page.getByRole('button', { name: 'สลับโหมดสี', exact: true });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-pressed')) !== String(dark)) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', String(dark));
  await expect(page.locator('html')).toHaveAttribute('data-theme', dark ? 'dark' : 'light');
}

async function expectReadableTaskMetadata(page) {
  const statuses = page.locator('.tm-group-heading .tm-status-badge');
  await expect(statuses).toHaveCount(5);
  for (const badge of await statuses.all()) await expectReadableText(badge);
  for (const priority of ['Urgent', 'High', 'Normal', 'Low']) {
    await expectReadableText(page.locator('.tm-priority').filter({ hasText: priority }).first());
  }
}

async function addChoice(group, label, value) {
  await group.getByRole('textbox', { name: `New ${label} option`, exact: true }).fill(value);
  await group.getByRole('button', { name: `Add ${label} option`, exact: true }).click();
  await expect(group.getByRole('checkbox', { name: value, exact: true })).toBeChecked();
}

async function expectChoiceContentsFit(group, value) {
  const choice = group.getByRole('checkbox', { name: value, exact: true }).locator('..');
  const bounds = await choice.boundingBox();
  for (const selector of ['.tm-multi-choice-text', '.tm-multi-checkbox']) {
    const content = choice.locator(selector);
    await expect(content).toBeVisible();
    const child = await content.boundingBox();
    expect(child.x).toBeGreaterThanOrEqual(bounds.x);
    expect(child.y).toBeGreaterThanOrEqual(bounds.y);
    expect(child.x + child.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(child.y + child.height).toBeLessThanOrEqual(bounds.y + bounds.height);
  }
  await expect(choice.locator('.tm-multi-checkbox svg')).toHaveCSS('opacity', '1');
}

test('light and dark modes persist while inline content and channels support multiple choices from a task cell', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'ทดลองใช้ด้วยข้อมูลตัวอย่าง', exact: true }).click();
  await expect(page.locator('.project-heading h1')).toHaveText('Regagar');
  await expect(page.locator('.content-loader')).toHaveCount(0);

  await setTheme(page, false);
  await expectReadableText(page.locator('.project-heading h1'), 3);
  await expectReadableTaskMetadata(page);
  await expectNoPageOverflow(page);
  await page.screenshot({ path: '/tmp/room-refresh-light-workspace.png', fullPage: true });
  await setTheme(page, true);
  await expectReadableText(page.locator('.project-heading h1'), 3);
  await expectReadableText(page.locator('.tm-task-title').first());
  await expectReadableTaskMetadata(page);
  await page.reload();
  await expect(page.locator('.project-heading h1')).toHaveText('Regagar');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'สลับโหมดสี', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: '/tmp/room-refresh-dark-workspace.png', fullPage: true });

  const { projects } = await (await page.request.get('/api/projects')).json();
  const project = projects.find(entry => entry.name === 'Regagar');
  const { tasks } = await (await page.request.get(`/api/projects/${project.id}/tasks`)).json();
  const task = tasks.find(entry => entry.status === 'todo');
  await page.getByRole('button', { name: `แก้ไขประเภทคอนเทนต์ของ ${task.title}`, exact: true }).click();
  let editor = page.getByRole('dialog', { name: 'Task details', exact: true });
  const content = editor.getByRole('group', { name: 'Type Content options', exact: true });
  const channels = editor.getByRole('group', { name: 'Channels options', exact: true });
  await expect(content).toBeVisible();
  await expect(channels).toBeVisible();
  await expect(content.getByRole('checkbox', { name: task.contentTypes[0], exact: true })).toBeChecked();
  await expect(channels.getByRole('checkbox', { name: task.channels[0], exact: true })).toBeChecked();
  await content.getByRole('button', { name: 'Clear Type Content', exact: true }).click();
  for (const value of ['Video', 'Photo album', 'Infographic']) await content.getByRole('checkbox', { name: value, exact: true }).check();
  await channels.getByRole('button', { name: 'Clear Channels', exact: true }).click();
  for (const value of ['Facebook', 'Instagram', 'TikTok']) await channels.getByRole('checkbox', { name: value, exact: true }).check();
  const customContent = 'รีวิวผลิตภัณฑ์';
  const customChannel = 'Shopee Live';
  await addChoice(content, 'Type Content', customContent);
  await addChoice(channels, 'Channels', customChannel);
  for (const value of ['Video', 'Photo album', 'Infographic', customContent]) await expect(content.getByRole('checkbox', { name: value, exact: true })).toBeChecked();
  for (const value of ['Facebook', 'Instagram', 'TikTok', customChannel]) await expect(channels.getByRole('checkbox', { name: value, exact: true })).toBeChecked();
  await expectChoiceContentsFit(content, 'Video');
  await expectChoiceContentsFit(channels, 'Facebook');
  await expectReadableText(content.locator('.tm-multi-choice-text strong').first());
  await content.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/room-refresh-dark-editor.png' });
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const persisted = await (await page.request.get(`/api/projects/${project.id}/tasks`)).json();
  expect(persisted.tasks.find(entry => entry.id === task.id)).toMatchObject({
    contentTypes: ['Video', 'Photo album', 'Infographic', customContent],
    channels: ['Facebook', 'Instagram', 'TikTok', customChannel],
  });
  await page.reload();
  await page.getByRole('button', { name: `แก้ไขช่องทางโพสต์ของ ${task.title}`, exact: true }).click();
  editor = page.getByRole('dialog', { name: 'Task details', exact: true });
  for (const value of ['Video', 'Photo album', 'Infographic', customContent]) await expect(editor.getByRole('group', { name: 'Type Content options', exact: true }).getByRole('checkbox', { name: value, exact: true })).toBeChecked();
  for (const value of ['Facebook', 'Instagram', 'TikTok', customChannel]) await expect(editor.getByRole('group', { name: 'Channels options', exact: true }).getByRole('checkbox', { name: value, exact: true })).toBeChecked();
  await editor.getByRole('button', { name: 'Close task details', exact: true }).click();
  await page.getByLabel(`Status for ${task.title}`, { exact: true }).selectOption('in_progress');
  await expect(page.getByLabel(`Status for ${task.title}`, { exact: true })).toHaveValue('in_progress');

  await setTheme(page, false);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: task.title, exact: true }).click();
  editor = page.getByRole('dialog', { name: 'Task details', exact: true });
  await editor.getByRole('group', { name: 'Type Content options', exact: true }).scrollIntoViewIfNeeded();
  await expectReadableText(editor.locator('.tm-multi-choice-text strong').first());
  await page.screenshot({ path: '/tmp/room-refresh-light-editor.png' });
  await editor.getByRole('button', { name: 'Close task details', exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.locator('.sidebar').evaluate(element => Math.ceil(element.getBoundingClientRect().right))).toBeLessThanOrEqual(0);
  await expectNoPageOverflow(page);
  await page.screenshot({ path: '/tmp/room-refresh-light-mobile.png' });
  await setTheme(page, true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectNoPageOverflow(page);
  await page.screenshot({ path: '/tmp/room-refresh-dark-mobile.png' });
  await page.getByRole('button', { name: `แก้ไขประเภทคอนเทนต์ของ ${task.title}`, exact: true }).click();
  editor = page.getByRole('dialog', { name: 'Task details', exact: true });
  const mobileContent = editor.getByRole('group', { name: 'Type Content options', exact: true });
  await mobileContent.scrollIntoViewIfNeeded();
  await expect(mobileContent.getByRole('checkbox', { name: 'Video', exact: true })).toBeChecked();
  await expectChoiceContentsFit(mobileContent, 'Video');
  await expectNoPageOverflow(page);
  await page.screenshot({ path: '/tmp/room-refresh-dark-mobile-editor.png' });
  await expect(editor.getByRole('button', { name: 'Save changes', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Close task details', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: 'บัญชีและความปลอดภัย', exact: true }).click();
  const security = page.getByRole('dialog', { name: 'บัญชีและความปลอดภัย', exact: true });
  await expect(security).toBeVisible();
  await expectReadableText(security.getByRole('heading', { name: 'บัญชีและความปลอดภัย', exact: true }), 3);
  await page.screenshot({ path: '/tmp/room-refresh-dark-account.png' });
  await security.getByRole('button', { name: 'ปิดบัญชีและความปลอดภัย', exact: true }).click();
  await page.getByRole('button', { name: 'การแจ้งเตือน', exact: true }).click();
  const notifications = page.getByRole('dialog', { name: 'การแจ้งเตือน', exact: true });
  await expect(notifications).toBeVisible();
  await expectReadableText(notifications.locator('.room-notification-content b').first());
  await expectReadableText(notifications.locator('.room-notification-content p').first());
  await page.screenshot({ path: '/tmp/room-refresh-dark-notifications.png' });
  expect(errors).toEqual([]);
});

test('first visit follows a dark system preference until a saved choice overrides it', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.evaluate(() => localStorage.setItem('room-theme', 'light'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
