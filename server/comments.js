import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sameScope } from './domain.js';

const mentionSchema = z.object({
  userId: z.string().min(1).max(100).regex(/^[\w-]+$/),
  start: z.number().int().min(0),
  end: z.number().int().min(1),
}).strict();
const bodySchema = z.string().min(1).max(10000).refine((body) => body.trim().length > 0, 'Write a comment before posting');
const commentShape = {
  body: bodySchema,
  kind: z.enum(['comment', 'caption', 'revision']),
  mentions: z.array(mentionSchema).max(20),
};
const createSchema = z.object({
  ...commentShape, kind: commentShape.kind.default('comment'), mentions: commentShape.mentions.default([]),
}).strict();
const patchSchema = z.object(commentShape).partial().strict().refine((value) => Object.keys(value).length > 0, 'Provide a comment change');

function isUtf16Boundary(body, position) {
  if (position === 0 || position === body.length) return true;
  const before = body.charCodeAt(position - 1);
  const after = body.charCodeAt(position);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

export function installCommentRoutes(app, { db, projectAccess, safeUser, authenticated, HttpError, requireEditor }) {
  const missing = () => new HttpError(404, 'The requested item was not found.', 'NOT_FOUND');
  const forbidden = () => new HttpError(403, 'You do not have permission to make this change.', 'FORBIDDEN');
  const invalidMention = () => new HttpError(400, 'Mention an active project member using their complete name.', 'INVALID_MENTION');
  async function taskAccess(taskId, userId, queryDb = db, lock = false) {
    const task = await queryDb.get(`SELECT * FROM tasks WHERE id = ?${lock && queryDb.kind === 'postgres' ? ' FOR UPDATE' : ''}`, [taskId]);
    if (!task) throw missing();
    const project = await projectAccess(task.project_id, userId, queryDb);
    return { task, project };
  }
  function serializeComment(row, user, project) {
    const editable = ['owner', 'editor'].includes(project.yourRole);
    const author = row.author_id === user.id;
    return {
      id: row.id, taskId: row.task_id, projectId: row.project_id, body: row.body, kind: row.kind,
      mentions: JSON.parse(row.mentions_json),
      author: {
        id: row.author_id,
        name: row.current_author_name ?? row.author_name,
        avatarColor: row.current_author_color ?? row.author_avatar_color,
      },
      createdAt: row.created_at, updatedAt: row.updated_at,
      canEdit: editable && author,
      canDelete: editable && (author || project.yourRole === 'owner'),
    };
  }
  async function commentRow(commentId, taskId, queryDb = db) {
    return queryDb.get(`SELECT c.*, u.name AS current_author_name, u.avatar_color AS current_author_color
      FROM task_comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.id = ? AND c.task_id = ?`, [commentId, taskId]);
  }
  async function validateMentions(body, mentions, project, tx, previousMentions = [], previousBody = '') {
    const ordered = [...mentions].sort((a, b) => a.start - b.start || a.end - b.end);
    let previousEnd = 0;
    const users = new Map();
    const result = [];
    for (const mention of ordered) {
      if (mention.start < previousEnd || mention.end <= mention.start || mention.end > body.length
        || !isUtf16Boundary(body, mention.start) || !isUtf16Boundary(body, mention.end)) throw invalidMention();
      previousEnd = mention.end;
      const label = body.slice(mention.start, mention.end);
      if (!label.startsWith('@')) throw invalidMention();
      if (!users.has(mention.userId)) {
        const user = await tx.get(`SELECT u.* FROM users u WHERE u.id = ? AND (u.id = ? OR EXISTS (
          SELECT 1 FROM project_members m WHERE m.project_id = ? AND m.user_id = u.id
        ))`, [mention.userId, project.owner_id, project.id]);
        if (!user || user.disabled_at || !safeUser(user).emailVerified || !sameScope(user, { demo_scope_id: project.owner_demo_scope_id })) {
          throw invalidMention();
        }
        users.set(mention.userId, user);
      }
      const user = users.get(mention.userId);
      // Renames must not invalidate an unchanged historical mention of this same person.
      const historical = previousMentions.find((previous) => previous.userId === mention.userId
        && previousBody.slice(previous.start, previous.end) === label && label === `@${previous.name}`);
      if (label !== `@${user.name}` && !historical) throw invalidMention();
      result.push({ ...mention, name: label.slice(1) });
    }
    return result;
  }
  function notificationBody(actor, kind, body) {
    const label = { comment: 'ความคิดเห็น', caption: 'แคปชั่น', revision: 'จุดแก้ไข' }[kind];
    const characters = Array.from(body.replace(/\s+/gu, ' ').trim());
    const preview = characters.slice(0, 100).join('') + (characters.length > 100 ? '…' : '');
    return `${actor.name} พูดถึงคุณใน${label}: ${preview}`;
  }
  async function refreshMentionNotifications(comment, previousMentions, actor, task, tx) {
    const recipientIds = [...new Set(comment.mentions.map((mention) => mention.userId))].filter((userId) => userId !== actor.id);
    const previousIds = new Set(previousMentions.map((mention) => mention.userId));
    const existing = await tx.all('SELECT id, user_id FROM notifications WHERE comment_id = ?', [comment.id]);
    for (const notice of existing) {
      if (!recipientIds.includes(notice.user_id)) await tx.run('DELETE FROM notifications WHERE id = ?', [notice.id]);
    }
    const title = JSON.parse(task.data_json).title;
    const body = notificationBody(actor, comment.kind, comment.body);
    // Retained mentions keep their original read state while the preview stays current.
    await tx.run('UPDATE notifications SET title = ?, body = ? WHERE comment_id = ?', [title, body, comment.id]);
    for (const userId of recipientIds.filter((id) => !previousIds.has(id))) {
      await tx.run(`INSERT INTO notifications (id, user_id, actor_id, project_id, task_id, comment_id, type, title, body, created_at, read_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (comment_id, user_id) WHERE comment_id IS NOT NULL DO NOTHING`, [
        randomUUID(), userId, actor.id, comment.projectId, comment.taskId, comment.id, 'mention', title, body,
        new Date().toISOString(), null,
      ]);
    }
  }

  app.get('/api/tasks/:id/comments', authenticated, async (req, res) => {
    const { project } = await taskAccess(req.params.id, req.user.id);
    const rows = await db.all(`SELECT c.*, u.name AS current_author_name, u.avatar_color AS current_author_color
      FROM task_comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.task_id = ? ORDER BY c.created_at, c.id`, [req.params.id]);
    res.json({ comments: rows.map((row) => serializeComment(row, req.user, project)) });
  });
  app.post('/api/tasks/:id/comments', authenticated, async (req, res) => {
    const input = createSchema.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const { task, project } = await taskAccess(req.params.id, req.user.id, tx, true);
      requireEditor(project);
      const actor = await tx.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
      const mentions = await validateMentions(input.body, input.mentions, project, tx);
      const now = new Date().toISOString();
      const id = randomUUID();
      await tx.run(`INSERT INTO task_comments (id, task_id, project_id, author_id, author_name, author_avatar_color, body, kind, mentions_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        id, task.id, project.id, actor.id, actor.name, actor.avatar_color, input.body, input.kind, JSON.stringify(mentions), now, now,
      ]);
      await refreshMentionNotifications({ id, taskId: task.id, projectId: project.id, body: input.body, kind: input.kind, mentions }, [], actor, task, tx);
      return serializeComment(await commentRow(id, task.id, tx), req.user, project);
    });
    res.status(201).json({ comment: result });
  });
  app.patch('/api/tasks/:taskId/comments/:commentId', authenticated, async (req, res) => {
    const input = patchSchema.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const { task, project } = await taskAccess(req.params.taskId, req.user.id, tx, true);
      requireEditor(project);
      const current = await commentRow(req.params.commentId, task.id, tx);
      if (!current) throw missing();
      if (current.author_id !== req.user.id) throw forbidden();
      const actor = await tx.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
      const previousMentions = JSON.parse(current.mentions_json);
      const body = input.body ?? current.body;
      let mentions = previousMentions;
      if (Object.hasOwn(input, 'mentions')) mentions = await validateMentions(body, input.mentions, project, tx, previousMentions, current.body);
      else if (body !== current.body) mentions = [];
      const kind = input.kind ?? current.kind;
      const updatedAt = new Date().toISOString();
      await tx.run('UPDATE task_comments SET body = ?, kind = ?, mentions_json = ?, author_name = ?, author_avatar_color = ?, updated_at = ? WHERE id = ?', [
        body, kind, JSON.stringify(mentions), actor.name, actor.avatar_color, updatedAt, current.id,
      ]);
      await refreshMentionNotifications({ id: current.id, taskId: task.id, projectId: project.id, body, kind, mentions }, previousMentions, actor, task, tx);
      return serializeComment(await commentRow(current.id, task.id, tx), req.user, project);
    });
    res.json({ comment: result });
  });
  app.delete('/api/tasks/:taskId/comments/:commentId', authenticated, async (req, res) => {
    await db.transaction(async (tx) => {
      const { task, project } = await taskAccess(req.params.taskId, req.user.id, tx, true);
      requireEditor(project);
      const current = await commentRow(req.params.commentId, task.id, tx);
      if (!current) throw missing();
      if (current.author_id !== req.user.id && project.yourRole !== 'owner') throw forbidden();
      await tx.run('DELETE FROM task_comments WHERE id = ?', [current.id]);
    });
    res.status(204).end();
  });
}
