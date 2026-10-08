import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Bell, CalendarDays, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Filter, Flag, FolderKanban, LayoutGrid, List, Loader2, LockKeyhole, LogOut, Menu, MoreHorizontal, Plus, Search, Settings2, ShieldCheck, Sparkles, Users, X } from 'lucide-react';
import { api } from './api';
import { TaskViews } from './components/Views';
import { TaskEditor } from './components/TaskEditor';

const userInitials = (name = '') => name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
const viewIcons = { list: List, board: LayoutGrid, calendar: CalendarDays };

function Brand({ small = false }) {
  return <div className={`brand ${small ? 'small' : ''}`}><span className="brand-symbol"><FolderKanban size={small ? 19 : 24} strokeWidth={2.4} /></span><span>room<span className="brand-dot">.</span></span></div>;
}

function Auth({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const submit = async (e, demo = false) => {
    e?.preventDefault(); setPending(true); setError('');
    try { const { user } = await api(`/auth/${demo ? 'demo' : mode}`, { method: 'POST', body: demo ? {} : mode === 'login' ? { email: form.email, password: form.password } : form }); onAuthenticated(user); }
    catch (e) { setError(e.message); } finally { setPending(false); }
  };
  return <div className="auth-page">
    <div className="auth-art">
      <Brand />
      <div className="auth-pitch"><span className="eyebrow"><span className="live-dot" /> A little more space to create</span><h1>Great work.<br />Better together<span>.</span></h1><p>ทุกโปรเจกต์ ทุกไอเดีย ทุกคนในทีม<br />อยู่ในห้องเดียวกันได้อย่างลงตัว</p>
        <div className="auth-demo-card"><div className="demo-card-top"><span className="mini-project">R</span><b>Regagar · Content studio</b><span className="pill mint">In progress</span></div><h3>Make something worth sharing</h3><div className="demo-check"><Check size={15} /><span>Plan the next big idea</span></div><div className="demo-check"><Check size={15} /><span>Bring your team into the room</span></div><div className="demo-check muted-check"><span className="empty-circle" /><span>Turn the plan into something real</span></div><div className="demo-card-bottom"><div className="avatar-stack"><span>PN</span><span>MK</span><span>JL</span></div><span><CalendarDays size={14} /> Your next chapter</span></div></div>
      </div><div className="auth-footer"><ShieldCheck size={15} /> Private projects. Shared possibilities.</div>
    </div>
    <main className="auth-form-area"><div className="auth-form-wrap"><div className="mobile-brand"><Brand /></div><span className="eyebrow">YOUR TEAM'S NEW WORKSPACE</span><h2>{mode === 'login' ? 'Welcome to your room.' : 'Make room for your team.'}</h2><p>{mode === 'login' ? 'เข้าสู่ระบบ แล้วไปต่อจากไอเดียที่ค้างไว้' : 'สร้างบัญชีเพื่อเริ่มจัดการงานและโปรเจกต์ของคุณ'}</p>
      <form onSubmit={submit}>
        {mode === 'register' && <label>ชื่อของคุณ<input autoComplete="name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="เช่น Ploy Narisa" maxLength={80} /></label>}
        <label>อีเมล<input type="email" autoComplete="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="you@yourteam.com" /></label>
        <label>รหัสผ่าน<input type="password" minLength={mode === 'register' ? 8 : undefined} required autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder={mode === 'register' ? 'อย่างน้อย 8 ตัวอักษร' : 'กรอกรหัสผ่านของคุณ'} /></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="primary auth-submit" disabled={pending}>{pending ? <Loader2 className="spin" size={17} /> : <>{mode === 'login' ? 'เข้าสู่ระบบ' : 'สร้างบัญชี'}<ArrowRight size={17} /></>}</button>
      </form>
      <p className="auth-switch">{mode === 'login' ? 'ยังไม่มีบัญชี?' : 'มีบัญชีแล้ว?'} <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? 'สร้างบัญชีใหม่' : 'เข้าสู่ระบบ'}</button></p>
      <div className="auth-divider"><span />or explore first<span /></div>
      <button className="demo-button" disabled={pending} onClick={e => submit(e, true)}><Sparkles size={17} /> ทดลองใช้ด้วยข้อมูลตัวอย่าง <ArrowRight size={16} /></button>
      <p className="demo-note">ห้องทดลองส่วนตัว ลองสร้างและแก้ไขงานได้ทันที</p>
    </div></main>
  </div>;
}

function ProjectSettings({ project, onClose, onSaved, onDeleted, create = false }) {
  const [form, setForm] = useState({ name: project?.name || '', description: project?.description || '', color: project?.color || '#0e8778', fields: project?.fields || [] });
  const [current, setCurrent] = useState(project);
  const [invite, setInvite] = useState({ email: '', role: 'editor' });
  const [fieldName, setFieldName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const owner = create || current?.yourRole === 'owner';
  const run = async fn => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const save = e => { e.preventDefault(); run(async () => { const body = { ...form, fields: form.fields.map(f => ({ ...f, options: (f.options || []).map(s => s.trim()).filter(Boolean) })) }; const result = await api(create ? '/projects' : `/projects/${project.id}`, { method: create ? 'POST' : 'PATCH', body }); await onSaved(result.project); onClose(); }); };
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="project-settings-title"><header><div><span className="eyebrow">PROJECT ROOM</span><h2 id="project-settings-title">{create ? 'สร้างห้องโปรเจกต์' : 'ตั้งค่าโปรเจกต์'}</h2></div><button className="icon-button" onClick={onClose} aria-label="ปิด"><X size={20} /></button></header>
    <div className="settings-content"><form onSubmit={save}><label>ชื่อโปรเจกต์<input required disabled={!owner} maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="เช่น Regagar / Q4 campaign" /></label><label>รายละเอียด<textarea disabled={!owner} value={form.description} maxLength={2000} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="พื้นที่สำหรับวางแผนและทำงานร่วมกัน" rows={2} /></label><div className="color-picker"><span>สีโปรเจกต์</span>{['#0e8778', '#7965d5', '#df8552', '#448cca', '#df6684', '#434b5d'].map(color => <button type="button" disabled={!owner} key={color} onClick={() => setForm({ ...form, color })} style={{ background: color }} aria-label={`เลือกสี ${color}`} className={form.color === color ? 'selected' : ''}>{form.color === color && <Check size={15} />}</button>)}</div>
      <div className="settings-section"><h3><Settings2 size={16} /> คอลัมน์เพิ่มเติม</h3><p>เพิ่มหัวข้อข้อมูลให้เหมาะกับงานของทีม</p>{form.fields.map((f, i) => <div key={f.id} className="custom-field-setting"><input aria-label="ชื่อคอลัมน์" disabled={!owner} value={f.name} onChange={e => setForm({ ...form, fields: form.fields.map((x, ix) => ix === i ? { ...x, name: e.target.value } : x) })} /><select disabled={!owner} aria-label="ประเภทคอลัมน์" value={f.type} onChange={e => setForm({ ...form, fields: form.fields.map((x, ix) => ix === i ? { ...x, type: e.target.value } : x) })}><option value="text">ข้อความ</option><option value="select">ตัวเลือก</option></select>{owner && <button type="button" className="icon-button" aria-label={`ลบ ${f.name}`} onClick={() => setForm({ ...form, fields: form.fields.filter(x => x.id !== f.id) })}><X size={16} /></button>}{f.type === 'select' && <input className="field-options" aria-label={`ตัวเลือกของ ${f.name}`} disabled={!owner} placeholder="ตัวเลือก คั่นด้วย ," value={(f.options || []).join(', ')} onChange={e => setForm({ ...form, fields: form.fields.map((x, ix) => ix === i ? { ...x, options: e.target.value.split(',').map(s => s.trim()) } : x) })} />}</div>)}{owner && <div className="add-field-row"><input aria-label="ชื่อคอลัมน์ใหม่" placeholder="เช่น Ref. / Prototype / Mockup" value={fieldName} onChange={e => setFieldName(e.target.value)} /><button type="button" className="secondary" disabled={!fieldName.trim() || form.fields.length >= 12} onClick={() => { setForm({ ...form, fields: [...form.fields, { id: crypto.randomUUID(), name: fieldName.trim(), type: 'text', options: [] }] }); setFieldName(''); }}><Plus size={15} />เพิ่ม</button></div>}</div>
      {owner && <button disabled={busy} className="primary">{busy && <Loader2 className="spin" size={16} />}{create ? 'สร้างโปรเจกต์' : 'บันทึกการตั้งค่า'}<ArrowRight size={16} /></button>}
    </form>
    {!create && <div className="settings-section"><h3><Users size={16} /> สมาชิกและสิทธิ์</h3><p>เฉพาะสมาชิกในห้องนี้เท่านั้นที่มองเห็นโปรเจกต์</p><div className="member-list">{current?.members?.map(member => <div className="member-row" key={member.userId}><span className="avatar" style={{ background: member.user.avatarColor }}>{userInitials(member.user.name)}</span><div><b>{member.user.name}</b><small>{member.user.email}</small></div><span className="member-role">{member.role === 'owner' ? 'เจ้าของ' : member.role === 'editor' ? 'แก้ไขได้' : 'ดูอย่างเดียว'}</span>{owner && member.role !== 'owner' && <><select aria-label={`สิทธิ์ของ ${member.user.name}`} value={member.role} disabled={busy} onChange={e => run(async () => { const { project: updated } = await api(`/projects/${project.id}/members`, { method: 'POST', body: { email: member.user.email, role: e.target.value } }); setCurrent(updated); await onSaved(updated); })}><option value="editor">แก้ไขได้</option><option value="viewer">ดูอย่างเดียว</option></select><button className="icon-button" aria-label={`นำ ${member.user.name} ออกจากโปรเจกต์`} disabled={busy} onClick={() => run(async () => { const { project: updated } = await api(`/projects/${project.id}/members/${member.userId}`, { method: 'DELETE' }); setCurrent(updated); await onSaved(updated); })}><X size={15} /></button></>}</div>)}</div>{owner && <form className="invite-form" onSubmit={e => { e.preventDefault(); run(async () => { const { project: updated } = await api(`/projects/${project.id}/members`, { method: 'POST', body: invite }); setCurrent(updated); setInvite({ ...invite, email: '' }); await onSaved(updated); }); }}><label>เพิ่มสมาชิกด้วยอีเมล<input type="email" required value={invite.email} onChange={e => setInvite({ ...invite, email: e.target.value })} placeholder="อีเมลของสมาชิกที่สมัครบัญชีแล้ว" /></label><div><select aria-label="สิทธิ์สมาชิกใหม่" value={invite.role} onChange={e => setInvite({ ...invite, role: e.target.value })}><option value="editor">แก้ไขงานได้</option><option value="viewer">ดูอย่างเดียว</option></select><button className="secondary" disabled={busy}><Plus size={16} />เพิ่มสมาชิก</button></div></form>}</div>}
    {!create && owner && <div className="delete-project">{!confirmDelete ? <button className="text-danger" onClick={() => setConfirmDelete(true)}>ลบโปรเจกต์นี้</button> : <><p>ลบโปรเจกต์และงานทั้งหมดถาวร?</p><button disabled={busy} className="danger-button" onClick={() => run(async () => { await api(`/projects/${project.id}`, { method: 'DELETE' }); await onDeleted(); onClose(); })}>ยืนยันการลบ</button><button className="secondary" onClick={() => setConfirmDelete(false)}>ยกเลิก</button></>}</div>}
    {error && <div className="form-error" role="alert">{error}</div>}</div>
  </section></div>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('list');
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [priority, setPriority] = useState('all');
  const [channel, setChannel] = useState('all');
  const [mine, setMine] = useState(false);
  const [sort, setSort] = useState('updated');
  const [editor, setEditor] = useState(null);
  const [settings, setSettings] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activity, setActivity] = useState(false);
  const [help, setHelp] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const requestVersion = useRef(0);
  const searchRef = useRef(null);
  const project = projects.find(p => p.id === projectId);
  const canEdit = project?.yourRole !== 'viewer';

  useEffect(() => { api('/auth/me').then(({ user }) => setUser(user)).catch(e => { if (e.status !== 401) setError(e.message); }).finally(() => setBooting(false)); }, []);
  const refreshProjects = async () => { const { projects } = await api('/projects'); setProjects(projects); setProjectId(id => projects.some(p => p.id === id) ? id : projects[0]?.id || ''); return projects; };
  useEffect(() => { if (user) refreshProjects().catch(e => setError(e.message)); else { setProjects([]); setTasks([]); setProjectId(''); } }, [user]);
  useEffect(() => {
    if (!projectId) { setTasks([]); return; }
    const version = ++requestVersion.current; setLoading(true); setError(''); setTasks([]);
    api(`/projects/${projectId}/tasks`).then(({ tasks }) => { if (requestVersion.current === version) setTasks(tasks); }).catch(e => { if (requestVersion.current === version) setError(e.message); }).finally(() => { if (requestVersion.current === version) setLoading(false); });
  }, [projectId]);
  useEffect(() => { const key = e => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); searchRef.current?.focus(); } if (e.key === 'Escape') { setSettings(null); setHelp(false); setActivity(false); setSidebarOpen(false); } }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer); }, [toast]);
  const counts = { total: tasks.length, done: tasks.filter(t => t.status === 'done').length, due: tasks.filter(t => t.dueDate === today() && t.status !== 'done').length, overdue: tasks.filter(t => t.dueDate && t.dueDate < today() && t.status !== 'done').length };
  const filtered = useMemo(() => {
    const weights = { urgent: 0, high: 1, normal: 2, low: 3 };
    return tasks.filter(t => (!search || `${t.title} ${t.description} ${t.contentType} ${t.channel}`.toLowerCase().includes(search.toLowerCase())) && (priority === 'all' || t.priority === priority) && (channel === 'all' || t.channel === channel) && (!mine || t.assigneeId === user?.id)).sort((a, b) => sort === 'due' ? (a.dueDate || '9999').localeCompare(b.dueDate || '9999') : sort === 'priority' ? weights[a.priority] - weights[b.priority] : (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }, [tasks, search, priority, channel, mine, sort, user]);
  const chooseProject = id => { setProjectId(id); setEditor(null); setSettings(null); setSearch(''); setChannel('all'); setPriority('all'); setMine(false); setSidebarOpen(false); };
  const saveTask = async body => { const { task } = await api(editor.task ? `/tasks/${editor.task.id}` : `/projects/${projectId}/tasks`, { method: editor.task ? 'PATCH' : 'POST', body }); setTasks(list => editor.task ? list.map(t => t.id === task.id ? task : t) : [task, ...list]); setEditor(null); setToast('บันทึกงานเรียบร้อย'); };
  const changeStatus = async (task, status) => { try { const { task: updated } = await api(`/tasks/${task.id}`, { method: 'PATCH', body: { status } }); setTasks(list => list.map(t => t.id === updated.id ? updated : t)); setToast('อัปเดตสถานะแล้ว'); } catch (e) { setError(e.message); } };
  const deleteTask = async task => { await api(`/tasks/${task.id}`, { method: 'DELETE' }); setTasks(list => list.filter(t => t.id !== task.id)); setEditor(null); setToast('ลบงานเรียบร้อย'); };
  const createTask = (initialValues = {}) => setEditor({ task: null, initialValues });
  if (booting) return <div className="boot-screen"><Brand /><Loader2 className="spin" /><p>Opening your room…</p></div>;
  if (!user) return <><Auth onAuthenticated={setUser} />{error && <div className="toast error-toast" role="alert">{error}<button onClick={() => setError('')} aria-label="ปิด"><X size={16} /></button></div>}</>;

  return <div className="workspace">
    {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? 'is-open' : ''}`}><div className="sidebar-brand"><Brand small /><span className="workspace-plan">TEAM</span></div><button className="workspace-switch" onClick={() => setHelp(true)}><span className="workspace-avatar">R</span><span><strong>Creative workspace</strong><small>Your team's shared space</small></span><ChevronDown size={14} /></button>
      <div className="sidebar-nav"><button className={!mine ? 'nav-active' : ''} onClick={() => { setMine(false); setView('list'); setSidebarOpen(false); }}><LayoutGrid size={17} />Overview</button><button className={mine ? 'nav-active' : ''} onClick={() => { setMine(true); setSidebarOpen(false); }}><Check size={17} />My tasks<span className="nav-count">{tasks.filter(t => t.assigneeId === user.id && t.status !== 'done').length}</span></button><button onClick={() => { setView('calendar'); setSidebarOpen(false); }}><CalendarDays size={17} />Calendar</button></div>
      <div className="sidebar-section-title"><span>PROJECT ROOMS</span><button className="icon-button" aria-label="สร้างโปรเจกต์" onClick={() => setSettings('create')}><Plus size={16} /></button></div><div className="project-nav">{projects.map(p => <button className={p.id === projectId ? 'project-active' : ''} key={p.id} onClick={() => chooseProject(p.id)}><span className="project-icon" style={{ color: p.color, background: `${p.color}13` }}>{p.name[0]?.toUpperCase()}</span><span>{p.name}</span><LockKeyhole size={12} /></button>)}</div><button className="new-project-button" onClick={() => setSettings('create')}><Plus size={16} />New project room</button>
      <div className="sidebar-bottom"><div className="team-note"><div className="team-note-icon"><Sparkles size={17} /></div><b>A place for every idea.</b><p>จัดการงาน ให้เหลือเวลาสร้างสรรค์</p><button onClick={() => project ? setSettings('edit') : setSettings('create')}>{project ? 'Invite your team' : 'Create your first room'}<ArrowRight size={14} /></button></div><button className="help-button" onClick={() => setHelp(true)}><CircleHelp size={16} />Workspace guide<span>?</span></button><div className="profile"><span className="avatar" style={{ background: user.avatarColor }}>{userInitials(user.name)}</span><div><strong>{user.name}</strong><small>{user.email.endsWith('.demo.invalid') ? 'Demo workspace' : user.email}</small></div><button className="icon-button" aria-label="ออกจากระบบ" onClick={async () => { try { await api('/auth/logout', { method: 'POST' }); setUser(null); } catch (e) { setError(e.message); } }}><LogOut size={16} /></button></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="เปิดเมนู" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><span>Workspace</span><ChevronRight size={14} /><strong>{project?.name || 'Projects'}</strong><span className="private-label"><LockKeyhole size={11} />Private room</span></div><div className="topbar-right"><span className="today-label">{new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', month: 'short', day: 'numeric' }).format(new Date())}</span><button className={`icon-button ${activity ? 'pressed' : ''}`} aria-label="กิจกรรมล่าสุด" onClick={() => setActivity(!activity)}><Bell size={18} />{tasks.length > 0 && <i className="notification-dot" />}</button><span className="avatar small-avatar" style={{ background: user.avatarColor }}>{userInitials(user.name)}</span></div></header>
    <main className="main-content">
      <div className="welcome-line"><span className="eyebrow">A LITTLE CLARITY. A LOT OF POSSIBILITY.</span><span className="sync-label"><span className="live-dot" />All changes saved</span></div>
      <div className="project-heading"><div><div className="heading-row"><span className="heading-icon" style={{ background: project?.color || '#0e8778' }}><FolderKanban size={23} /></span><h1>{project?.name || 'Your project rooms'}</h1>{project && <span className="project-tag">PROJECT</span>}</div><p>{project?.description || 'สร้างพื้นที่ให้ไอเดีย จัดการงาน และเติบโตไปด้วยกัน'}</p></div><div className="heading-actions">{project && <><button className="member-avatars" onClick={() => setSettings('edit')} aria-label="จัดการสมาชิก">{project.members?.slice(0, 3).map(m => <span className="avatar" key={m.userId} style={{ background: m.user.avatarColor }}>{userInitials(m.user.name)}</span>)}<span className="add-member"><Plus size={13} /></span></button><button className="secondary invite-heading" onClick={() => setSettings('edit')}><Users size={15} />{project.yourRole === 'owner' ? 'Invite' : 'Members'}</button><button className="icon-button project-settings" aria-label="ตั้งค่าโปรเจกต์" onClick={() => setSettings('edit')}><MoreHorizontal size={19} /></button></>}</div></div>
      {project ? <>
      <div className="stats-row"><div><span className="stat-icon"><FolderKanban size={18} /></span><div><strong>{counts.total}<small>Total tasks</small></strong><span>ไอเดียที่กำลังเป็นรูปเป็นร่าง</span></div></div><div><span className="stat-icon mint"><Check size={18} /></span><div><strong>{counts.done}<small>Completed</small></strong><span>{counts.total ? `${Math.round(counts.done / counts.total * 100)}% of the project` : 'เริ่มก้าวแรกของโปรเจกต์'}</span></div><div className="stat-progress"><i style={{ width: `${counts.total ? counts.done / counts.total * 100 : 0}%` }} /></div></div><div><span className="stat-icon amber"><Clock3 size={18} /></span><div><strong>{counts.due}<small>Due today</small></strong><span>สิ่งที่ต้องโฟกัสในวันนี้</span></div></div><div><span className="stat-icon rose"><Flag size={18} /></span><div><strong>{counts.overdue}<small>Overdue</small></strong><span>{counts.overdue ? 'ถึงเวลาเช็กอินกับงานเหล่านี้' : 'You’re right on track'}</span></div></div></div>
      <div className="view-navigation"><div className="view-tabs">{Object.entries(viewIcons).map(([key, Icon]) => <button key={key} className={view === key ? 'active-tab' : ''} onClick={() => setView(key)}><Icon size={16} />{key[0].toUpperCase() + key.slice(1)}{key === 'list' && <span>{tasks.length}</span>}</button>)}</div><span className="project-role"><ShieldCheck size={13} />{project.yourRole === 'viewer' ? 'View only' : project.yourRole === 'owner' ? 'Owner' : 'Editor'}</span></div>
      <div className="task-toolbar"><div className="toolbar-left"><span className="group-label"><LayoutGrid size={14} />Grouped by status</span><button className={`filter-button ${filtersOpen || priority !== 'all' || channel !== 'all' || mine ? 'selected' : ''}`} onClick={() => setFiltersOpen(!filtersOpen)}><Filter size={14} />Filter{(priority !== 'all' || channel !== 'all' || mine) && <i />}</button></div><div className="toolbar-right"><label className="search-box"><Search size={15} /><input ref={searchRef} aria-label="ค้นหางาน" placeholder="Search tasks…" value={search} onChange={e => setSearch(e.target.value)} /><kbd>⌘ K</kbd></label><select className="sort-select" aria-label="เรียงลำดับงาน" value={sort} onChange={e => setSort(e.target.value)}><option value="updated">Latest update</option><option value="due">Due date</option><option value="priority">Priority</option></select>{canEdit && <button className="primary new-task" onClick={() => createTask()}><Plus size={16} />New task</button>}</div></div>
      {filtersOpen && <div className="filter-panel"><label>Priority<select value={priority} onChange={e => setPriority(e.target.value)}><option value="all">All priorities</option><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label><label>Channel<select value={channel} onChange={e => setChannel(e.target.value)}><option value="all">All channels</option>{[...new Set(tasks.map(t => t.channel).filter(Boolean))].map(c => <option key={c}>{c}</option>)}</select></label><label className="checkbox-label"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} />Assigned to me</label><button className="text-button" onClick={() => { setPriority('all'); setChannel('all'); setMine(false); setSearch(''); }}>Clear filters</button></div>}
      {error && <div className="form-error page-error" role="alert">{error}<button className="icon-button" onClick={() => setError('')} aria-label="ปิด"><X size={14} /></button></div>}
      {loading ? <div className="content-loader"><Loader2 className="spin" size={23} /><p>Loading your tasks…</p></div> : <TaskViews view={view} tasks={filtered} project={project} onEdit={task => setEditor({ task })} onStatusChange={changeStatus} onCreate={createTask} canEdit={canEdit} search={search} />}
      <div className="workspace-bottom-note"><LockKeyhole size={12} />This room is only visible to project members.<span>{filtered.length} of {tasks.length} tasks</span></div>
      </> : <div className="first-project"><span className="empty-project-icon"><FolderKanban size={42} /></span><h2>A fresh start for your team.</h2><p>สร้างห้องโปรเจกต์แรก เพื่อเริ่มจัดการงานในแบบของคุณ</p><button className="primary" onClick={() => setSettings('create')}><Plus size={17} />สร้างโปรเจกต์แรก</button></div>}
    </main></div>
    {editor && project && <TaskEditor task={editor.task} initialValues={editor.initialValues} project={project} canEdit={canEdit} onSave={saveTask} onDelete={deleteTask} onClose={() => setEditor(null)} />}
    {settings && <ProjectSettings create={settings === 'create'} project={settings === 'create' ? undefined : project} onClose={() => setSettings(null)} onSaved={async p => { await refreshProjects(); if (settings === 'create') chooseProject(p.id); else if (p.id === projectId) { const { tasks: freshTasks } = await api(`/projects/${p.id}/tasks`); setTasks(freshTasks); } setToast(settings === 'create' ? 'สร้างห้องโปรเจกต์แล้ว' : 'อัปเดตโปรเจกต์แล้ว'); }} onDeleted={async () => { await refreshProjects(); setToast('ลบโปรเจกต์เรียบร้อย'); }} />}
    {activity && <div className="activity-popover"><header><h3>Latest in this room</h3><button className="icon-button" aria-label="ปิดกิจกรรม" onClick={() => setActivity(false)}><X size={16} /></button></header>{[...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6).map(t => <button key={t.id} onClick={() => { setEditor({ task: t }); setActivity(false); }}><span className="activity-icon"><Check size={15} /></span><div><b>{t.title}</b><small>Updated {new Date(t.updatedAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></div><ChevronRight size={14} /></button>)}{!tasks.length && <p>กิจกรรมจะปรากฏเมื่อเริ่มสร้างงาน</p>}</div>}
    {help && <div className="modal-backdrop"><div className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><button className="icon-button close-help" aria-label="ปิดคู่มือ" onClick={() => setHelp(false)}><X size={19} /></button><Brand /><h2 id="help-title">A room for your best work.</h2><p>เริ่มจากสร้างโปรเจกต์ แล้วเพิ่มสมาชิกด้วยอีเมลที่สมัครบัญชีแล้ว เจ้าของห้องจัดการสิทธิ์ได้ ส่วน Editor แก้ไขงานได้ และ Viewer ดูได้อย่างเดียว</p><div><List size={18} /><span><b>List</b> จัดกลุ่มงานตามสถานะ พร้อมคอลัมน์ที่เพิ่มเองได้</span></div><div><LayoutGrid size={18} /><span><b>Board</b> ลากการ์ดเพื่อเปลี่ยนสถานะ หรือแก้ในรายละเอียดงาน</span></div><div><CalendarDays size={18} /><span><b>Calendar</b> ดูงานตาม due date และเพิ่มงานในวันที่เลือก</span></div><p>คลิกงานเพื่อใส่ลิงก์ไฟล์ เช็กลิสต์ ผู้รับผิดชอบ Type Content และ Channel ข้อมูลบันทึกลงฐานข้อมูลของเว็บไซต์</p><button className="primary" onClick={() => setHelp(false)}>Let’s get started<ArrowRight size={16} /></button></div></div>}
    {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
  </div>;
}
