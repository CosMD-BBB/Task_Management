import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

async function registerVerified(request, name) {
  const email = `comments-${randomUUID()}@example.test`;
  const password = `Comments-${randomUUID()}`;
  const registration = await request.post('/api/auth/register', { data: { name, email, password } });
  expect(registration.status()).toBe(201);
  const inboxResponse = await request.get('/api/auth/mail-preview');
  expect(inboxResponse.status()).toBe(200);
  const inbox = await inboxResponse.json();
  const link = new URL(inbox.messages.find(message => message.kind === 'verify').actionUrl);
  const verified = await request.post('/api/auth/verify-email', { data: { token: link.searchParams.get('token') } });
  expect(verified.status()).toBe(200);
  return { ...(await verified.json()), email };
}

async function createTask(request, name, title) {
  const projectResponse = await request.post('/api/projects', { data: { name } });
  expect(projectResponse.status()).toBe(201);
  const { project } = await projectResponse.json();
  const taskResponse = await request.post(`/api/projects/${project.id}/tasks`, { data: { title } });
  expect(taskResponse.status()).toBe(201);
  const { task } = await taskResponse.json();
  return { project, task };
}

async function invite(request, project, user, role) {
  const invited = await request.post(`/api/projects/${project.id}/members`, { data: { email: user.email, role } });
  expect(invited.status()).toBe(200);
}

async function openTaskComments(page, title) {
  await page.getByRole('button', { name: `ความคิดเห็นของ ${title}`, exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Task details', exact: true });
  await expect(editor).toBeVisible();
  await expect(editor).toHaveCSS('opacity', '1');
  await expect(page.locator('.tm-editor-overlay')).toHaveCSS('opacity', '1');
  const tab = editor.getByRole('tab', { name: 'ความคิดเห็น', exact: true });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(editor.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(0);
  return { editor, panel: editor.getByRole('tabpanel', { name: 'ความคิดเห็น', exact: true }) };
}

async function commentsFor(request, task) {
  const response = await request.get(`/api/tasks/${task.id}/comments`);
  expect(response.status()).toBe(200);
  return (await response.json()).comments;
}

async function notificationInbox(request) {
  const response = await request.get('/api/notifications');
  expect(response.status()).toBe(200);
  return response.json();
}

async function expectNoPageOverflow(page) {
  const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
}

function commentArticle(panel, id) {
  return panel.locator(`[data-comment-id="${id}"]`);
}

test('task captions, revision notes and mentions persist with independent recipient notifications and viewer permissions', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const owner = await registerVerified(page.request, 'Content Owner');
  const editorContext = await browser.newContext({ baseURL: test.info().project.use.baseURL, timezoneId: 'Asia/Bangkok' });
  const viewerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL, timezoneId: 'Asia/Bangkok' });
  try {
    const reviewer = await registerVerified(editorContext.request, 'พิมพ์ชนก ผู้ตรวจงาน');
    const viewerUser = await registerVerified(viewerContext.request, 'Viewer Review');
    const { project, task } = await createTask(page.request, 'Content comments studio', 'แคปชันและข้อเสนอแนะสำหรับทีม');
    await invite(page.request, project, reviewer, 'editor');
    await invite(page.request, project, viewerUser, 'viewer');
    const reviewerPage = await editorContext.newPage();
    const viewerPage = await viewerContext.newPage();
    reviewerPage.on('pageerror', error => errors.push(error.message));
    viewerPage.on('pageerror', error => errors.push(error.message));
    for (const current of [page, reviewerPage, viewerPage]) {
      await current.goto('/');
      await expect(current.locator('.project-heading h1')).toHaveText(project.name);
    }

    let { editor, panel } = await openTaskComments(page, task.title);
    const commentsTab = editor.getByRole('tab', { name: 'ความคิดเห็น', exact: true });
    const detailsTab = editor.getByRole('tab', { name: 'รายละเอียดงาน', exact: true });
    await commentsTab.focus();
    await commentsTab.press('ArrowLeft');
    await expect(detailsTab).toBeFocused();
    await expect(detailsTab).toHaveAttribute('aria-selected', 'true');
    await detailsTab.press('ArrowRight');
    await expect(commentsTab).toBeFocused();
    await expect(commentsTab).toHaveAttribute('aria-selected', 'true');
    const composer = panel.getByRole('textbox', { name: 'เขียนความคิดเห็น', exact: true });
    await panel.getByRole('combobox', { name: 'ประเภทข้อความ', exact: true }).selectOption('caption');
    const prefix = '🌿 แคปชันสำหรับทีม\n<img src=x onerror=window.__commentXss=1>\n';
    await composer.fill(`${prefix}@พิ`);
    let suggestions = panel.getByRole('listbox', { name: 'สมาชิกที่แท็กได้', exact: true });
    await expect(suggestions.getByRole('option', { name: `${reviewer.user.name} (${reviewer.email})`, exact: true })).toBeVisible();
    await composer.press('ArrowDown');
    await composer.press('Enter');
    await expect(suggestions).toHaveCount(0);
    await expect(composer).toHaveValue(new RegExp(`@${reviewer.user.name}`));
    await composer.fill(`${await composer.inputValue()}\n@Vie`);
    suggestions = panel.getByRole('listbox', { name: 'สมาชิกที่แท็กได้', exact: true });
    await suggestions.getByRole('option', { name: `${viewerUser.user.name} (${viewerUser.email})`, exact: true }).click();
    const captionBody = await composer.inputValue();
    await panel.getByRole('button', { name: 'ส่งความคิดเห็น', exact: true }).click();
    await expect(composer).toHaveValue('');
    let comments = await commentsFor(page.request, task);
    expect(comments).toHaveLength(1);
    const caption = comments[0];
    expect(caption).toMatchObject({ body: captionBody, kind: 'caption', author: { id: owner.user.id, name: owner.user.name }, canEdit: true, canDelete: true });
    expect(caption.mentions.map(mention => mention.userId)).toEqual([reviewer.user.id, viewerUser.user.id]);
    for (const mention of caption.mentions) expect(caption.body.slice(mention.start, mention.end)).toBe(`@${mention.name}`);
    const captionArticle = commentArticle(panel, caption.id);
    await expect(captionArticle).toBeVisible();
    await expect(captionArticle).toContainText('<img src=x onerror=window.__commentXss=1>');
    await expect(captionArticle.locator('.tm-comment-mention')).toHaveCount(2);
    await expect(captionArticle.locator('img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__commentXss)).toBeUndefined();
    await page.screenshot({ path: '/tmp/room-comments-light-desktop.png' });
    const recipientInbox = await notificationInbox(editorContext.request);
    const viewerInbox = await notificationInbox(viewerContext.request);
    expect(recipientInbox.unreadCount).toBe(1);
    expect(viewerInbox.unreadCount).toBe(1);
    expect((await notificationInbox(page.request)).unreadCount).toBe(0);
    expect(recipientInbox.notifications[0]).toMatchObject({ type: 'mention', taskId: task.id, commentId: caption.id, projectId: project.id });
    expect(viewerInbox.notifications[0]).toMatchObject({ type: 'mention', commentId: caption.id });

    // Opening the recipient's notification takes them to the mentioned comment and affects only their inbox.
    await reviewerPage.reload();
    await reviewerPage.getByRole('button', { name: 'การแจ้งเตือน', exact: true }).click();
    const openMention = reviewerPage.getByRole('dialog', { name: 'การแจ้งเตือน', exact: true }).getByRole('button', { name: 'ดูความคิดเห็น', exact: true });
    await expect(openMention).toBeVisible();
    await openMention.click();
    const recipientEditor = reviewerPage.getByRole('dialog', { name: 'Task details', exact: true });
    await expect(recipientEditor.getByRole('tab', { name: 'ความคิดเห็น', exact: true })).toHaveAttribute('aria-selected', 'true');
    const recipientArticle = commentArticle(recipientEditor.getByRole('tabpanel', { name: 'ความคิดเห็น', exact: true }), caption.id);
    await expect(recipientArticle).toBeInViewport();
    await expect(recipientArticle).toHaveClass(/tm-comment-highlighted/);
    expect((await notificationInbox(editorContext.request)).unreadCount).toBe(0);
    expect((await notificationInbox(viewerContext.request)).unreadCount).toBe(1);

    // Editing text around existing mentions must not send the same recipients a second notification.
    await captionArticle.getByRole('button', { name: 'แก้ไขความคิดเห็น', exact: true }).click();
    const editComposer = captionArticle.getByRole('textbox', { name: 'แก้ไขข้อความ', exact: true });
    await editComposer.fill(`${captionBody}\nตรวจทานแคปชันแล้ว`);
    await captionArticle.getByRole('button', { name: 'บันทึกความคิดเห็น', exact: true }).click();
    await expect(editComposer).toHaveCount(0);
    comments = await commentsFor(page.request, task);
    expect(comments[0].body).toBe(`${captionBody}\nตรวจทานแคปชันแล้ว`);
    expect(comments[0].mentions.map(mention => mention.userId)).toEqual([reviewer.user.id, viewerUser.user.id]);
    expect((await notificationInbox(editorContext.request)).notifications).toHaveLength(1);
    expect((await notificationInbox(viewerContext.request)).notifications).toHaveLength(1);
    expect((await notificationInbox(viewerContext.request)).unreadCount).toBe(1);

    await panel.getByRole('combobox', { name: 'ประเภทข้อความ', exact: true }).selectOption('revision');
    await composer.fill('ข้อแก้ไข: เพิ่มภาพสินค้าและ CTA\nรอทีมยืนยันก่อนโพสต์');
    await panel.getByRole('button', { name: 'ส่งความคิดเห็น', exact: true }).click();
    await expect(composer).toHaveValue('');
    await expect(page.getByRole('button', { name: `ความคิดเห็นของ ${task.title}`, exact: true })).toContainText('2');
    await recipientEditor.getByRole('tabpanel', { name: 'ความคิดเห็น', exact: true }).getByRole('textbox', { name: 'เขียนความคิดเห็น', exact: true }).fill('รับทราบ จะส่งภาพเวอร์ชันใหม่ให้ตรวจ');
    await recipientEditor.getByRole('tabpanel', { name: 'ความคิดเห็น', exact: true }).getByRole('button', { name: 'ส่งความคิดเห็น', exact: true }).click();
    comments = await commentsFor(page.request, task);
    expect(comments).toHaveLength(3);
    expect(comments.map(comment => comment.kind)).toEqual(['caption', 'revision', 'comment']);

    await editor.getByRole('button', { name: 'Close task details', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: `ความคิดเห็นของ ${task.title}`, exact: true })).toContainText('3');
    await page.locator('.view-tabs').getByRole('button', { name: /^Board/ }).click();
    await expect(page.getByRole('button', { name: `ความคิดเห็นของ ${task.title}`, exact: true })).toContainText('3');
    await page.locator('.view-tabs').getByRole('button', { name: /^List/ }).click();
    ({ editor, panel } = await openTaskComments(page, task.title));
    await expect(commentArticle(panel, caption.id)).toContainText('ตรวจทานแคปชันแล้ว');

    await viewerPage.reload();
    await viewerPage.getByRole('button', { name: 'การแจ้งเตือน', exact: true }).click();
    const openViewerMention = viewerPage.getByRole('dialog', { name: 'การแจ้งเตือน', exact: true }).getByRole('button', { name: 'ดูความคิดเห็น', exact: true });
    await expect(openViewerMention).toBeVisible();
    await openViewerMention.click();
    const viewerEditor = viewerPage.getByRole('dialog', { name: 'Task details', exact: true });
    const viewerPanel = viewerEditor.getByRole('tabpanel', { name: 'ความคิดเห็น', exact: true });
    await expect(commentArticle(viewerPanel, caption.id)).toBeVisible();
    const viewerComposer = viewerPanel.getByRole('textbox', { name: 'เขียนความคิดเห็น', exact: true });
    if (await viewerComposer.count()) await expect(viewerComposer).toBeDisabled();
    await expect(viewerPanel.getByRole('button', { name: 'ส่งความคิดเห็น', exact: true })).toHaveCount(0);
    await expect(viewerPanel.getByRole('button', { name: 'แก้ไขความคิดเห็น', exact: true })).toHaveCount(0);
    await expect(viewerPanel.getByRole('button', { name: 'ลบความคิดเห็น', exact: true })).toHaveCount(0);
    expect((await viewerContext.request.post(`/api/tasks/${task.id}/comments`, { data: { kind: 'comment', body: 'Viewer cannot send this', mentions: [] } })).status()).toBe(403);
    expect((await notificationInbox(viewerContext.request)).unreadCount).toBe(0);

    // A moderator deleting a message must not silently lose another member's active edit.
    const reviewerReply = comments.find(comment => comment.author.id === reviewer.user.id);
    const recipientPanel = recipientEditor.getByRole('tabpanel', { name: 'ความคิดเห็น', exact: true });
    const separateComposer = recipientPanel.getByRole('textbox', { name: 'เขียนความคิดเห็น', exact: true });
    const separateDraft = 'ข้อความอีกฉบับที่ยังไม่พร้อมส่ง';
    await separateComposer.fill(separateDraft);
    const reviewerReplyArticle = commentArticle(recipientPanel, reviewerReply.id);
    await reviewerReplyArticle.getByRole('button', { name: 'แก้ไขความคิดเห็น', exact: true }).click();
    const recoveredBody = 'อัปเดตหลังตรวจงาน\nจะส่งภาพสินค้าและแคปชันฉบับแก้ไขให้ทีม';
    await reviewerReplyArticle.getByRole('textbox', { name: 'แก้ไขข้อความ', exact: true }).fill(recoveredBody);
    await reviewerReplyArticle.getByRole('combobox', { name: 'ประเภทข้อความที่แก้ไข', exact: true }).selectOption('revision');
    const removedByOwner = await page.request.delete(`/api/tasks/${task.id}/comments/${reviewerReply.id}`);
    expect(removedByOwner.status()).toBe(204);
    await recipientPanel.getByRole('button', { name: 'รีเฟรชความคิดเห็น', exact: true }).click();
    await expect(reviewerReplyArticle).toHaveCount(0);
    const recoveredDraft = recipientPanel.getByRole('group', { name: 'ร่างความคิดเห็นที่ถูกลบ', exact: true });
    await expect(recoveredDraft).toBeVisible();
    await expect(recoveredDraft).toContainText('ข้อความเดิมถูกลบแล้ว ร่างของคุณยังอยู่');
    await expect(recoveredDraft.getByRole('textbox', { name: 'แก้ไขข้อความ', exact: true })).toHaveValue(recoveredBody);
    await expect(recoveredDraft.getByRole('combobox', { name: 'ประเภทข้อความที่แก้ไข', exact: true })).toHaveValue('revision');
    expect(await commentsFor(page.request, task)).toHaveLength(2);
    await recoveredDraft.getByRole('button', { name: 'ยกเลิกการแก้ไข', exact: true }).click();
    await expect(recipientPanel.getByRole('button', { name: 'ยกเลิกข้อความที่แก้ไข', exact: true })).toBeVisible();
    await recipientPanel.getByRole('button', { name: 'แก้ไขข้อความต่อ', exact: true }).click();
    await expect(recoveredDraft.getByRole('textbox', { name: 'แก้ไขข้อความ', exact: true })).toHaveValue(recoveredBody);
    await recipientEditor.getByRole('button', { name: 'Close task details', exact: true }).click();
    await recipientEditor.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(recoveredDraft.getByRole('textbox', { name: 'แก้ไขข้อความ', exact: true })).toHaveValue(recoveredBody);
    await recoveredDraft.scrollIntoViewIfNeeded();
    await expectNoPageOverflow(reviewerPage);
    await reviewerPage.screenshot({ path: '/tmp/room-comments-light-recovered-draft.png' });
    await recoveredDraft.getByRole('button', { name: 'ส่งเป็นความคิดเห็นใหม่', exact: true }).click();
    await expect(recoveredDraft).toHaveCount(0);
    await expect(separateComposer).toHaveValue(separateDraft);
    comments = await commentsFor(page.request, task);
    expect(comments).toHaveLength(3);
    expect(comments.some(comment => comment.id === reviewerReply.id)).toBe(false);
    const reposted = comments.filter(comment => comment.body === recoveredBody);
    expect(reposted).toHaveLength(1);
    expect(reposted[0]).toMatchObject({ kind: 'revision', author: { id: reviewer.user.id }, mentions: [] });
    await expect(commentArticle(recipientPanel, reposted[0].id)).toContainText(recoveredBody);
    await separateComposer.fill('');
    await recipientPanel.getByRole('button', { name: 'รีเฟรชความคิดเห็น', exact: true }).click();
    await expect(recipientPanel.locator('[data-comment-id]')).toHaveCount(3);
    await panel.getByRole('button', { name: 'รีเฟรชความคิดเห็น', exact: true }).click();
    await expect(commentArticle(panel, reposted[0].id)).toContainText(recoveredBody);

    await commentArticle(panel, caption.id).getByRole('button', { name: 'ลบความคิดเห็น', exact: true }).click();
    await panel.getByRole('button', { name: 'ยืนยันลบความคิดเห็น', exact: true }).click();
    await expect(commentArticle(panel, caption.id)).toHaveCount(0);
    expect(await commentsFor(page.request, task)).toHaveLength(2);
    await editor.getByRole('button', { name: 'Close task details', exact: true }).click();
    await expect(page.getByRole('button', { name: `ความคิดเห็นของ ${task.title}`, exact: true })).toContainText('2');
    await page.reload();
    await expect(page.getByRole('button', { name: `ความคิดเห็นของ ${task.title}`, exact: true })).toContainText('2');
    const theme = page.getByRole('button', { name: 'สลับโหมดสี', exact: true });
    if (await theme.getAttribute('aria-pressed') !== 'true') await theme.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    ({ editor, panel } = await openTaskComments(page, task.title));
    await expect(panel.locator('[data-comment-id]')).toHaveCount(2);
    await page.screenshot({ path: '/tmp/room-comments-dark-desktop.png' });
    expect(errors).toEqual([]);
  } finally { await editorContext.close(); await viewerContext.close(); }
});

test('mobile dark comments keep mention choices on screen and protect an unsent caption draft', async ({ page, browser }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const owner = await registerVerified(page.request, 'Mobile Owner');
  const recipientContext = await browser.newContext({ baseURL: test.info().project.use.baseURL, timezoneId: 'Asia/Bangkok' });
  try {
    const recipient = await registerVerified(recipientContext.request, 'Mobile Reviewer');
    const { project, task } = await createTask(page.request, 'Mobile content review', 'ตรวจแคปชันบนมือถือ');
    await invite(page.request, project, recipient, 'editor');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('.project-heading h1')).toHaveText(project.name);
    const theme = page.getByRole('button', { name: 'สลับโหมดสี', exact: true });
    if (await theme.getAttribute('aria-pressed') !== 'true') await theme.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    let { editor, panel } = await openTaskComments(page, task.title);
    let composer = panel.getByRole('textbox', { name: 'เขียนความคิดเห็น', exact: true });
    await panel.getByRole('combobox', { name: 'ประเภทข้อความ', exact: true }).selectOption('caption');
    await composer.fill('แคปชันฉบับร่าง\n@Mobile');
    const choices = panel.getByRole('listbox', { name: 'สมาชิกที่แท็กได้', exact: true });
    await expect(choices).toBeVisible();
    const bounds = await choices.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
    await expectNoPageOverflow(page);
    await page.screenshot({ path: '/tmp/room-comments-dark-mobile-mentions.png' });
    await choices.getByRole('option', { name: `${recipient.user.name} (${recipient.email})`, exact: true }).click();
    const draft = await composer.inputValue();
    await editor.getByRole('button', { name: 'Close task details', exact: true }).click();
    await expect(editor.getByRole('button', { name: 'Keep editing', exact: true })).toBeVisible();
    await editor.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(composer).toHaveValue(draft);
    await expect(panel.getByRole('combobox', { name: 'ประเภทข้อความ', exact: true })).toHaveValue('caption');
    await editor.getByRole('button', { name: 'Close task details', exact: true }).click();
    await editor.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect(await commentsFor(page.request, task)).toEqual([]);
    expect((await notificationInbox(recipientContext.request)).unreadCount).toBe(0);

    ({ editor, panel } = await openTaskComments(page, task.title));
    composer = panel.getByRole('textbox', { name: 'เขียนความคิดเห็น', exact: true });
    await expect(composer).toHaveValue('');
    await panel.getByRole('combobox', { name: 'ประเภทข้อความ', exact: true }).selectOption('caption');
    await composer.fill('พร้อมส่งให้ทีม\n@Mobile Rev');
    await panel.getByRole('listbox', { name: 'สมาชิกที่แท็กได้', exact: true }).getByRole('option', { name: `${recipient.user.name} (${recipient.email})`, exact: true }).click();
    const body = await composer.inputValue();
    await panel.getByRole('button', { name: 'ส่งความคิดเห็น', exact: true }).click();
    await expect(composer).toHaveValue('');
    const comments = await commentsFor(page.request, task);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ body, kind: 'caption', author: { id: owner.user.id }, mentions: [{ userId: recipient.user.id }] });
    await expect(commentArticle(panel, comments[0].id)).toContainText('พร้อมส่งให้ทีม');
    await expectNoPageOverflow(page);
    await page.screenshot({ path: '/tmp/room-comments-dark-mobile-thread.png' });
    await editor.getByRole('button', { name: 'Close task details', exact: true }).click();
    await theme.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    ({ editor, panel } = await openTaskComments(page, task.title));
    await expect(commentArticle(panel, comments[0].id)).toContainText('พร้อมส่งให้ทีม');
    await expectNoPageOverflow(page);
    await page.screenshot({ path: '/tmp/room-comments-light-mobile-thread.png' });
    expect(errors).toEqual([]);
  } finally { await recipientContext.close(); }
});
