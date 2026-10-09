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
    const gradientSamples = image => {
      if (!image.startsWith('linear-gradient(')) return [];
      const stops = (image.match(/(?:rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8})/gi) || []).map(rgba);
      const samples = [];
      for (let index = 0; index < stops.length - 1; index++) {
        for (let step = 0; step <= 32; step++) {
          samples.push(stops[index].map((channel, component) => channel + (stops[index + 1][component] - channel) * step / 32));
        }
      }
      return samples;
    };
    const layers = [];
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      const color = rgba(style.backgroundColor);
      const samples = gradientSamples(style.backgroundImage);
      if (color[3] || samples.length) layers.push({ color, samples });
      if (color[3] === 255 || (samples.length && samples.every(sample => sample[3] === 255))) break;
    }
    const blend = (front, behind) => front.slice(0, 3).map((channel, index) => channel * front[3] / 255 + behind[index] * (1 - front[3] / 255));
    let backgrounds = [[255, 255, 255]];
    for (const layer of layers.reverse()) {
      backgrounds = backgrounds.flatMap(background => {
        const painted = blend(layer.color, background);
        return layer.samples.length ? layer.samples.map(sample => blend(sample, painted)) : [painted];
      });
    }
    const foreground = rgba(getComputedStyle(element).color);
    return { pairs: backgrounds.map(background => ({ foreground: blend(foreground, background), background })), layers: layers.length };
  });
  const luminance = color => {
    const channels = color.map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  expect(colors.layers, 'Text must have an identifiable background').toBeGreaterThan(0);
  for (const { foreground, background } of colors.pairs) {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    const ratio = (values[0] + 0.05) / (values[1] + 0.05);
    expect(ratio, `Text contrast ${foreground} on ${background}`).toBeGreaterThanOrEqual(minimum);
  }
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

function tagLocator(container, kind, value, className = '') {
  return container.locator(`${className}[data-tag-kind="${kind}"][data-tag-value="${value}"]`);
}

async function renderedIdentity(locator) {
  return locator.evaluate(element => {
    const style = getComputedStyle(element);
    const stripe = getComputedStyle(element, '::before');
    return {
      color: style.color,
      fill: style.backgroundColor,
      image: style.backgroundImage,
      stripeColor: stripe.backgroundColor,
      stripeImage: stripe.backgroundImage,
    };
  });
}

function sameFill(identity) {
  return { color: identity.color, fill: identity.fill, image: identity.image };
}

async function expectSavedIdentities(container, references, values, kind) {
  for (const value of values) {
    const tag = tagLocator(container, kind, value);
    await expect(tag).toBeVisible();
    await expect(tag).toHaveText(value);
    expect(sameFill(await renderedIdentity(tag)), `${value} should keep its identity between task surfaces`).toEqual(sameFill(references[value]));
    await expectReadableText(tag);
  }
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

test('platform and content colors remain distinct, readable and consistent from choices to saved List and Board tasks', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const formats = ['Video', 'Photo album', 'Infographic', 'Single Post', 'Reel', 'Story', 'ขายของ', 'Blog', 'Other'];
  const platforms = ['Facebook', 'Instagram', 'TikTok', 'YouTube', 'LINE', 'Website'];
  await page.goto('/');
  await page.getByRole('button', { name: 'ทดลองใช้ด้วยข้อมูลตัวอย่าง', exact: true }).click();
  await expect(page.locator('.project-heading h1')).toHaveText('Regagar');
  await expect(page.locator('.content-loader')).toHaveCount(0);
  await setTheme(page, false);
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  let editor = page.getByRole('dialog', { name: 'Create a task', exact: true });
  const title = 'เลือกสีคอนเทนต์และช่องทางโพสต์';
  await editor.getByLabel('Task name', { exact: true }).fill(title);
  const groups = {
    contentType: editor.getByRole('group', { name: 'Type Content options', exact: true }),
    channel: editor.getByRole('group', { name: 'Channels options', exact: true }),
  };
  const references = { contentType: {}, channel: {} };
  for (const [kind, values] of [['contentType', formats], ['channel', platforms]]) {
    const group = groups[kind];
    for (const value of values) {
      await group.getByRole('checkbox', { name: value, exact: true }).check();
      const choice = tagLocator(group, kind, value, '.tm-multi-choice');
      const chip = tagLocator(group, kind, value, '.tm-multi-chip');
      await expect(chip).toBeVisible();
      const chipFill = sameFill(await renderedIdentity(chip));
      await expect.poll(async () => sameFill(await renderedIdentity(choice)), { message: `${value} choice should settle to its selected label color` }).toEqual(chipFill);
      references[kind][value] = await renderedIdentity(choice);
      expect(chipFill, `${value} should look the same in the choice and selected label`).toEqual(sameFill(references[kind][value]));
      await expectReadableText(choice.locator('.tm-multi-choice-text strong'));
      await expectReadableText(chip.locator('.tm-multi-chip-label'));
    }
    expect(new Set(Object.values(references[kind]).map(identity => `${identity.fill}|${identity.image}`)).size, `${kind} labels need distinct visible fills`).toBe(values.length);
  }
  const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number);
  const [facebookRed, facebookGreen, facebookBlue] = rgb(references.channel.Facebook.fill);
  expect(facebookBlue - facebookRed, 'Facebook should have a blue identity').toBeGreaterThan(80);
  expect(facebookBlue - facebookGreen).toBeGreaterThan(60);
  const [youtubeRed, youtubeGreen, youtubeBlue] = rgb(references.channel.YouTube.fill);
  expect(youtubeRed - youtubeGreen, 'YouTube should have a red identity').toBeGreaterThan(100);
  expect(youtubeRed - youtubeBlue).toBeGreaterThan(60);
  const [lineRed, lineGreen, lineBlue] = rgb(references.channel.LINE.fill);
  expect(lineGreen - lineRed, 'LINE should have a green identity').toBeGreaterThan(80);
  expect(lineGreen - lineBlue).toBeGreaterThan(70);
  expect(references.channel.Instagram.image, 'Instagram should retain its visible gradient').toContain('linear-gradient(');
  expect(Math.max(...rgb(references.channel.TikTok.fill)), 'TikTok should have a dark identity').toBeLessThan(40);
  expect(references.channel.TikTok.stripeImage, 'TikTok should retain its cyan and pink accent').toContain('linear-gradient(');
  const tikTokAccents = (references.channel.TikTok.stripeImage.match(/rgb\([^)]*\)/g) || []).map(rgb);
  expect(tikTokAccents.some(([red, green, blue]) => green - red > 100 && blue - red > 100)).toBe(true);
  expect(tikTokAccents.some(([red, green, blue]) => red - green > 100 && blue > 40)).toBe(true);
  for (const value of formats.filter(format => format !== 'Other')) {
    const channels = rgb(references.contentType[value].fill);
    expect((Math.max(...channels) - Math.min(...channels)) / Math.max(...channels), `${value} should have a saturated color`).toBeGreaterThan(0.45);
  }
  await editor.locator('.tm-multi-inline-options').evaluateAll(elements => elements.forEach(element => { element.scrollTop = 0; }));
  await groups.contentType.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/room-tags-light-editor.png' });
  await editor.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(editor).toHaveCount(0);
  let row = page.locator('.tm-task-table tbody tr').filter({ has: page.getByRole('button', { name: title, exact: true }) });
  await expectSavedIdentities(row, references.contentType, formats, 'contentType');
  await expectSavedIdentities(row, references.channel, platforms, 'channel');
  await page.screenshot({ path: '/tmp/room-tags-light-list.png', fullPage: true });
  await page.locator('.view-tabs').getByRole('button', { name: /^Board/ }).click();
  let card = page.locator('.tm-board-card').filter({ has: page.getByRole('button', { name: title, exact: true }) });
  await expectSavedIdentities(card, references.contentType, formats, 'contentType');
  await expectSavedIdentities(card, references.channel, platforms, 'channel');
  await page.screenshot({ path: '/tmp/room-tags-light-board.png' });
  await setTheme(page, true);
  await expectSavedIdentities(card, references.contentType, formats, 'contentType');
  await expectSavedIdentities(card, references.channel, platforms, 'channel');
  await page.screenshot({ path: '/tmp/room-tags-dark-board.png' });
  await page.locator('.view-tabs').getByRole('button', { name: /^List/ }).click();
  row = page.locator('.tm-task-table tbody tr').filter({ has: page.getByRole('button', { name: title, exact: true }) });
  await expectSavedIdentities(row, references.contentType, formats, 'contentType');
  await expectSavedIdentities(row, references.channel, platforms, 'channel');
  await page.screenshot({ path: '/tmp/room-tags-dark-list.png', fullPage: true });
  await page.getByRole('button', { name: title, exact: true }).click();
  editor = page.getByRole('dialog', { name: 'Task details', exact: true });
  for (const [kind, values, label] of [['contentType', formats, 'Type Content'], ['channel', platforms, 'Channels']]) {
    const group = editor.getByRole('group', { name: `${label} options`, exact: true });
    for (const value of values) {
      await expect(group.getByRole('checkbox', { name: value, exact: true })).toBeChecked();
      const choice = tagLocator(group, kind, value, '.tm-multi-choice');
      const chip = tagLocator(group, kind, value, '.tm-multi-chip');
      expect(sameFill(await renderedIdentity(choice))).toEqual(sameFill(references[kind][value]));
      expect(sameFill(await renderedIdentity(chip))).toEqual(sameFill(references[kind][value]));
      await expectReadableText(choice.locator('.tm-multi-choice-text strong'));
      await expectReadableText(chip.locator('.tm-multi-chip-label'));
    }
  }
  await editor.getByRole('group', { name: 'Type Content options', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/room-tags-dark-editor.png' });
  await editor.getByRole('button', { name: 'Close task details', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('.sidebar').evaluate(element => Math.ceil(element.getBoundingClientRect().right))).toBeLessThanOrEqual(0);
  await row.locator('[data-label^="ประเภทคอนเทนต์"]').scrollIntoViewIfNeeded();
  await expectNoPageOverflow(page);
  await page.screenshot({ path: '/tmp/room-tags-dark-mobile.png' });
  await setTheme(page, false);
  await expectSavedIdentities(row, references.channel, platforms, 'channel');
  await expectNoPageOverflow(page);
  await page.screenshot({ path: '/tmp/room-tags-light-mobile.png' });
  expect(errors).toEqual([]);
});
