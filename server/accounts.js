import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { registerSchema, loginSchema } from './validation.js';
import { createMailer } from './mailer.js';
import { nextUpdatedAt } from './domain.js';

const email = z.string().trim().toLowerCase().email().max(254);
const tokenInput = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const password = z.string().min(8).max(72).refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes');
const resetInput = z.object({ token: tokenInput.shape.token, password }).strict();
const userPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  disabled: z.boolean().optional(),
  globalRole: z.enum(['member', 'superadmin']).optional(),
}).strict().refine((input) => Object.keys(input).length > 0, 'Choose a change to save');
const deleteInput = z.object({ transferToUserId: z.string().min(1).max(100).regex(/^[\w-]+$/).optional() }).strict();
const avatarColors = ['#f97316', '#8b5cf6', '#10b981', '#3b82f6', '#ec4899'];

export async function installAccountRoutes(app, {
  db, signIn, cookieOptions, safeUser, hashToken, HttpError, authenticated,
  authLimiter, demoLimiter, seedDemo, options = {}, cookieName = 'teamflow_session',
}) {
  const mailer = createMailer(options);
  const configuredAdmin = (options.superadminEmail ?? process.env.SUPERADMIN_EMAIL ?? '').trim().toLowerCase();
  const dummyHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12);
  const now = () => new Date().toISOString();
  const invalidToken = () => new HttpError(400, 'This link has expired or has already been used. Request a new link.', 'INVALID_TOKEN');
  const sameScope = (actor, target) => (actor.demoScopeId ?? null) === (target.demo_scope_id ?? null);
  const scopeClause = (user, table = 'u') => user.demoScopeId
    ? { sql: `${table}.demo_scope_id = ?`, values: [user.demoScopeId] }
    : { sql: `${table}.demo_scope_id IS NULL`, values: [] };
  const withTransaction = (operation) => db.transaction(operation);
  const requireAdmin = (req, res, next) => req.user?.globalRole === 'superadmin' && req.user.emailVerified && !req.user.disabled
    ? next() : next(new HttpError(403, 'Only the administrator can manage team accounts.', 'FORBIDDEN'));
  const withAdminTransaction = (req, operation) => withTransaction(async (tx) => {
    // Concurrent administrators must not suspend one another using stale session state.
    // SQLite already serializes transactions; PostgreSQL needs a transaction-scoped lock.
    if (tx.kind === 'postgres') await tx.get('SELECT pg_advisory_xact_lock(814721901)');
    const actor = await tx.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!actor || actor.disabled_at || !safeUser(actor).emailVerified || actor.global_role !== 'superadmin' || !sameScope(req.user, actor)) {
      throw new HttpError(403, 'Only an active administrator can manage team accounts.', 'FORBIDDEN');
    }
    return operation(tx);
  });

  async function issueToken(req, user, kind) {
    const token = randomBytes(32).toString('hex');
    const timestamp = now();
    const expiry = new Date(Date.now() + (kind === 'verify' ? 24 : 1) * 60 * 60 * 1000).toISOString();
    // A new request invalidates all earlier links of this kind for this account.
    await db.run('UPDATE account_tokens SET consumed_at = ? WHERE user_id = ? AND kind = ? AND consumed_at IS NULL', [timestamp, user.id, kind]);
    await db.run('INSERT INTO account_tokens (token_hash, user_id, kind, expires_at, consumed_at, created_at, issued_mode) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      hashToken(token), user.id, kind, expiry, null, timestamp, mailer.mode,
    ]);
    try { await mailer.send({ db, req, user, kind, token }); }
    catch (error) {
      await db.run('DELETE FROM account_tokens WHERE token_hash = ?', [hashToken(token)]);
      throw error;
    }
  }
  async function consumeToken(tx, token, kind) {
    const timestamp = now();
    const stored = await tx.get('SELECT * FROM account_tokens WHERE token_hash = ? AND kind = ? AND consumed_at IS NULL AND expires_at > ?', [hashToken(token), kind, timestamp]);
    // Simulated links cannot be promoted into evidence of real email ownership after deployment.
    if (!stored || stored.issued_mode !== mailer.mode) throw invalidToken();
    const user = await tx.get('SELECT * FROM users WHERE id = ?', [stored.user_id]);
    if (!user || user.disabled_at) throw invalidToken();
    const result = await tx.run('UPDATE account_tokens SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?', [timestamp, stored.token_hash, timestamp]);
    if ((result.changes ?? result.rowCount) !== 1) throw invalidToken();
    return user;
  }
  async function targetUser(req, id, database = db) {
    const row = await database.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!row || !sameScope(req.user, row)) throw new HttpError(404, 'This account was not found.', 'NOT_FOUND');
    return row;
  }
  async function checkAdminProtection(req, target, dangerous, database = db) {
    if (!dangerous) return;
    if (target.id === req.user.id) throw new HttpError(400, 'You cannot remove, suspend or demote your own administrator account.', 'SELF_ADMIN_CHANGE');
    if (target.global_role === 'superadmin' && !target.disabled_at) {
      const scope = scopeClause(req.user);
      const source = mailer.mode === 'resend' ? " AND (u.demo_scope_id IS NOT NULL OR u.email_verified_mode = 'resend')" : '';
      const { count } = await database.get(`SELECT COUNT(*) AS count FROM users u WHERE ${scope.sql} AND u.global_role = 'superadmin' AND u.disabled_at IS NULL AND u.email_verified = 1${source}`, scope.values);
      if (Number(count) <= 1) throw new HttpError(409, 'Keep at least one active administrator.', 'LAST_SUPERADMIN');
    }
  }
  async function audit(tx, req, action, targetId, details = {}) {
    await tx.run('INSERT INTO audit_log (id, actor_user_id, action, target_user_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      randomUUID(), req.user.id, action, targetId, JSON.stringify(details), now(),
    ]);
  }

  app.post('/api/auth/register', authLimiter, async (req, res) => {
    const input = registerSchema.parse(req.body);
    mailer.assertReady();
    if (await db.get('SELECT id FROM users WHERE email = ?', [input.email])) throw new HttpError(409, 'An account with this email already exists.', 'EMAIL_EXISTS');
    const user = { id: randomUUID(), name: input.name, email: input.email, avatar_color: avatarColors[Math.floor(Math.random() * avatarColors.length)] };
    const passwordHash = await bcrypt.hash(input.password, 12);
    try {
      await db.run('INSERT INTO users (id, name, email, password_hash, avatar_color, created_at, email_verified, global_role, disabled_at, demo_scope_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        user.id, user.name, user.email, passwordHash, user.avatar_color, now(), 0, 'member', null, null,
      ]);
    } catch (error) {
      if (error.code === '23505' || String(error.message).includes('UNIQUE constraint')) throw new HttpError(409, 'An account with this email already exists.', 'EMAIL_EXISTS');
      throw error;
    }
    await signIn(req, res, user);
    await issueToken(req, user, 'verify');
    res.status(201).json({ user: safeUser(await db.get('SELECT * FROM users WHERE id = ?', [user.id])), verificationRequired: true, mailMode: mailer.mode });
  });
  app.post('/api/auth/login', authLimiter, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await db.get('SELECT * FROM users WHERE email = ?', [input.email]);
    const valid = await bcrypt.compare(input.password, user?.password_hash ?? dummyHash);
    if (!user || !valid || user.disabled_at) throw new HttpError(401, 'Email or password is incorrect, or this account is suspended.', 'INVALID_CREDENTIALS');
    const current = await signIn(req, res, user, { expectedPasswordHash: user.password_hash });
    const sessionUser = safeUser(current);
    res.json({ user: sessionUser, verificationRequired: !sessionUser.emailVerified, mailMode: mailer.mode });
  });
  app.get('/api/auth/config', (req, res) => res.json({ demoEnabled: mailer.mode === 'preview' }));
  app.post('/api/auth/demo', demoLimiter ?? authLimiter, async (req, res) => {
    if (mailer.mode !== 'preview') throw new HttpError(404, 'The requested item was not found.', 'NOT_FOUND');
    const user = await seedDemo(db);
    await signIn(req, res, user);
    res.status(201).json({ user: safeUser(await db.get('SELECT * FROM users WHERE id = ?', [user.id])), mailMode: mailer.mode });
  });
  app.post('/api/auth/logout', async (req, res) => {
    if (typeof req.cookies[cookieName] === 'string') await db.run('DELETE FROM sessions WHERE token_hash = ?', [hashToken(req.cookies[cookieName])]);
    res.clearCookie(cookieName, { ...cookieOptions(req), maxAge: undefined });
    res.status(204).end();
  });
  app.get('/api/auth/me', authenticated, (req, res) => res.json({ user: req.user, mailMode: mailer.mode }));
  app.post('/api/auth/verify-email', authLimiter, async (req, res) => {
    const { token } = tokenInput.parse(req.body);
    const user = await withTransaction(async (tx) => {
      const row = await consumeToken(tx, token, 'verify');
      // A simulated preview inbox does not prove ownership of a real email address.
      const role = mailer.mode === 'resend' && !row.demo_scope_id && configuredAdmin && row.email === configuredAdmin ? 'superadmin' : row.global_role;
      await tx.run('UPDATE users SET email_verified = 1, email_verified_mode = ?, global_role = ? WHERE id = ?', [mailer.mode, role, row.id]);
      const current = await tx.get('SELECT * FROM users WHERE id = ?', [row.id]);
      return signIn(req, res, current, { queryDb: tx });
    });
    res.json({ user: safeUser(user) });
  });
  app.post('/api/auth/resend-verification', authenticated, authLimiter, async (req, res) => {
    if (req.user.emailVerified) return res.json({ message: 'Your email is already verified.', mailMode: mailer.mode });
    mailer.assertReady();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    await issueToken(req, user, 'verify');
    res.json({ message: 'A new verification link has been sent.', mailMode: mailer.mode });
  });
  app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
    const input = z.object({ email }).strict().parse(req.body);
    mailer.assertReady();
    const user = await db.get('SELECT * FROM users WHERE email = ?', [input.email]);
    if (user && !user.disabled_at && !user.demo_scope_id) {
      // Provider failures must not reveal whether this email has an account.
      try { await issueToken(req, user, 'reset'); } catch (error) {
        if (error.code !== 'EMAIL_SERVICE_UNAVAILABLE') throw error;
      }
    }
    res.json({ message: 'If an active account exists for this email, a password reset link has been sent.', mailMode: mailer.mode });
  });
  app.post('/api/auth/reset-password', authLimiter, async (req, res) => {
    const input = resetInput.parse(req.body);
    const passwordHash = await bcrypt.hash(input.password, 12);
    await withTransaction(async (tx) => {
      const user = await consumeToken(tx, input.token, 'reset');
      await tx.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, user.id]);
      await tx.run('DELETE FROM sessions WHERE user_id = ?', [user.id]);
      await tx.run('UPDATE account_tokens SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL', [now(), user.id]);
    });
    res.clearCookie(cookieName, { ...cookieOptions(req), maxAge: undefined });
    res.json({ message: 'Password updated. Log in again with your new password.' });
  });
  app.get('/api/auth/mail-preview', authenticated, async (req, res) => {
    if (mailer.mode !== 'preview') throw new HttpError(404, 'The requested item was not found.', 'NOT_FOUND');
    const rows = await db.all('SELECT id, message_json, created_at FROM mail_outbox WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 25', [req.user.id]);
    res.json({ mode: 'preview', messages: rows.map((row) => ({ ...JSON.parse(row.message_json), id: row.id, createdAt: row.created_at })) });
  });

  app.get('/api/admin/users', authenticated, requireAdmin, async (req, res) => {
    const scope = scopeClause(req.user);
    const users = await db.all(`SELECT u.*, (SELECT COUNT(*) FROM projects p WHERE p.owner_id = u.id) AS owned_project_count,
      (SELECT COUNT(*) FROM projects p WHERE p.owner_id = u.id OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = u.id)) AS project_count
      FROM users u WHERE ${scope.sql} ORDER BY u.created_at, u.name`, scope.values);
    const projects = await db.all(`SELECT p.id, p.name, p.owner_id, u.name AS owner_name, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count
      FROM projects p JOIN users u ON u.id = p.owner_id WHERE ${scope.sql} ORDER BY p.name`, scope.values);
    res.json({ users: users.map((row) => ({ ...safeUser(row), createdAt: row.created_at, projectCount: Number(row.project_count), ownedProjectCount: Number(row.owned_project_count) })),
      projects: projects.map((row) => ({ id: row.id, name: row.name, ownerId: row.owner_id, ownerName: row.owner_name, taskCount: Number(row.task_count) })) });
  });
  app.patch('/api/admin/users/:id', authenticated, requireAdmin, async (req, res) => {
    const input = userPatch.parse(req.body);
    const updated = await withAdminTransaction(req, async (tx) => {
      const target = await targetUser(req, req.params.id, tx);
      const dangerous = input.disabled === true || (input.globalRole === 'member' && target.global_role === 'superadmin');
      await checkAdminProtection(req, target, dangerous, tx);
      if (input.globalRole === 'superadmin' && target.global_role !== 'superadmin') throw new HttpError(403, 'The super administrator account is configured securely by the system owner.', 'ADMIN_ROLE_MANAGED');
      const disabledAt = input.disabled === undefined ? target.disabled_at : input.disabled ? now() : null;
      await tx.run('UPDATE users SET name = ?, disabled_at = ?, global_role = ? WHERE id = ?', [input.name ?? target.name, disabledAt, input.globalRole ?? target.global_role, target.id]);
      if (input.disabled === true) {
        await tx.run('DELETE FROM sessions WHERE user_id = ?', [target.id]);
        await tx.run('UPDATE account_tokens SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL', [now(), target.id]);
      }
      await audit(tx, req, input.disabled === true ? 'user.suspend' : input.disabled === false ? 'user.reactivate' : 'user.update', target.id, input);
      return tx.get('SELECT * FROM users WHERE id = ?', [target.id]);
    });
    res.json({ user: safeUser(updated) });
  });
  app.delete('/api/admin/users/:id', authenticated, requireAdmin, async (req, res) => {
    const input = deleteInput.parse(req.body ?? {});
    await withAdminTransaction(req, async (tx) => {
      const target = await targetUser(req, req.params.id, tx);
      await checkAdminProtection(req, target, true, tx);
      const owned = await tx.all('SELECT id FROM projects WHERE owner_id = ?', [target.id]);
      if (owned.length) {
        if (!input.transferToUserId) throw new HttpError(409, 'Choose an active teammate to take ownership of this user’s projects before deleting the account.', 'OWNER_TRANSFER_REQUIRED');
        const transfer = await targetUser(req, input.transferToUserId, tx);
        if (transfer.id === target.id || transfer.disabled_at || !safeUser(transfer).emailVerified) throw new HttpError(400, 'Choose an active, verified teammate to take ownership.', 'INVALID_TRANSFER_TARGET');
        await tx.run('UPDATE projects SET owner_id = ? WHERE owner_id = ?', [transfer.id, target.id]);
        for (const project of owned) await tx.run('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [project.id, transfer.id]);
      }
      const scope = scopeClause(req.user);
      const tasks = await tx.all(`SELECT t.* FROM tasks t JOIN projects p ON p.id = t.project_id JOIN users u ON u.id = p.owner_id WHERE ${scope.sql}`, scope.values);
      for (const row of tasks) {
        const task = JSON.parse(row.data_json);
        const assigneeIds = task.assigneeIds ?? (task.assigneeId ? [task.assigneeId] : []);
        if (assigneeIds.includes(target.id) || task.assigneeId === target.id) {
          task.assigneeIds = assigneeIds.filter((id) => id !== target.id);
          task.assigneeId = task.assigneeIds[0] ?? null;
          task.updatedAt = nextUpdatedAt(task.updatedAt);
          await tx.run('UPDATE tasks SET data_json = ?, updated_at = ? WHERE id = ?', [JSON.stringify(task), task.updatedAt, row.id]);
        }
      }
      await audit(tx, req, 'user.delete', target.id, { name: target.name, email: target.email, transferredProjectCount: owned.length, transferToUserId: input.transferToUserId ?? null });
      await tx.run('DELETE FROM users WHERE id = ?', [target.id]);
    });
    res.status(204).end();
  });
}
