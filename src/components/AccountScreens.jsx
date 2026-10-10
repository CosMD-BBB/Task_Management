import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, FolderKanban, Inbox, KeyRound, Loader2, LogOut, Mail, RefreshCw, ShieldCheck, Sparkles, X } from 'lucide-react';
import { api } from '../api';
import './accounts.css';

const fallbackBrand = () => <div className="brand"><span className="brand-symbol"><FolderKanban size={24} /></span><span>room<span className="brand-dot">.</span></span></div>;

const errorMessage = (error) => {
  const translations = {
    'Invalid email or password.': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
    'Invalid email or password': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
    'Email or password is incorrect, or this account is suspended.': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกระงับ กรุณาตรวจสอบข้อมูลหรือติดต่อผู้ดูแลทีม',
    'An account with this email already exists.': 'อีเมลนี้มีบัญชีแล้ว คุณสามารถเข้าสู่ระบบหรือตั้งรหัสผ่านใหม่ได้',
    'Please log in to continue.': 'กรุณาเข้าสู่ระบบอีกครั้งเพื่อดำเนินการต่อ',
    'This link has expired or has already been used. Request a new link.': 'ลิงก์นี้หมดอายุหรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่',
    'Email delivery is not configured. Contact the administrator to enable account emails.': 'ระบบส่งอีเมลยังไม่ได้ตั้งค่า กรุณาติดต่อผู้ดูแลเพื่อเปิดใช้งานการยืนยันอีเมล',
    'Email delivery is temporarily unavailable. Please try again later.': 'ระบบส่งอีเมลขัดข้องชั่วคราว กรุณาลองอีกครั้งภายหลัง',
    'Email delivery failed. Contact the administrator or try again later.': 'ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่หรือติดต่อผู้ดูแล',
  };
  return translations[error.message] || error.message;
};

function AuthLayout({ Brand = fallbackBrand, children }) {
  return <div className="auth-page">
    <div className="auth-art">
      <Brand />
      <div className="auth-pitch"><span className="eyebrow"><span className="live-dot" /> A little more space to create</span><h1>Great work.<br />Better together<span>.</span></h1><p>ทุกโปรเจกต์ ทุกไอเดีย ทุกคนในทีม<br />อยู่ในห้องเดียวกันได้อย่างลงตัว</p>
        <div className="auth-demo-card"><div className="demo-card-top"><span className="mini-project">R</span><b>Regagar · Content studio</b><span className="pill mint">In progress</span></div><h3>Make something worth sharing</h3><div className="demo-check"><Check size={15} /><span>Plan the next big idea</span></div><div className="demo-check"><Check size={15} /><span>Bring your team into the room</span></div><div className="demo-check muted-check"><span className="empty-circle" /><span>Turn the plan into something real</span></div><div className="demo-card-bottom"><div className="avatar-stack"><span>PN</span><span>MK</span><span>JL</span></div><span><CalendarDays size={14} /> Your next chapter</span></div></div>
      </div><div className="auth-footer"><ShieldCheck size={15} /> ห้องโปรเจกต์ส่วนตัว พร้อมสิทธิ์สำหรับทุกคนในทีม</div>
    </div>
    <main className="auth-form-area"><div className="auth-form-wrap"><div className="mobile-brand"><Brand /></div>{children}</div></main>
  </div>;
}

function currentAction() {
  const query = new URLSearchParams(window.location.search);
  const action = query.get('action');
  if (action === 'verify-email') return { mode: 'verify', token: query.get('token') || '' };
  if (action === 'reset-password') return { mode: 'reset', token: query.get('token') || '' };
  if (query.has('verify')) return { mode: 'verify', token: query.get('verify') || '' };
  if (query.has('reset')) return { mode: 'reset', token: query.get('reset') || '' };
  return { mode: 'login', token: '' };
}

function clearAction() {
  const url = new URL(window.location.href);
  ['action', 'token', 'verify', 'reset'].forEach((key) => url.searchParams.delete(key));
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

export function AuthScreen({ onAuthenticated, onActionComplete, Brand }) {
  const [initial] = useState(currentAction);
  const [mode, setMode] = useState(initial.mode);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mailMode, setMailMode] = useState('');
  const [demoEnabled, setDemoEnabled] = useState(false);
  useEffect(() => {
    let current = true;
    api('/auth/config').then(config => { if (current) setDemoEnabled(config.demoEnabled === true); }).catch(() => {});
    return () => { current = false; };
  }, []);
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmation: '' });
  const changeMode = (next) => { clearAction(); setMode(next); setError(''); setNotice(''); setMailMode(''); setForm((old) => ({ ...old, password: '', confirmation: '' })); if (next === 'login' && ['verify', 'reset'].includes(mode)) onActionComplete?.(); };
  const submit = async (event, demo = false) => {
    event?.preventDefault(); setPending(true); setError(''); setNotice('');
    try {
      if (mode === 'forgot' && !demo) {
        const result = await api('/auth/forgot-password', { method: 'POST', body: { email: form.email } });
        setMailMode(result.mailMode); setNotice('หากมีบัญชีที่ใช้อีเมลนี้ ระบบจะจัดเตรียมลิงก์สำหรับตั้งรหัสผ่านใหม่ให้ กรุณาตรวจสอบอีเมลของคุณ');
      } else if (mode === 'reset' && !demo) {
        if (form.password !== form.confirmation) throw new Error('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
        await api('/auth/reset-password', { method: 'POST', body: { token: initial.token, password: form.password } });
        changeMode('login'); setNotice('เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่');
      } else if (mode === 'verify' && !demo) {
        const { user } = await api('/auth/verify-email', { method: 'POST', body: { token: initial.token } });
        clearAction(); onAuthenticated(user);
      } else {
        const body = demo ? {} : mode === 'register' ? { name: form.name, email: form.email, password: form.password } : { email: form.email, password: form.password };
        const { user } = await api(`/auth/${demo ? 'demo' : mode}`, { method: 'POST', body });
        clearAction(); onAuthenticated(user);
      }
    } catch (e) { setError(errorMessage(e)); } finally { setPending(false); }
  };
  const headings = { login: 'Welcome to your room.', register: 'Make room for your team.', forgot: 'ลืมรหัสผ่าน?', reset: 'ตั้งรหัสผ่านใหม่', verify: 'ยืนยันอีเมลของคุณ' };
  const descriptions = { login: 'เข้าสู่ระบบ แล้วไปต่อจากไอเดียที่ค้างไว้', register: 'สร้างบัญชีและยืนยันอีเมลก่อนเริ่มทำงานกับทีม', forgot: 'ใส่อีเมลที่สมัครไว้ เพื่อขอลิงก์ตั้งรหัสผ่านใหม่', reset: 'เลือกรหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร', verify: 'กดยืนยันด้านล่างเพื่อเปิดใช้งานบัญชีและเข้าสู่ห้องของคุณ' };
  return <AuthLayout Brand={Brand}>
    <span className="eyebrow">YOUR TEAM'S NEW WORKSPACE</span><h2>{headings[mode]}</h2><p>{descriptions[mode]}</p>
    <form onSubmit={submit}>
      {mode === 'register' && <label>ชื่อของคุณ<input autoComplete="name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="เช่น Ploy Narisa" maxLength={80} /></label>}
      {['login', 'register', 'forgot'].includes(mode) && <label>อีเมล<input type="email" autoComplete="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="you@yourteam.com" maxLength={254} /></label>}
      {['login', 'register', 'reset'].includes(mode) && <label>{mode === 'reset' ? 'รหัสผ่านใหม่' : 'รหัสผ่าน'}<input type="password" minLength={mode === 'login' ? undefined : 8} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder={mode === 'login' ? 'กรอกรหัสผ่านของคุณ' : 'อย่างน้อย 8 ตัวอักษร'} /></label>}
      {mode === 'reset' && <label>ยืนยันรหัสผ่านใหม่<input type="password" minLength={8} required autoComplete="new-password" value={form.confirmation} onChange={e => setForm({ ...form, confirmation: e.target.value })} placeholder="กรอกรหัสผ่านใหม่อีกครั้ง" /></label>}
      {mode === 'login' && <button type="button" className="account-link account-forgot" onClick={() => changeMode('forgot')}>ลืมรหัสผ่าน?</button>}
      {error && <div className="form-error" role="alert">{error}</div>}
      {notice && <div className="account-success" role="status"><CheckCircle2 size={18} /><span>{notice}</span></div>}
      {mode === 'forgot' && mailMode === 'preview' && <div className="account-info"><Inbox size={17} /><span>เว็บไซต์นี้ใช้กล่องอีเมลจำลอง และยังไม่ได้ส่งอีเมลจริง การทดลองตั้งรหัสผ่านใหม่ทำได้จากเมนู “บัญชีและความปลอดภัย” ขณะเข้าสู่ระบบด้วยบัญชีของคุณ</span></div>}
      <button className="primary auth-submit" disabled={pending}>{pending ? <Loader2 className="spin" size={17} /> : <>{({ login: 'เข้าสู่ระบบ', register: 'สร้างบัญชี', forgot: 'ขอลิงก์ตั้งรหัสผ่านใหม่', reset: 'บันทึกรหัสผ่านใหม่', verify: 'ยืนยันอีเมลของฉัน' })[mode]}<ArrowRight size={17} /></>}</button>
    </form>
    {['login', 'register'].includes(mode) ? <>
      <p className="auth-switch">{mode === 'login' ? 'ยังไม่มีบัญชี?' : 'มีบัญชีแล้ว?'} <button onClick={() => changeMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'สร้างบัญชีใหม่' : 'เข้าสู่ระบบ'}</button></p>
      {demoEnabled && <><div className="auth-divider"><span />ลองดูก่อนได้เลย<span /></div>
      <button className="demo-button" disabled={pending} onClick={e => submit(e, true)}><Sparkles size={17} /> ทดลองใช้ด้วยข้อมูลตัวอย่าง <ArrowRight size={16} /></button>
      <p className="demo-note">ห้องทดลองส่วนตัว พร้อมลองจัดการทีมในหน้าผู้ดูแลระบบ</p></>}
    </> : <button className="account-link account-back" disabled={pending} onClick={() => changeMode('login')}><ArrowLeft size={16} />กลับไปหน้าเข้าสู่ระบบ</button>}
  </AuthLayout>;
}

function previewLink(actionUrl) {
  try {
    const url = new URL(actionUrl, window.location.origin);
    // Open token actions on this preview's origin if the preview domain has changed.
    const action = url.searchParams.get('action');
    if (!['verify-email', 'reset-password'].includes(action) || !url.searchParams.get('token')) return null;
    return `/?action=${encodeURIComponent(action)}&token=${encodeURIComponent(url.searchParams.get('token'))}`;
  } catch { return null; }
}

function PreviewInbox({ messages, loading, onRefresh }) {
  return <section className="account-inbox" aria-label="กล่องอีเมลจำลองสำหรับทดลอง">
    <header><div><Inbox size={18} /><h3>กล่องอีเมลจำลองสำหรับทดลอง</h3></div><button type="button" className="icon-button" aria-label="ตรวจสอบอีเมลจำลองใหม่" onClick={onRefresh} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} /></button></header>
    <p className="account-inbox-note">ระบบยังไม่ได้ส่งอีเมลจริง อีเมลในกล่องนี้แสดงเฉพาะบัญชีของคุณ</p>
    {!messages.length && <p className="account-inbox-empty">ยังไม่มีอีเมลสำหรับบัญชีนี้</p>}
    {[...messages].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).map(message => {
      const link = previewLink(message.actionUrl);
      return <article className="account-mail" key={message.id}>
        <small>ถึง {message.to} · {new Date(message.createdAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' })}</small>
        <h4>{message.kind === 'verify' ? 'ยืนยันอีเมลเพื่อเปิดใช้งาน Room' : message.kind === 'reset' ? 'ตั้งรหัสผ่านใหม่สำหรับ Room' : message.subject}</h4>
        <p>{message.kind === 'verify' ? 'เปิดลิงก์ด้านล่าง แล้วยืนยันอีเมลเพื่อเริ่มใช้งาน' : 'เปิดลิงก์ด้านล่าง แล้วเลือกรหัสผ่านใหม่ ลิงก์ใช้ได้ครั้งเดียว'}</p>
        {link && <a className="secondary account-mail-action" href={link}>{message.kind === 'verify' ? 'เปิดลิงก์ยืนยันอีเมล' : 'เปิดลิงก์ตั้งรหัสผ่านใหม่'}<ArrowRight size={15} /></a>}
      </article>;
    })}
  </section>;
}

function useMailPreview() {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mailError, setMailError] = useState('');
  const refresh = async () => {
    setLoading(true); setMailError('');
    try { const result = await api('/auth/mail-preview'); if (result.mode === 'preview') setPreview(result); else setPreview(null); }
    catch (e) { if (e.status === 404) setPreview(null); else setMailError(errorMessage(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);
  return { preview, loading, mailError, refresh };
}

export function VerificationScreen({ user, onVerified, onLogout, Brand }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const { preview, loading, mailError, refresh } = useMailPreview();
  const resend = async () => {
    setBusy(true); setError('');
    try { const result = await api('/auth/resend-verification', { method: 'POST', body: {} }); setNotice(result.mailMode === 'preview' ? 'เตรียมอีเมลยืนยันใหม่ไว้ในกล่องจำลองแล้ว' : 'ส่งอีเมลยืนยันใหม่แล้ว กรุณาตรวจสอบกล่องข้อความและโฟลเดอร์สแปม'); await refresh(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const checkVerified = async () => {
    setBusy(true); setError('');
    try { const { user: updated } = await api('/auth/me'); if (updated.emailVerified) onVerified(updated); else setNotice('บัญชีนี้ยังไม่ได้ยืนยันอีเมล กรุณาเปิดลิงก์ยืนยันก่อน'); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <AuthLayout Brand={Brand}>
    <div className="account-symbol"><Mail size={28} /></div><span className="eyebrow">ONE LAST STEP</span><h2>ยืนยันอีเมลก่อนเริ่มงาน</h2><p>สวัสดี {user.name} กรุณาเปิดลิงก์ยืนยันของ <strong className="account-email">{user.email}</strong> เพื่อเปิดใช้งานบัญชี</p>
    {!preview && <div className="account-info"><Mail size={18} /><span>ตรวจสอบกล่องข้อความ รวมถึงโฟลเดอร์สแปมหรืออีเมลขยะ หากยังไม่พบอีเมล สามารถขอใหม่ได้</span></div>}
    {notice && <div className="account-success" role="status"><CheckCircle2 size={17} /><span>{notice}</span></div>}
    {(error || mailError) && <div className="form-error" role="alert">{error || mailError}</div>}
    <div className="account-verification-actions"><button className="primary" disabled={busy} onClick={checkVerified}>{busy ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}ฉันยืนยันอีเมลแล้ว</button><button className="secondary" onClick={resend} disabled={busy}><RefreshCw size={16} />ขออีเมลยืนยันใหม่</button></div>
    {preview && <PreviewInbox messages={preview.messages || []} loading={loading} onRefresh={refresh} />}
    <button className="account-link account-back" onClick={onLogout} disabled={busy}><LogOut size={15} />ออกจากระบบเพื่อใช้บัญชีอื่น</button>
  </AuthLayout>;
}

export function AccountSecurity({ user, onClose }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const dialog = useRef(null);
  const { preview, loading, mailError, refresh } = useMailPreview();
  useEffect(() => {
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; dialog.current?.focus();
    const key = e => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab') return;
      const controls = [...(dialog.current?.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || [])].filter(element => element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = previousOverflow; previous?.focus?.(); };
  }, []);
  const requestReset = async () => {
    setBusy(true); setError('');
    try { const result = await api('/auth/forgot-password', { method: 'POST', body: { email: user.email } }); setNotice(result.mailMode === 'preview' ? 'เตรียมลิงก์ตั้งรหัสผ่านใหม่ไว้ในกล่องอีเมลจำลองแล้ว' : 'หากบัญชีนี้สามารถตั้งรหัสผ่านใหม่ได้ ระบบจะส่งลิงก์ไปยังอีเมลของคุณ'); await refresh(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <div className="modal-backdrop account-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><section className="account-security" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="account-security-title">
    <header><div><span className="eyebrow">YOUR ACCOUNT</span><h2 id="account-security-title">บัญชีและความปลอดภัย</h2></div><button className="icon-button" onClick={onClose} aria-label="ปิดบัญชีและความปลอดภัย"><X size={20} /></button></header>
    <div className="account-security-body"><div className="account-identity"><span className="avatar" style={{ background: user.avatarColor }}>{user.name?.slice(0, 2).toUpperCase()}</span><div><b>{user.name}</b><span>{user.email}</span></div><span className="account-verified"><ShieldCheck size={14} />{user.emailVerified ? 'ยืนยันแล้ว' : 'รอยืนยัน'}</span></div>
      <section className="account-security-section"><h3><KeyRound size={17} />รหัสผ่าน</h3><p>ตั้งรหัสผ่านใหม่ผ่านลิงก์ยืนยันในอีเมล เมื่อบันทึกแล้ว คุณจะต้องเข้าสู่ระบบใหม่ในทุกอุปกรณ์</p>{user.demoScopeId ? <div className="account-info"><Sparkles size={17} /><span>บัญชีทดลองนี้ไม่มีรหัสผ่าน หากต้องการทดสอบการยืนยันอีเมลและตั้งรหัสผ่านใหม่ ให้สร้างบัญชีของคุณจากหน้าเข้าสู่ระบบ</span></div> : <button className="secondary" disabled={busy} onClick={requestReset}>{busy ? <Loader2 size={16} className="spin" /> : <Mail size={16} />}ขอลิงก์ตั้งรหัสผ่านใหม่</button>}</section>
      {notice && <div className="account-success" role="status"><CheckCircle2 size={17} /><span>{notice}</span></div>}{(error || mailError) && <div className="form-error" role="alert">{error || mailError}</div>}
      {preview && <PreviewInbox messages={preview.messages || []} loading={loading} onRefresh={refresh} />}
    </div>
  </section></div>;
}
