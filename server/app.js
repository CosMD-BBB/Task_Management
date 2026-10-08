import express from 'express';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from './database.js';
import { seedDemo } from './seed.js';
import {
  registerSchema, loginSchema, projectSchema, projectPatchSchema,
  memberSchema, taskSchema, taskPatchSchema,
} from './validation.js';

const COOKIE = 'teamflow_session';
const SESSION_DURATION = 14 * 24 * 60 * 60 * 1000;
const avatarColors = ['#f97316', '#8b5cf6', '#10b981', '#3b82f6', '#ec4899'];
const safeUser = (row) => ({ id: row.id, name: row.name, email: row.email, avatarColor: row.avatar_color });
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const missing = () => new HttpError(404, 'The requested item was not found.', 'NOT_FOUND');
const forbidden = () => new HttpError(403, 'You do not have permission to make this change.', 'FORBIDDEN');

export async function createApp(options = {}) {
  const db = await openDatabase(options);
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
  app.use(express.json({ limit: '256kb' }));
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
        'SELECT u.* FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token_hash = ? AND s.expires_at > ?',
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
  async function signIn(req, res, user) {
    const priorToken = req.cookies[COOKIE];
    if (typeof priorToken === 'string') await db.run('DELETE FROM sessions WHERE token_hash = ?', [hashToken(priorToken)]);
    const token = randomBytes(32).toString('hex');
    await db.run('DELETE FROM sessions WHERE expires_at <= ?', [new Date().toISOString()]);
    await db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [
      hashToken(token), user.id, new Date(Date.now() + SESSION_DURATION).toISOString(),
    ]);
    res.cookie(COOKIE, token, cookieOptions(req));
  }
  async function projectAccess(projectId, userId) {
    const row = await db.get(
      `SELECT p.*, m.role AS member_role FROM projects p
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
       WHERE p.id = ? AND (p.owner_id = ? OR m.user_id = ?)`,
      [userId, projectId, userId, userId],
    );
    if (!row) throw missing();
    return { ...row, yourRole: row.owner_id === userId ? 'owner' : row.member_role };
  }
  async function serializeProject(row) {
    const members = await db.all(
      `SELECT u.*, m.role FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ? ORDER BY u.name`,
      [row.id],
    );
    const owner = await db.get('SELECT * FROM users WHERE id = ?', [row.owner_id]);
    const tasks = await db.all('SELECT data_json FROM tasks WHERE project_id = ?', [row.id]);
    return {
      id: row.id, name: row.name, description: row.description, color: row.color,
      ownerId: row.owner_id, fields: JSON.parse(row.fields_json), yourRole: row.yourRole,
      members: [
        { userId: owner.id, role: 'owner', user: safeUser(owner) },
        ...members.map((member) => ({ userId: member.id, role: member.role, user: safeUser(member) })),
      ],
      taskCount: tasks.length,
      completedCount: tasks.filter((task) => JSON.parse(task.data_json).status === 'done').length,
      createdAt: row.created_at,
    };
  }
  const requireEditor = (project) => { if (!['owner', 'editor'].includes(project.yourRole)) throw forbidden(); };
  const requireOwner = (project) => { if (project.yourRole !== 'owner') throw forbidden(); };
  async function validateTaskForProject(task, project) {
    if (task.assigneeId) {
      const member = task.assigneeId === project.owner_id || await db.get(
        'SELECT user_id FROM project_members WHERE project_id = ? AND user_id = ?', [project.id, task.assigneeId],
      );
      if (!member) throw new HttpError(400, 'The assignee must be a member of this project.', 'INVALID_ASSIGNEE');
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
  async function writeTask(task) {
    await db.run('UPDATE tasks SET data_json = ?, updated_at = ? WHERE id = ?', [JSON.stringify(task), task.updatedAt, task.id]);
  }

  app.get('/api/health', (req, res) => res.json({ status: 'ok', storage: db.kind }));
  app.post('/api/auth/register', authLimiter, async (req, res) => {
    const input = registerSchema.parse(req.body);
    if (await db.get('SELECT id FROM users WHERE email = ?', [input.email])) {
      throw new HttpError(409, 'An account with this email already exists.', 'EMAIL_EXISTS');
    }
    const user = {
      id: randomUUID(), name: input.name, email: input.email,
      avatar_color: avatarColors[Math.floor(Math.random() * avatarColors.length)],
    };
    const passwordHash = await bcrypt.hash(input.password, 12);
    try {
      await db.run('INSERT INTO users (id, name, email, password_hash, avatar_color, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
        user.id, user.name, user.email, passwordHash, user.avatar_color, new Date().toISOString(),
      ]);
    } catch (error) {
      if (error.code === '23505' || String(error.message).includes('UNIQUE constraint')) {
        throw new HttpError(409, 'An account with this email already exists.', 'EMAIL_EXISTS');
      }
      throw error;
    }
    await signIn(req, res, user);
    res.status(201).json({ user: safeUser(user) });
  });
  const dummyPasswordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12);
  app.post('/api/auth/login', authLimiter, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await db.get('SELECT * FROM users WHERE email = ?', [input.email]);
    const valid = await bcrypt.compare(input.password, user?.password_hash ?? dummyPasswordHash);
    if (!user || !valid) throw new HttpError(401, 'Email or password is incorrect.', 'INVALID_CREDENTIALS');
    await signIn(req, res, user);
    res.json({ user: safeUser(user) });
  });
  app.post('/api/auth/demo', demoLimiter, async (req, res) => {
    const user = await seedDemo(db);
    await signIn(req, res, user);
    res.status(201).json({ user: safeUser(user) });
  });
  app.post('/api/auth/logout', async (req, res) => {
    if (typeof req.cookies[COOKIE] === 'string') await db.run('DELETE FROM sessions WHERE token_hash = ?', [hashToken(req.cookies[COOKIE])]);
    res.clearCookie(COOKIE, { ...cookieOptions(req), maxAge: undefined });
    res.status(204).end();
  });
  app.get('/api/auth/me', authenticated, (req, res) => res.json({ user: req.user }));

  app.get('/api/projects', authenticated, async (req, res) => {
    const rows = await db.all(
      `SELECT DISTINCT p.*, m.role AS member_role FROM projects p
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
       WHERE p.owner_id = ? OR m.user_id = ? ORDER BY p.created_at, p.name`,
      [req.user.id, req.user.id, req.user.id],
    );
    const projects = await Promise.all(rows.map((row) => serializeProject({
      ...row, yourRole: row.owner_id === req.user.id ? 'owner' : row.member_role,
    })));
    res.json({ projects });
  });
  app.post('/api/projects', authenticated, async (req, res) => {
    const input = projectSchema.parse(req.body);
    const projectId = randomUUID();
    await db.run('INSERT INTO projects (id, name, description, color, owner_id, fields_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      projectId, input.name, input.description, input.color, req.user.id, JSON.stringify(input.fields), new Date().toISOString(),
    ]);
    res.status(201).json({ project: await serializeProject(await projectAccess(projectId, req.user.id)) });
  });
  app.get('/api/projects/:id', authenticated, async (req, res) => {
    res.json({ project: await serializeProject(await projectAccess(req.params.id, req.user.id)) });
  });
  app.patch('/api/projects/:id', authenticated, async (req, res) => {
    const project = await projectAccess(req.params.id, req.user.id);
    requireOwner(project);
    const input = projectPatchSchema.parse(req.body);
    const fields = input.fields ?? JSON.parse(project.fields_json);
    await db.run('UPDATE projects SET name = ?, description = ?, color = ?, fields_json = ? WHERE id = ?', [
      input.name ?? project.name, input.description ?? project.description,
      input.color ?? project.color, JSON.stringify(fields), project.id,
    ]);
    if (input.fields) {
      const tasks = await db.all('SELECT data_json FROM tasks WHERE project_id = ?', [project.id]);
      for (const row of tasks) {
        const task = JSON.parse(row.data_json);
        task.customFields = Object.fromEntries(Object.entries(task.customFields).filter(([fieldId, value]) => {
          const field = fields.find((entry) => entry.id === fieldId);
          return field && (field.type === 'text' || !value || field.options.includes(value));
        }));
        task.updatedAt = new Date().toISOString();
        await writeTask(task);
      }
    }
    res.json({ project: await serializeProject(await projectAccess(project.id, req.user.id)) });
  });
  app.delete('/api/projects/:id', authenticated, async (req, res) => {
    const project = await projectAccess(req.params.id, req.user.id);
    requireOwner(project);
    await db.run('DELETE FROM projects WHERE id = ?', [project.id]);
    res.status(204).end();
  });
  app.post('/api/projects/:id/members', authenticated, async (req, res) => {
    const project = await projectAccess(req.params.id, req.user.id);
    requireOwner(project);
    const input = memberSchema.parse(req.body);
    const user = await db.get('SELECT * FROM users WHERE email = ?', [input.email]);
    if (!user) throw new HttpError(404, 'This person needs to register with that email first.', 'USER_NOT_FOUND');
    if (user.id === project.owner_id) throw new HttpError(400, 'The project owner already has full access.', 'OWNER_ROLE');
    await db.run(
      `INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = excluded.role`,
      [project.id, user.id, input.role],
    );
    res.json({ project: await serializeProject(await projectAccess(project.id, req.user.id)) });
  });
  app.delete('/api/projects/:id/members/:userId', authenticated, async (req, res) => {
    const project = await projectAccess(req.params.id, req.user.id);
    requireOwner(project);
    if (req.params.userId === project.owner_id) throw new HttpError(400, 'The project owner cannot be removed.', 'OWNER_ROLE');
    await db.run('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [project.id, req.params.userId]);
    const tasks = await db.all('SELECT data_json FROM tasks WHERE project_id = ?', [project.id]);
    for (const row of tasks) {
      const task = JSON.parse(row.data_json);
      if (task.assigneeId === req.params.userId) {
        task.assigneeId = null;
        task.updatedAt = new Date().toISOString();
        await writeTask(task);
      }
    }
    res.json({ project: await serializeProject(await projectAccess(project.id, req.user.id)) });
  });
  app.get('/api/projects/:id/tasks', authenticated, async (req, res) => {
    const project = await projectAccess(req.params.id, req.user.id);
    const rows = await db.all('SELECT data_json FROM tasks WHERE project_id = ? ORDER BY created_at, id', [project.id]);
    res.json({ tasks: rows.map((row) => JSON.parse(row.data_json)) });
  });
  app.post('/api/projects/:id/tasks', authenticated, async (req, res) => {
    const project = await projectAccess(req.params.id, req.user.id);
    requireEditor(project);
    const input = taskSchema.parse(req.body);
    await validateTaskForProject(input, project);
    const now = new Date().toISOString();
    const task = { ...input, id: randomUUID(), projectId: project.id, createdAt: now, updatedAt: now };
    await db.run('INSERT INTO tasks (id, project_id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
      task.id, project.id, JSON.stringify(task), now, now,
    ]);
    res.status(201).json({ task });
  });
  app.patch('/api/tasks/:id', authenticated, async (req, res) => {
    const row = await db.get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!row) throw missing();
    const project = await projectAccess(row.project_id, req.user.id);
    requireEditor(project);
    const input = taskPatchSchema.parse(req.body);
    const task = { ...JSON.parse(row.data_json), ...input, updatedAt: new Date().toISOString() };
    await validateTaskForProject(task, project);
    await writeTask(task);
    res.json({ task });
  });
  app.delete('/api/tasks/:id', authenticated, async (req, res) => {
    const row = await db.get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!row) throw missing();
    const project = await projectAccess(row.project_id, req.user.id);
    requireEditor(project);
    await db.run('DELETE FROM tasks WHERE id = ?', [row.id]);
    res.status(204).end();
  });
  app.get('/api/users', authenticated, async (req, res) => {
    // Only expose teammates from rooms the user can access, never the full user directory.
    const rows = await db.all(
      `SELECT DISTINCT u.* FROM users u WHERE u.id = ? OR u.id IN (
        SELECT p.owner_id FROM projects p LEFT JOIN project_members mine ON mine.project_id = p.id AND mine.user_id = ?
        WHERE p.owner_id = ? OR mine.user_id = ?
      ) OR u.id IN (
        SELECT m.user_id FROM project_members m JOIN projects p ON p.id = m.project_id
        LEFT JOIN project_members mine ON mine.project_id = p.id AND mine.user_id = ?
        WHERE p.owner_id = ? OR mine.user_id = ?
      ) ORDER BY u.name`,
      Array(7).fill(req.user.id),
    );
    res.json({ users: rows.map(safeUser) });
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
    if (error.status) return res.status(error.status).json({ error: error.message, code: error.code ?? 'REQUEST_ERROR' });
    console.error('API request failed:', error.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'SERVER_ERROR' });
  });
  return app;
}
