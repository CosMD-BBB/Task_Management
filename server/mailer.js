import { randomUUID } from 'node:crypto';

function unavailable(message = 'Email delivery is not configured. Contact the administrator to enable account emails.') {
  return Object.assign(new Error(message), { status: 503, code: 'EMAIL_SERVICE_UNAVAILABLE' });
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

/** Preview mail is deliberately opt-in. Production always needs a real provider and trusted public URL. */
export function createMailer(options = {}) {
  const mode = (options.mailMode ?? process.env.MAIL_MODE) === 'preview' ? 'preview' : 'resend';
  const apiKey = options.resendApiKey ?? process.env.RESEND_API_KEY;
  const from = options.mailFrom ?? process.env.MAIL_FROM;
  const appUrl = options.appUrl ?? process.env.APP_URL;
  let trustedUrl;
  if (appUrl) {
    try {
      const url = new URL(appUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid URL');
      trustedUrl = url;
    } catch { /* Report unavailable without printing sensitive configuration. */ }
  }
  function assertReady() {
    if (mode === 'preview') return;
    if (!apiKey || !from || /[\r\n]/.test(from) || !trustedUrl) throw unavailable();
  }
  function actionUrl(req, kind, token) {
    assertReady();
    let base = trustedUrl;
    if (mode === 'preview' && !base) {
      // This origin is used only in a visibly simulated, session-private inbox.
      const host = req.get('host');
      if (!host || !/^[a-zA-Z0-9.:[\]-]+$/.test(host)) throw unavailable('The preview website address is invalid.');
      base = new URL(`${req.secure ? 'https' : 'http'}://${host}`);
    }
    const url = new URL('/', base);
    url.searchParams.set('action', kind === 'verify' ? 'verify-email' : 'reset-password');
    url.searchParams.set('token', token);
    return url.href;
  }
  async function send({ db, user, req, kind, token }) {
    const url = actionUrl(req, kind, token);
    const subject = kind === 'verify' ? 'ยืนยันอีเมลสำหรับ Room' : 'ตั้งรหัสผ่านใหม่สำหรับ Room';
    const text = kind === 'verify'
      ? `สวัสดี ${user.name}\n\nยืนยันอีเมลของคุณเพื่อเริ่มใช้ Room:\n${url}\n\nลิงก์นี้ใช้ได้ครั้งเดียวภายใน 24 ชั่วโมง หากคุณไม่ได้สมัครบัญชีนี้ ไม่ต้องดำเนินการใด ๆ`
      : `สวัสดี ${user.name}\n\nตั้งรหัสผ่านใหม่สำหรับ Room:\n${url}\n\nลิงก์นี้ใช้ได้ครั้งเดียวภายใน 1 ชั่วโมง หากคุณไม่ได้ขอเปลี่ยนรหัสผ่าน ไม่ต้องดำเนินการใด ๆ`;
    if (mode === 'preview') {
      const message = { to: user.email, subject, text, actionUrl: url, kind };
      await db.run('INSERT INTO mail_outbox (id, owner_user_id, message_json, created_at) VALUES (?, ?, ?, ?)', [
        randomUUID(), user.id, JSON.stringify(message), new Date().toISOString(),
      ]);
      return;
    }
    const response = await (options.mailFetch ?? fetch)('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ from, to: [user.email], subject, text, html: `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>` }),
    }).catch(() => { throw unavailable('Email delivery is temporarily unavailable. Please try again later.'); });
    // Do not echo provider responses: they can contain recipient details or credentials.
    if (!response.ok) throw unavailable('Email delivery failed. Contact the administrator or try again later.');
  }
  return { mode, assertReady, send };
}
