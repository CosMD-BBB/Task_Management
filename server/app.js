import express from 'express';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from './database.js';
import { seedDemo } from './seed.js';
import { installAccountRoutes } from './accounts.js';
import { installCommentRoutes } from './comments.js';
import { normalizeTaskInput, normalizeStoredTask, uniqueTags, sameScope, nextUpdatedAt } from './domain.js';
import {
  projectSchema, projectPatchSchema, projectTagSchema, memberSchema, taskSchema, taskPatchSchema,
} from './validation.js';

const COOKIE = 'teamflow_session';
const SESSION_DURATION = 14 * 24 * 60 * 60 * 1000;
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const missing = () => new HttpError(404, 'The requested item was not found.', 'NOT_FOUND');
const forbidden = () => new HttpError(403, 'You do not have permission to make this change.', 'FORBIDDEN');

export async function createApp(options = {}) {
  const db = await openDatabase(options);
  const transaction = db.transaction;
  db.transaction = (operation) => transaction(async (tx) => {
    // Match SQLite's serialized writes across PostgreSQL instances, including account changes.
    if (tx.kind === 'postgres') await tx.get('SELECT pg_advisory_xact_lock(814721901)');
    return operation(tx);
  });
  const mailMode = (options.mailMode ?? process.env.MAIL_MODE) === 'preview' ? 'preview' : 'resend';
  const safeUser = (row) => ({
    id: row.id, name: row.name, email: row.email, avatarColor: row.avatar_color,
    emailVerified: Boolean(row.email_verified) && (mailMode === 'preview' || Boolean(row.demo_scope_id) || row.email_verified_mode === 'resend'),
    globalRole: row.global_role ?? 'member', disabled: Boolean(row.disabled_at), demoScopeId: row.demo_scope_id ?? null,
  });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.locals.db = db;
  app.locals.close = () => db.close();
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  // Browser sessions are same-origin. This also protects JSON mutations from CSRF.
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.get('host')) {
          return next(new HttpError(403, 'Requests must come from this website.', 'ORIGIN_MISMATCH'));
        }
      } catch { return next(new HttpError(403, 'Invalid request origin.', 'ORIGIN_MISMATCH')); }
    }
    next();
  });
  app.use('/api', async (req, res, next) => {
    const token = req.cookies[COOKIE];
    if (typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)) {
      const row = await db.get(
        'SELECT u.* FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled_at IS NULL',
        [hashToken(token), new Date().toISOString()],
      );
      if (row) req.user = safeUser(row);
    }
    next();
  });
  const authenticated = (req, res, next) => req.user
    ? next() : next(new HttpError(401, 'Please log in to continue.', 'UNAUTHENTICATED'));
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 35, standardHeaders: 'draft-8', legacyHeaders: false,
    skip: () => options.disableRateLimit === true,
    message: { error: 'Too many attempts. Please try again in 15 minutes.', code: 'RATE_LIMITED' },
  });
  const demoLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false,
    skip: () => options.disableRateLimit === true,
    message: { error: 'Too many demo sessions. Please try again later.', code: 'RATE_LIMITED' },
  });
  const cookieOptions = (req) => ({
    httpOnly: true, sameSite: 'lax', secure: Boolean(process.env.VERCEL || req.secure),
    path: '/', maxAge: SESSION_DURATION,
  });
  async function signIn(req, res, user, { queryDb, expectedPasswordHash } = {}) {
    const token = randomBytes(32).toString('hex');
    const persist = async (tx) => {
      const current = await tx.get('SELECT * FROM users WHERE id = ?', [user.id]);
      if (!current || current.disabled_at || expectedPasswordHash && current.password_hash !== expectedPasswordHash) {
        throw new HttpError(401, 'Email or password is incorrect, or this account is suspended.', 'INVALID_CREDENTIALS');
      }
      const priorToken = req.cookies[COOKIE];
      if (typeof priorToken === 'string') await tx.run('DELETE FROM sessions WHERE token_hash = ?', [hashToken(priorToken)]);
      await tx.run('DELETE FROM sessions WHERE expires_at <= ?', [new Date().toISOString()]);
      await tx.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [
        hashToken(token), current.id, new Date(Date.now() + SESSION_DURATION).toISOString(),
      ]);
      return current;
    };
    const current = queryDb ? await persist(queryDb) : await db.transaction(persist);
    res.cookie(COOKIE, token, cookieOptions(req));
    return current;
  }
  async function lockProject(projectId, tx) {
    const project = await tx.get(`SELECT id FROM projects WHERE id = ?${tx.kind === 'postgres' ? ' FOR UPDATE' : ''}`, [projectId]);
    if (!project) throw missing();
  }
  async function projectAccess(projectId, userId, queryDb = db) {
    const user = await queryDb.get('SELECT * FROM users WHERE id = ?', [userId]);
    const row = await queryDb.get(
      `SELECT p.*, m.role AS member_role, o.demo_scope_id AS owner_demo_scope_id FROM projects p
       JOIN users o ON o.id = p.owner_id
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
       WHERE p.id = ?`, [userId, projectId],
    );
    if (!row || !user || user.disabled_at || !safeUser(user).emailVerified || !sameScope(user, { demo_scope_id: row.owner_demo_scope_id })
      || (row.owner_id !== userId && !row.member_role && user.global_role !== 'superadmin')) throw missing();
    return { ...row, yourRole: row.owner_id === userId || user.global_role === 'superadmin' ? 'owner' : row.member_role };
  }
  async function serializeProject(row) {
    const members = await db.all(
      `SELECT u.*, m.role FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ? ORDER BY u.name`,
      [row.id],
    );
    const owner = await db.get('SELECT * FROM users WHERE id = ?', [row.owner_id]);
    const taskRows = await db.all('SELECT data_json FROM tasks WHERE project_id = ?', [row.id]);
    const tasks = taskRows.map((task) => normalizeStoredTask(JSON.parse(task.data_json)));
    return {
      id: row.id, name: row.name, description: row.description, color: row.color,
      ownerId: row.owner_id, fields: JSON.parse(row.fields_json), yourRole: row.yourRole,
      coverImage: row.cover_image || null,
      contentTypeOptions: uniqueTags([...JSON.parse(row.content_type_options_json || '[]'), ...tasks.flatMap((task) => task.contentTypes)]),
      channelOptions: uniqueTags([...JSON.parse(row.channel_options_json || '[]'), ...tasks.flatMap((task) => task.channels)]),
      members: [
        { userId: owner.id, role: 'owner', user: safeUser(owner) },
        ...members.filter((member) => sameScope(member, owner)).map((member) => ({ userId: member.id, role: member.role, user: safeUser(member) })),
      ],
      taskCount: tasks.length,
      completedCount: tasks.filter((task) => task.status === 'done').length,
      createdAt: row.created_at,
    };
  }
  const requireEditor = (project) => { if (!['owner', 'editor'].includes(project.yourRole)) throw forbidden(); };
  const requireOwner = (project) => { if (project.yourRole !== 'owner') throw forbidden(); };
  async function validateTaskForProject(task, project, queryDb = db, previousAssigneeIds = []) {
    for (const assigneeId of task.assigneeIds) {
      const assignee = await queryDb.get('SELECT * FROM users WHERE id = ?', [assigneeId]);
      const member = assigneeId === project.owner_id || await queryDb.get(
        'SELECT user_id FROM project_members WHERE project_id = ? AND user_id = ?', [project.id, assigneeId],
      );
      const historical = previousAssigneeIds.includes(assigneeId);
      if (!member || !assignee || !sameScope(assignee, { demo_scope_id: project.owner_demo_scope_id })
        || !historical && (assignee.disabled_at || !safeUser(assignee).emailVerified)) {
        throw new HttpError(400, 'The assignee must be an active, verified member of this project.', 'INVALID_ASSIGNEE');
      }
    }
    const fields = JSON.parse(project.fields_json);
    for (const [fieldId, value] of Object.entries(task.customFields)) {
      const field = fields.find((entry) => entry.id === fieldId);
      if (!field || (field.type === 'select' && value && !field.options.includes(value))) {
        throw new HttpError(400, 'A custom field or selected value is invalid.', 'INVALID_CUSTOM_FIELD');
      }
    }
    const subtaskIds = task.subtasks.map((subtask) => subtask.id).filter(Boolean);
    if (new Set(subtaskIds).size !== subtaskIds.length) {
      throw new HttpError(400, 'Subtasks must have unique IDs.', 'INVALID_SUBTASK');
    }
    task.subtasks = task.subtasks.map((entry) => ({ ...entry, id: entry.id ?? randomUUID() }));
  }
  async function writeTask(task, queryDb = db) {
    await queryDb.run('UPDATE tasks SET data_json = ?, updated_at = ? WHERE id = ?', [JSON.stringify(normalizeStoredTask(task)), task.updatedAt, task.id]);
  }
  async function persistTaskTags(task, projectId, tx) {
    const row = await tx.get(`SELECT content_type_options_json, channel_options_json FROM projects WHERE id = ?${tx.kind === 'postgres' ? ' FOR UPDATE' : ''}`, [projectId]);
    const contentTypeOptions = JSON.parse(row.content_type_options_json || '[]');
    const channelOptions = JSON.parse(row.channel_options_json || '[]');
    const canonical = (tags, options) => tags.map((value) => options.find((option) => option.toLocaleLowerCase('en-US') === value.toLocaleLowerCase('en-US')) ?? value);
    task.contentTypes = canonical(task.contentTypes, contentTypeOptions);
    task.channels = canonical(task.channels, channelOptions);
    const nextContentTypes = uniqueTags([...contentTypeOptions, ...task.contentTypes]);
    const nextChannels = uniqueTags([...channelOptions, ...task.channels]);
    if (nextContentTypes.length > 200 || nextChannels.length > 200) {
      throw new HttpError(400, 'This project has reached its limit of 200 tags.', 'TAG_LIMIT');
    }
    await tx.run('UPDATE projects SET content_type_options_json = ?, channel_options_json = ? WHERE id = ?', [
      JSON.stringify(nextContentTypes), JSON.stringify(nextChannels), projectId,
    ]);
    return normalizeStoredTask(task);
  }
  async function notifyAssignments(task, previousIds, actor, project, tx) {
    for (const userId of task.assigneeIds.filter((id) => !previousIds.includes(id))) {
      await tx.run(`INSERT INTO notifications (id, user_id, actor_id, project_id, task_id, type, title, body, created_at, read_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        randomUUID(), userId, actor.id, project.id, task.id, 'assignment', task.title,
        `${actor.name} มอบหมายงานให้คุณในโปรเจกต์ ${project.name}`, new Date().toISOString(), null,
      ]);
    }
  }
  const serializeNotification = (row) => ({
    id: row.id, userId: row.user_id, actorId: row.actor_id, projectId: row.project_id, taskId: row.task_id,
    type: row.type, title: row.title, body: row.body, createdAt: row.created_at, readAt: row.read_at,
    commentId: row.comment_id ?? null,
  });
  async function accessibleNotifications(user) {
    const rows = await db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC', [user.id]);
    const accessible = [];
    const projectResults = new Map();
    for (const row of rows) {
      if (!projectResults.has(row.project_id)) {
        try { await projectAccess(row.project_id, user.id); projectResults.set(row.project_id, true); }
        catch (error) { if (error.status !== 404) throw error; projectResults.set(row.project_id, false); }
      }
      if (projectResults.get(row.project_id)) accessible.push(row);
      else await db.run('DELETE FROM notifications WHERE id = ? AND user_id = ?', [row.id, user.id]);
    }
    return accessible;
  }

  app.get('/api/health', (req, res) => res.json({ status: 'ok', storage: db.kind }));
  await installAccountRoutes(app, {
    db, signIn, cookieOptions, safeUser, hashToken, HttpError, authenticated,
    authLimiter, demoLimiter, seedDemo, options, cookieName: COOKIE,
  });
  app.use(['/api/projects', '/api/tasks', '/api/users', '/api/notifications'], authenticated, (req, res, next) => {
    if (!req.user.emailVerified) return next(new HttpError(403, 'Verify your email before using the workspace.', 'EMAIL_NOT_VERIFIED'));
    next();
  });
  installCommentRoutes(app, { db, projectAccess, safeUser, authenticated, HttpError, requireEditor });

  app.get('/api/projects', authenticated, async (req, res) => {
    const rows = await db.all(
      `SELECT DISTINCT p.*, m.role AS member_role FROM projects p JOIN users o ON o.id = p.owner_id
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
       WHERE (p.owner_id = ? OR m.user_id = ? OR ? = 'superadmin')
       AND COALESCE(o.demo_scope_id, '') = ? ORDER BY p.created_at, p.name`,
      [req.user.id, req.user.id, req.user.id, req.user.globalRole, req.user.demoScopeId || ''],
    );
    const projects = await Promise.all(rows.map((row) => serializeProject({
      ...row, yourRole: row.owner_id === req.user.id || req.user.globalRole === 'superadmin' ? 'owner' : row.member_role,
    })));
    res.json({ projects });
  });
  app.post('/api/projects', authenticated, async (req, res) => {
    const input = projectSchema.parse(req.body);
    const projectId = randomUUID();
    await db.transaction(async (tx) => {
      const actor = await tx.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
      if (!actor || actor.disabled_at || !safeUser(actor).emailVerified) {
        throw new HttpError(403, 'An active, verified account is required.', 'FORBIDDEN');
      }
      await tx.run(`INSERT INTO projects (id, name, description, color, owner_id, fields_json, created_at, cover_image, content_type_options_json, channel_options_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        projectId, input.name, input.description, input.color, actor.id, JSON.stringify(input.fields), new Date().toISOString(),
        input.coverImage, JSON.stringify(input.contentTypeOptions), JSON.stringify(input.channelOptions),
      ]);
    });
    res.status(201).json({ project: await serializeProject(await projectAccess(projectId, req.user.id)) });
  });
  app.get('/api/projects/:id', authenticated, async (req, res) => {
    res.json({ project: await serializeProject(await projectAccess(req.params.id, req.user.id)) });
  });
  app.patch('/api/projects/:id', authenticated, async (req, res) => {
    const input = projectPatchSchema.parse(req.body);
    await db.transaction(async (tx) => {
      await lockProject(req.params.id, tx);
      const project = await projectAccess(req.params.id, req.user.id, tx);
      requireOwner(project);
      const fields = input.fields ?? JSON.parse(project.fields_json);
      const contentTypeOptions = uniqueTags([...JSON.parse(project.content_type_options_json || '[]'), ...(input.contentTypeOptions || [])]);
      const channelOptions = uniqueTags([...JSON.parse(project.channel_options_json || '[]'), ...(input.channelOptions || [])]);
      if (contentTypeOptions.length > 200 || channelOptions.length > 200) {
        throw new HttpError(400, 'This project has reached its limit of 200 tags.', 'TAG_LIMIT');
      }
      await tx.run(`UPDATE projects SET name = ?, description = ?, color = ?, fields_json = ?, cover_image = ?, content_type_options_json = ?, channel_options_json = ? WHERE id = ?`, [
        input.name ?? project.name, input.description ?? project.description,
        input.color ?? project.color, JSON.stringify(fields), Object.hasOwn(input, 'coverImage') ? input.coverImage : project.cover_image,
        JSON.stringify(contentTypeOptions), JSON.stringify(channelOptions), project.id,
      ]);
      if (input.fields) {
        const rows = await tx.all(`SELECT data_json FROM tasks WHERE project_id = ? ORDER BY id${tx.kind === 'postgres' ? ' FOR UPDATE' : ''}`, [project.id]);
        for (const row of rows) {
          const task = normalizeStoredTask(JSON.parse(row.data_json));
          const customFields = Object.fromEntries(Object.entries(task.customFields).filter(([fieldId, value]) => {
            const field = fields.find((entry) => entry.id === fieldId);
            return field && (field.type === 'text' || !value || field.options.includes(value));
          }));
          if (JSON.stringify(customFields) !== JSON.stringify(task.customFields)) {
            task.customFields = customFields;
            task.updatedAt = nextUpdatedAt(task.updatedAt);
            await writeTask(task, tx);
          }
        }
      }
    });
    res.json({ project: await serializeProject(await projectAccess(req.params.id, req.user.id)) });
  });
  app.patch('/api/projects/:id/tags', authenticated, async (req, res) => {
    const input = projectTagSchema.parse(req.body);
    await db.transaction(async (tx) => {
      await lockProject(req.params.id, tx);
      const project = await projectAccess(req.params.id, req.user.id, tx);
      requireEditor(project);
      const column = input.kind === 'contentType' ? 'content_type_options_json' : 'channel_options_json';
      const options = uniqueTags([...JSON.parse(project[column] || '[]'), input.value]);
      if (options.length > 200) throw new HttpError(400, 'This project has reached its limit of 200 tags.', 'TAG_LIMIT');
      await tx.run(`UPDATE projects SET ${column} = ? WHERE id = ?`, [JSON.stringify(options), project.id]);
    });
    res.json({ project: await serializeProject(await projectAccess(req.params.id, req.user.id)) });
  });
  app.delete('/api/projects/:id', authenticated, async (req, res) => {
    await db.transaction(async (tx) => {
      await lockProject(req.params.id, tx);
      const project = await projectAccess(req.params.id, req.user.id, tx);
      requireOwner(project);
      await tx.run('DELETE FROM projects WHERE id = ?', [project.id]);
    });
    res.status(204).end();
  });
  app.post('/api/projects/:id/members', authenticated, async (req, res) => {
    const input = memberSchema.parse(req.body);
    await db.transaction(async (tx) => {
      await lockProject(req.params.id, tx);
      const project = await projectAccess(req.params.id, req.user.id, tx);
      requireOwner(project);
      const user = await tx.get('SELECT * FROM users WHERE email = ?', [input.email]);
      if (!user || user.disabled_at || !sameScope(user, { demo_scope_id: project.owner_demo_scope_id })) {
        throw new HttpError(404, 'This person needs to register with that email first.', 'USER_NOT_FOUND');
      }
      if (user.id === project.owner_id) throw new HttpError(400, 'The project owner already has full access.', 'OWNER_ROLE');
      await tx.run(`INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)
        ON CONFLICT (project_id, user_id) DO UPDATE SET role = excluded.role`, [project.id, user.id, input.role]);
    });
    res.json({ project: await serializeProject(await projectAccess(req.params.id, req.user.id)) });
  });
  app.delete('/api/projects/:id/members/:userId', authenticated, async (req, res) => {
    await db.transaction(async (tx) => {
      await lockProject(req.params.id, tx);
      const project = await projectAccess(req.params.id, req.user.id, tx);
      requireOwner(project);
      if (req.params.userId === project.owner_id) throw new HttpError(400, 'The project owner cannot be removed.', 'OWNER_ROLE');
      await tx.run('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [project.id, req.params.userId]);
      await tx.run('DELETE FROM notifications WHERE project_id = ? AND user_id = ?', [project.id, req.params.userId]);
      const tasks = await tx.all(`SELECT data_json FROM tasks WHERE project_id = ? ORDER BY id${tx.kind === 'postgres' ? ' FOR UPDATE' : ''}`, [project.id]);
      for (const row of tasks) {
        const task = normalizeStoredTask(JSON.parse(row.data_json));
        if (task.assigneeIds.includes(req.params.userId)) {
          task.assigneeIds = task.assigneeIds.filter((id) => id !== req.params.userId);
          task.updatedAt = nextUpdatedAt(task.updatedAt);
          await writeTask(task, tx);
        }
      }
    });
    res.json({ project: await serializeProject(await projectAccess(req.params.id, req.user.id)) });
  });
  app.get('/api/projects/:id/tasks', authenticated, async (req, res) => {
    const project = await projectAccess(req.params.id, req.user.id);
    const rows = await db.all(`SELECT t.data_json, (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) AS comments_count
      FROM tasks t WHERE t.project_id = ? ORDER BY t.created_at, t.id`, [project.id]);
    res.json({ tasks: rows.map((row) => ({ ...normalizeStoredTask(JSON.parse(row.data_json)), commentsCount: Number(row.comments_count) })) });
  });
  app.post('/api/projects/:id/tasks', authenticated, async (req, res) => {
    const input = taskSchema.parse(normalizeTaskInput(req.body));
    const task = await db.transaction(async (tx) => {
      await lockProject(req.params.id, tx);
      const project = await projectAccess(req.params.id, req.user.id, tx);
      requireEditor(project);
      await validateTaskForProject(input, project, tx);
      const now = new Date().toISOString();
      let task = normalizeStoredTask({ ...input, id: randomUUID(), projectId: project.id, createdAt: now, updatedAt: now });
      task = await persistTaskTags(task, project.id, tx);
      await tx.run('INSERT INTO tasks (id, project_id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
        task.id, project.id, JSON.stringify(task), now, now,
      ]);
      await notifyAssignments(task, [], req.user, project, tx);
      return task;
    });
    res.status(201).json({ task: { ...task, commentsCount: 0 } });
  });
  app.patch('/api/tasks/:id', authenticated, async (req, res) => {
    const { expectedUpdatedAt, ...input } = taskPatchSchema.parse(normalizeTaskInput(req.body));
    const row = await db.get('SELECT project_id FROM tasks WHERE id = ?', [req.params.id]);
    if (!row) throw missing();
    const task = await db.transaction(async (tx) => {
      await lockProject(row.project_id, tx);
      const project = await projectAccess(row.project_id, req.user.id, tx);
      requireEditor(project);
      const currentRow = await tx.get(`SELECT data_json FROM tasks WHERE id = ?${tx.kind === 'postgres' ? ' FOR UPDATE' : ''}`, [req.params.id]);
      if (!currentRow) throw missing();
      const currentTask = normalizeStoredTask(JSON.parse(currentRow.data_json));
      const count = await tx.get('SELECT COUNT(*) AS count FROM task_comments WHERE task_id = ?', [currentTask.id]);
      if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== currentTask.updatedAt) {
        const error = new HttpError(409, 'This task was updated by a teammate. Review their changes before saving.', 'TASK_CONFLICT');
        error.currentTask = { ...currentTask, commentsCount: Number(count.count) };
        throw error;
      }
      let task = normalizeStoredTask({ ...currentTask, ...input, updatedAt: nextUpdatedAt(currentTask.updatedAt) });
      await validateTaskForProject(task, project, tx, currentTask.assigneeIds);
      task = await persistTaskTags(task, project.id, tx);
      await writeTask(task, tx);
      await notifyAssignments(task, currentTask.assigneeIds, req.user, project, tx);
      return { ...task, commentsCount: Number(count.count) };
    });
    res.json({ task });
  });
  app.delete('/api/tasks/:id', authenticated, async (req, res) => {
    const row = await db.get('SELECT project_id FROM tasks WHERE id = ?', [req.params.id]);
    if (!row) throw missing();
    await db.transaction(async (tx) => {
      await lockProject(row.project_id, tx);
      const project = await projectAccess(row.project_id, req.user.id, tx);
      requireEditor(project);
      const current = await tx.get(`SELECT id FROM tasks WHERE id = ?${tx.kind === 'postgres' ? ' FOR UPDATE' : ''}`, [req.params.id]);
      if (!current) throw missing();
      await tx.run('DELETE FROM tasks WHERE id = ?', [current.id]);
    });
    res.status(204).end();
  });
  app.get('/api/users', authenticated, async (req, res) => {
    // Only expose teammates from rooms the user can access, never the full user directory.
    const rows = await db.all(
      `SELECT DISTINCT u.* FROM users u WHERE COALESCE(u.demo_scope_id, '') = ? AND (
        u.id = ? OR u.id IN (
          SELECT p.owner_id FROM projects p JOIN users owner ON owner.id = p.owner_id
          LEFT JOIN project_members mine ON mine.project_id = p.id AND mine.user_id = ?
          WHERE (p.owner_id = ? OR mine.user_id = ? OR ? = 'superadmin') AND COALESCE(owner.demo_scope_id, '') = ?
        ) OR u.id IN (
          SELECT m.user_id FROM project_members m JOIN projects p ON p.id = m.project_id JOIN users owner ON owner.id = p.owner_id
          LEFT JOIN project_members mine ON mine.project_id = p.id AND mine.user_id = ?
          WHERE (p.owner_id = ? OR mine.user_id = ? OR ? = 'superadmin') AND COALESCE(owner.demo_scope_id, '') = ?
        )
      ) ORDER BY u.name`,
      [req.user.demoScopeId || '', req.user.id, req.user.id, req.user.id, req.user.id, req.user.globalRole,
        req.user.demoScopeId || '', req.user.id, req.user.id, req.user.id, req.user.globalRole, req.user.demoScopeId || ''],
    );
    res.json({ users: rows.map(safeUser) });
  });
  app.get('/api/notifications', authenticated, async (req, res) => {
    const rows = await accessibleNotifications(req.user);
    res.json({ notifications: rows.map(serializeNotification), unreadCount: rows.filter((row) => !row.read_at).length });
  });
  app.patch('/api/notifications/:id/read', authenticated, async (req, res) => {
    const rows = await accessibleNotifications(req.user);
    const row = rows.find((notification) => notification.id === req.params.id);
    if (!row) throw missing();
    row.read_at ||= new Date().toISOString();
    await db.run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?', [row.read_at, row.id, req.user.id]);
    res.json({ notification: serializeNotification(row) });
  });
  app.post('/api/notifications/read-all', authenticated, async (req, res) => {
    await accessibleNotifications(req.user);
    await db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [new Date().toISOString(), req.user.id]);
    res.status(204).end();
  });
  app.use('/api', (req, res, next) => next(missing()));
  const distPath = options.distPath ?? resolve('dist');
  if (existsSync(resolve(distPath, 'index.html'))) {
    app.use(express.static(distPath));
    app.get('/{*path}', (req, res) => res.sendFile(resolve(distPath, 'index.html')));
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.issues.map((issue) => `${issue.path.join('.') || 'Input'}: ${issue.message}`).join('; '), code: 'VALIDATION_ERROR' });
    }
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.', code: 'INVALID_JSON' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.', code: 'BODY_TOO_LARGE' });
    if (error.status) return res.status(error.status).json({
      error: error.message, code: error.code ?? 'REQUEST_ERROR',
      ...(error.code === 'TASK_CONFLICT' && error.currentTask ? { currentTask: error.currentTask } : {}),
    });
    console.error('API request failed:', error.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'SERVER_ERROR' });
  });
  return app;
}
