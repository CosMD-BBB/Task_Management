import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Bell, CalendarDays, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Filter, Flag, FolderKanban, LayoutGrid, List, Loader2, LockKeyhole, LogOut, Menu, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Users, X } from 'lucide-react';
import { api } from './api';
import { TaskViews } from './components/Views';
import { TaskEditor } from './components/TaskEditor';
import ProjectSettings from './components/ProjectSettings';
import { AuthScreen, VerificationScreen, AccountSecurity } from './components/AccountScreens';
import { AdminPanel } from './components/AdminPanel';
import { NotificationPanel } from './components/Notifications';
import ThemeToggle from './components/ThemeToggle';

const userInitials = (name = '') => name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
const viewIcons = { list: List, board: LayoutGrid, calendar: CalendarDays };

function Brand({ small = false }) {
  return <div className={`brand ${small ? 'small' : ''}`}><span className="brand-symbol"><FolderKanban size={small ? 19 : 24} strokeWidth={2.4} /></span><span>room<span className="brand-dot">.</span></span></div>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState('');
  const [projectId, setProjectId] = useState('');
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [taskLoadError, setTaskLoadError] = useState('');
  const [loadedProjectId, setLoadedProjectId] = useState('');
  const [view, setView] = useState('list');
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [priority, setPriority] = useState('all');
  const [channel, setChannel] = useState('all');
  const [contentType, setContentType] = useState('all');
  const [mine, setMine] = useState(false);
  const [sort, setSort] = useState('updated');
  const [editor, setEditor] = useState(null);
  const [settings, setSettings] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activity, setActivity] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [adminOpen, setAdminOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [openingNotification, setOpeningNotification] = useState(null);
  const [accountAction, setAccountAction] = useState(() => { const q = new URLSearchParams(location.search); return Boolean(q.get('token') || q.get('verify') || q.get('reset')); });
  const [help, setHelp] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const requestVersion = useRef(0);
  const projectRequestVersion = useRef(0);
  const taskMutations = useRef(0);
  const refreshPending = useRef(false);
  const workspaceRefreshVersion = useRef(0);
  const sessionVersion = useRef(0);
  const notificationRequestVersion = useRef(0);
  const activeUserId = useRef(user?.id);
  const activeProjectId = useRef(projectId);
  activeUserId.current = user?.id;
  activeProjectId.current = projectId;
  const context = { userId: user?.id, projectId, sessionVersion: sessionVersion.current };
  const isCurrentSession = captured => captured.userId === activeUserId.current && captured.sessionVersion === sessionVersion.current;
  const isCurrentWorkspace = captured => isCurrentSession(captured) && captured.projectId === activeProjectId.current;
  const setAccountUser = useCallback(next => {
    if (next?.id !== activeUserId.current) {
      ++sessionVersion.current; ++requestVersion.current; ++projectRequestVersion.current; ++notificationRequestVersion.current;
      ++workspaceRefreshVersion.current; refreshPending.current = false; setRefreshing(false);
      activeUserId.current = next?.id; activeProjectId.current = '';
      setProjects([]); setTasks([]); setProjectId(''); setLoadedProjectId(''); setLoading(false); setTaskLoadError(''); setProjectsError('');
      setEditor(null); setSettings(null); setOpeningNotification(null); setNotifications([]); setUnreadCount(0);
      setAdminOpen(false); setSecurityOpen(false); setActivity(false); setSidebarOpen(false); setToast('');
    }
    setUser(next);
  }, []);
  const searchRef = useRef(null);
  const project = projects.find(p => p.id === projectId);
  const canEdit = Boolean(project && project.yourRole !== 'viewer');
  const refreshNotifications = useCallback(async () => {
    const ownerId = activeUserId.current, session = sessionVersion.current, version = ++notificationRequestVersion.current;
    if (!ownerId) return;
    try {
      const { notifications, unreadCount } = await api('/notifications');
      if (ownerId === activeUserId.current && session === sessionVersion.current && version === notificationRequestVersion.current) { setNotifications(notifications); setUnreadCount(unreadCount); }
    } catch (e) {
      if (ownerId === activeUserId.current && session === sessionVersion.current && version === notificationRequestVersion.current) throw e;
    }
  }, []);
  const updateCommentCount = useCallback((taskId, count) => {
    setTasks(list => list.map(task => task.id === taskId && task.commentsCount !== count ? { ...task, commentsCount: count } : task));
    setEditor(current => current?.task?.id === taskId && current.task.commentsCount !== count ? { ...current, task: { ...current.task, commentsCount: count } } : current);
  }, []);
  const onCommentPosted = useCallback(() => { refreshNotifications().catch(() => {}); }, [refreshNotifications]);
  const logout = async () => { const captured = context; await api('/auth/logout', { method: 'POST' }); if (isCurrentSession(captured)) setAccountUser(null); };
  const authenticated = user?.emailVerified === true;

  useEffect(() => { api('/auth/me').then(({ user }) => setAccountUser(user)).catch(e => { if (e.status !== 401) setError(e.message); }).finally(() => setBooting(false)); }, []);
  const refreshProjects = async () => {
    const version = ++projectRequestVersion.current;
    const ownerId = activeUserId.current;
    setProjectsLoading(true);
    try {
      const { projects: latest } = await api('/projects');
      if (version === projectRequestVersion.current && ownerId === activeUserId.current) {
        setProjects(latest); setProjectId(id => latest.some(p => p.id === id) ? id : latest[0]?.id || ''); setProjectsError(''); setError('');
      }
      return latest;
    } catch (e) {
      if (version === projectRequestVersion.current && ownerId === activeUserId.current) { setProjectsError(e.message); throw e; }
      return [];
    } finally { if (version === projectRequestVersion.current && ownerId === activeUserId.current) setProjectsLoading(false); }
  };
  useEffect(() => { if (authenticated) refreshProjects().catch(e => setError(e.message)); else { setProjects([]); setTasks([]); setProjectId(''); } }, [user, authenticated]);
  useEffect(() => {
    if (!projectId) { setTasks([]); setLoadedProjectId(''); return; }
    const version = ++requestVersion.current; setLoading(true); setTaskLoadError(''); setError(''); setTasks([]);
    api(`/projects/${projectId}/tasks`).then(({ tasks }) => { if (requestVersion.current === version) { setTasks(tasks); setLoadedProjectId(projectId); } }).catch(e => { if (requestVersion.current === version) { setTaskLoadError(e.message); setError(e.message); } }).finally(() => { if (requestVersion.current === version) setLoading(false); });
  }, [projectId]);
  useEffect(() => { const key = e => { if (e.defaultPrevented) return; if ((e.ctrlKey || e.metaKey) && e.key === 'k') { if (document.querySelector('[aria-modal="true"]')) return; e.preventDefault(); searchRef.current?.focus(); } if (e.key === 'Escape') { setHelp(false); setActivity(false); setSidebarOpen(false); } }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key); }, []);
  useEffect(() => { if (!authenticated) return; const refresh = () => refreshNotifications().catch(e => { if (e.status === 401) setAccountUser(null); }); refresh(); const timer = setInterval(refresh, 15000); window.addEventListener('focus', refresh); return () => { clearInterval(timer); window.removeEventListener('focus', refresh); }; }, [user?.id, authenticated]);
  useEffect(() => { if (!openingNotification || projectId !== openingNotification.projectId || loadedProjectId !== projectId || loading) return; const task = tasks.find(t => t.id === openingNotification.taskId); if (task) { setEditor({ task, initialTab: openingNotification.type === 'mention' ? 'comments' : 'details', initialCommentId: openingNotification.commentId }); setOpeningNotification(null); } else if (tasks.length || !loading) { setOpeningNotification(null); setError('งานนี้อาจถูกลบ หรือคุณไม่มีสิทธิ์เข้าถึงแล้ว'); } }, [tasks, loading, projectId, loadedProjectId, openingNotification]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer); }, [toast]);
  const refreshWorkspace = useCallback(async () => {
    if (!authenticated || !projectId || loading || refreshPending.current || taskMutations.current) return;
    const version = requestVersion.current;
    const projectsVersion = projectRequestVersion.current;
    const ownerId = activeUserId.current;
    const refreshVersion = ++workspaceRefreshVersion.current;
    refreshPending.current = true; setRefreshing(true);
    try {
      const [projectResult, taskResult] = await Promise.allSettled([api('/projects'), api(`/projects/${projectId}/tasks`)]);
      if (version !== requestVersion.current || ownerId !== activeUserId.current || taskMutations.current) return;
      if (projectResult.status === 'fulfilled' && projectsVersion === projectRequestVersion.current) {
        const latest = projectResult.value.projects;
        setProjects(latest);
        if (!latest.some(item => item.id === projectId)) {
          setEditor(null); setSettings(null); setTasks([]); setLoadedProjectId(''); setProjectId(latest[0]?.id || '');
          setError('สิทธิ์เข้าถึงโปรเจกต์นี้เปลี่ยนไปแล้ว'); return;
        }
      }
      if (taskResult.status === 'fulfilled') { setTasks(taskResult.value.tasks); setLoadedProjectId(projectId); setTaskLoadError(''); setError(previous => previous === taskLoadError ? '' : previous); }
      else {
        if (taskResult.reason.status === 401) { setAccountUser(null); return; }
        if ([403, 404].includes(taskResult.reason.status)) { setEditor(null); setTasks([]); }
        setError('อัปเดตงานล่าสุดไม่สำเร็จ กดรีเฟรชงานเพื่อลองอีกครั้ง');
      }
    } finally { if (refreshVersion === workspaceRefreshVersion.current) { refreshPending.current = false; setRefreshing(false); } }
  }, [authenticated, projectId, loading, taskLoadError]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) refreshWorkspace(); };
    if (!authenticated || !projectId) return;
    const timer = setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [authenticated, projectId, refreshWorkspace]);
  const counts = { total: tasks.length, done: tasks.filter(t => t.status === 'done').length, due: tasks.filter(t => t.dueDate === today() && t.status !== 'done').length, overdue: tasks.filter(t => t.dueDate && t.dueDate < today() && t.status !== 'done').length };
  const filtered = useMemo(() => {
    const weights = { urgent: 0, high: 1, normal: 2, low: 3 };
    return tasks.filter(t => (!search || `${t.title} ${t.description} ${(t.contentTypes || [t.contentType]).join(' ')} ${(t.channels || [t.channel]).join(' ')}`.toLowerCase().includes(search.toLowerCase())) && (priority === 'all' || t.priority === priority) && (channel === 'all' || (t.channels || [t.channel]).includes(channel)) && (contentType === 'all' || (t.contentTypes || [t.contentType]).includes(contentType)) && (!mine || (t.assigneeIds || [t.assigneeId]).includes(user?.id))).sort((a, b) => sort === 'due' ? (a.dueDate || '9999').localeCompare(b.dueDate || '9999') : sort === 'priority' ? weights[a.priority] - weights[b.priority] : (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }, [tasks, search, priority, channel, contentType, mine, sort, user]);
  const chooseProject = id => { if (id !== activeProjectId.current) { ++requestVersion.current; ++workspaceRefreshVersion.current; refreshPending.current = false; setRefreshing(false); } activeProjectId.current = id; setProjectId(id); setEditor(null); setSettings(null); setSearch(''); setChannel('all'); setContentType('all'); setPriority('all'); setMine(false); setSidebarOpen(false); };
  const reloadProjectTasks = async (id, captured = context) => {
    if (!isCurrentWorkspace(captured) || id !== captured.projectId || taskMutations.current) return null;
    const version = ++requestVersion.current;
    setLoading(true); setTaskLoadError('');
    try {
      const { tasks: latest } = await api(`/projects/${id}/tasks`);
      if (!isCurrentWorkspace(captured) || version !== requestVersion.current) return null;
      setTasks(latest); setLoadedProjectId(id); setTaskLoadError('');
      return latest;
    } catch (e) {
      if (!isCurrentWorkspace(captured) || version !== requestVersion.current) return null;
      setTaskLoadError(e.message); throw e;
    } finally { if (isCurrentWorkspace(captured) && version === requestVersion.current) setLoading(false); }
  };
  const saveTask = async body => {
    const captured = context, savedEditor = editor;
    if (!isCurrentWorkspace(captured) || !savedEditor) return;
    taskMutations.current += 1; ++requestVersion.current;
    try {
      const { task } = await api(savedEditor.task ? `/tasks/${savedEditor.task.id}` : `/projects/${captured.projectId}/tasks`, { method: savedEditor.task ? 'PATCH' : 'POST', body: savedEditor.task ? { ...body, expectedUpdatedAt: savedEditor.task.updatedAt } : body });
      if (!isCurrentWorkspace(captured)) return;
      ++requestVersion.current; setTasks(list => savedEditor.task ? list.map(t => t.id === task.id ? task : t) : [task, ...list]);
      setEditor(null); refreshNotifications().catch(() => {}); setToast('บันทึกงานเรียบร้อย');
    } finally { taskMutations.current -= 1; if (isCurrentWorkspace(captured)) setLoading(false); }
  };
  const changeStatus = async (task, status) => {
    const captured = context;
    if (!isCurrentWorkspace(captured)) return;
    taskMutations.current += 1; ++requestVersion.current;
    try {
      const { task: updated } = await api(`/tasks/${task.id}`, { method: 'PATCH', body: { status, expectedUpdatedAt: task.updatedAt } });
      if (!isCurrentWorkspace(captured)) return;
      ++requestVersion.current; setTasks(list => list.map(t => t.id === updated.id ? updated : t)); setToast('อัปเดตสถานะแล้ว');
    } catch (e) {
      if (!isCurrentWorkspace(captured)) return;
      if (e.currentTask) setTasks(list => list.map(t => t.id === e.currentTask.id ? e.currentTask : t));
      setError(e.message); throw e;
    } finally { taskMutations.current -= 1; if (isCurrentWorkspace(captured)) setLoading(false); }
  };
  const deleteTask = async task => {
    const captured = context;
    if (!isCurrentWorkspace(captured)) return;
    taskMutations.current += 1; ++requestVersion.current;
    try { await api(`/tasks/${task.id}`, { method: 'DELETE' }); if (!isCurrentWorkspace(captured)) return; ++requestVersion.current; setTasks(list => list.filter(t => t.id !== task.id)); setEditor(null); setToast('ลบงานเรียบร้อย'); }
    finally { taskMutations.current -= 1; if (isCurrentWorkspace(captured)) setLoading(false); }
  };
  const reloadLatestTask = latest => {
    setTasks(list => list.map(task => task.id === latest.id ? latest : task));
    setEditor(current => ({ ...current, task: latest, initialTab: 'details', initialSection: undefined, reloadKey: (current?.reloadKey || 0) + 1 }));
  };
  const createTask = (initialValues = {}) => setEditor({ task: null, initialValues });
  const projectSaved = async updated => {
    const captured = context;
    if (!isCurrentWorkspace(captured)) return;
    await refreshProjects();
    if (!isCurrentSession(captured)) return;
    if (settings === 'create') chooseProject(updated.id);
    else if (isCurrentWorkspace(captured) && updated.id === captured.projectId) await reloadProjectTasks(updated.id, captured);
    if (isCurrentSession(captured)) setToast(settings === 'create' ? 'สร้างห้องโปรเจกต์แล้ว' : 'อัปเดตโปรเจกต์แล้ว');
  };
  const projectDeleted = async () => {
    const captured = context;
    if (!isCurrentWorkspace(captured)) return;
    setSettings(null);
    await refreshProjects();
    if (isCurrentSession(captured)) setToast('ลบโปรเจกต์เรียบร้อย');
  };
  const openNotificationTask = async notification => {
    const captured = context;
    if (!isCurrentWorkspace(captured)) return;
    try {
      if (notification.projectId === captured.projectId) {
        const latestTasks = await reloadProjectTasks(captured.projectId, captured);
        if (!latestTasks || !isCurrentWorkspace(captured)) return;
        const task = latestTasks.find(t => t.id === notification.taskId);
        if (!task) throw new Error('งานนี้อาจถูกลบแล้ว');
        setEditor({ task, initialTab: notification.type === 'mention' ? 'comments' : 'details', initialCommentId: notification.commentId });
      } else {
        const availableProjects = await refreshProjects();
        if (!isCurrentWorkspace(captured)) return;
        if (!availableProjects.some(p => p.id === notification.projectId)) throw new Error('คุณไม่มีสิทธิ์เข้าถึงโปรเจกต์นี้แล้ว');
        chooseProject(notification.projectId); setOpeningNotification(notification);
      }
      setActivity(false);
    } catch (e) { if (isCurrentWorkspace(captured)) setError(e.message); }
  };
  const adminChanged = async () => {
    const captured = context;
    if (!isCurrentSession(captured)) return;
    const { user: updatedUser } = await api('/auth/me');
    if (!isCurrentSession(captured)) return;
    setAccountUser(updatedUser);
    const updatedProjects = await refreshProjects();
    if (!isCurrentSession(captured)) return;
    if (isCurrentWorkspace(captured) && updatedProjects.some(p => p.id === captured.projectId)) await reloadProjectTasks(captured.projectId, captured);
    if (isCurrentSession(captured)) await refreshNotifications();
  };
  if (booting) return <div className="boot-screen"><Brand /><Loader2 className="spin" /><p>กำลังเปิดพื้นที่ทำงาน…</p></div>;
  if (!user || accountAction) return <>
    <div className="auth-theme-tools"><ThemeToggle /></div>
    <AuthScreen Brand={Brand} onActionComplete={() => { setAccountAction(false); setAccountUser(null); }} onAuthenticated={u => { setAccountAction(false); setAccountUser(u); }} />
    {error && <div className="toast error-toast" role="alert">{error}<button onClick={() => setError('')} aria-label="ปิด"><X size={16} /></button></div>}
  </>;
  if (!user.emailVerified) return <><div className="auth-theme-tools"><ThemeToggle /></div><VerificationScreen Brand={Brand} user={user} onVerified={setAccountUser} onLogout={logout} /></>;

  const viewHelp = view === 'list' ? 'คลิกชื่องาน หรือกล่องคอนเทนต์ / ช่องทาง เพื่อแก้ไขและเลือกได้หลายรายการ' : view === 'board' ? 'ลากการ์ดข้ามคอลัมน์เพื่อเปลี่ยนสถานะ คลิกชื่องานหรือแท็กเพื่อแก้ไขรายละเอียด' : 'ดูงานตามวันครบกำหนด คลิกงานเพื่อแก้ไข หรือกด + ในวันที่ต้องการเพิ่มงาน';
  const clearFilters = () => { setPriority('all'); setChannel('all'); setContentType('all'); setMine(false); setSearch(''); };
  const hasFilters = priority !== 'all' || channel !== 'all' || contentType !== 'all' || mine;
  return <div className="workspace">
    {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? 'is-open' : ''}`}>
      <div className="sidebar-brand"><Brand small /><span className="workspace-plan">TEAM</span></div>
      <button className="workspace-switch" onClick={() => setHelp(true)}><span className="workspace-avatar"><Users size={17} /></span><span><strong>Team workspace</strong><small>พื้นที่ทำงานของทีมคุณ</small></span><ChevronDown size={14} /></button>
      <div className="sidebar-nav">
        <button className={!mine && view !== 'calendar' ? 'nav-active' : ''} onClick={() => { clearFilters(); setView('list'); setSidebarOpen(false); }}><LayoutGrid size={18} />งานทั้งหมด<span className="nav-count">{tasks.length}</span></button>
        <button className={mine && view !== 'calendar' ? 'nav-active' : ''} onClick={() => { setMine(true); setView('list'); setSidebarOpen(false); }}><Check size={18} />งานของฉัน<span className="nav-count">{tasks.filter(t => (t.assigneeIds || [t.assigneeId]).includes(user.id)).length}</span></button>
        <button className={view === 'calendar' ? 'nav-active' : ''} onClick={() => { setView('calendar'); setSidebarOpen(false); }}><CalendarDays size={18} />ปฏิทิน</button>
        {user.globalRole === 'superadmin' && <button className="admin-navigation" onClick={() => { setAdminOpen(true); setSidebarOpen(false); }}><ShieldCheck size={18} />จัดการผู้ใช้งาน</button>}
      </div>
      <div className="sidebar-section-title"><span>โปรเจกต์ของทีม</span><button className="icon-button" aria-label="สร้างโปรเจกต์" onClick={() => setSettings('create')}><Plus size={16} /></button></div>
      <div className="project-nav">{projects.map(p => <button className={p.id === projectId ? 'project-active' : ''} key={p.id} onClick={() => chooseProject(p.id)}>
        <span className="project-icon" style={{ color: p.color, background: `${p.color}22` }}>{p.coverImage ? <img src={p.coverImage} alt="" referrerPolicy="no-referrer" /> : p.name[0]?.toUpperCase()}</span><span>{p.name}</span><LockKeyhole size={12} />
      </button>)}</div>
      <button className="new-project-button" aria-label="New project room" onClick={() => setSettings('create')}><Plus size={16} />สร้างโปรเจกต์ใหม่</button>
      <div className="sidebar-bottom">
        <div className="team-note"><span className="team-note-icon"><Sparkles size={17} /></span><b>ทุกงาน มีแผนที่ชัดเจน</b><p>คอนเทนต์อะไร · โพสต์ที่ไหน · ใครดูแล</p><button onClick={() => setHelp(true)}>ดูวิธีใช้งาน<ArrowRight size={14} /></button></div>
        <button className="help-button" onClick={() => setHelp(true)}><CircleHelp size={17} />คู่มือการใช้งาน<span>?</span></button>
        <div className="profile"><span className="avatar" style={{ background: user.avatarColor }}>{userInitials(user.name)}</span><button className="profile-account-button" aria-label="บัญชีและความปลอดภัย" onClick={() => setSecurityOpen(true)}><strong>{user.name}</strong><small>{user.demoScopeId ? 'บัญชีทดลอง' : user.email}</small></button><button className="icon-button" aria-label="ออกจากระบบ" onClick={async () => { try { await logout(); } catch (e) { setError(e.message); } }}><LogOut size={16} /></button></div>
      </div>
    </aside>
    <div className="main-shell">
      <header className="topbar">
        <div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="เปิดเมนู" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><span className="breadcrumb-workspace">Workspace</span><ChevronRight size={14} /><strong>{project?.name || 'โปรเจกต์'}</strong><span className="private-label"><LockKeyhole size={11} />เฉพาะสมาชิก</span></div>
        <div className="topbar-right"><ThemeToggle /><span className="topbar-divider" /><button className={`icon-button notification-button ${activity ? 'pressed' : ''}`} aria-label="การแจ้งเตือน" onClick={() => setActivity(!activity)}><Bell size={19} />{unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}</button><button className="topbar-profile" aria-label="เปิดบัญชีของฉัน" onClick={() => setSecurityOpen(true)}><span className="avatar small-avatar" style={{ background: user.avatarColor }}>{userInitials(user.name)}</span></button></div>
      </header>
      <main className="main-content">
        {error && <div className="form-error page-error workspace-error" role="alert">{error}<button className="icon-button" onClick={() => setError('')} aria-label="ปิด"><X size={14} /></button></div>}
        <div className="welcome-line"><span className="eyebrow">PROJECT WORKSPACE</span><span className="workspace-date">{new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date())}</span></div>
        {project?.coverImage && <button className="project-cover-banner" onClick={() => setSettings('edit')} disabled={project.yourRole !== 'owner'} aria-label="แก้ไขรูปโปรเจกต์"><img src={project.coverImage} alt={`ภาพโปรเจกต์ ${project.name}`} referrerPolicy="no-referrer" />{project.yourRole === 'owner' && <span><Pencil size={12} />แก้ไขรูป</span>}</button>}
        <div className="project-heading">
          <div className="project-heading-main"><div className="heading-row"><span className="heading-icon" style={{ background: project?.color || 'var(--accent)' }}>{project?.coverImage ? <img src={project.coverImage} alt="" referrerPolicy="no-referrer" /> : <FolderKanban size={25} />}</span><h1>{project?.yourRole === 'owner' ? <button className="editable-project-name" aria-label="แก้ไขชื่อและรูปโปรเจกต์" onClick={() => setSettings('edit')}>{project.name}<Pencil size={16} /></button> : project?.name || 'Your project rooms'}</h1>{project && <span className="project-tag">PROJECT</span>}</div><p>{project?.description || 'วางแผนคอนเทนต์ จัดการงาน และทำงานร่วมกันในที่เดียว'}</p></div>
          <div className="heading-actions">{project && <><button className="member-avatars" onClick={() => setSettings('edit')} aria-label="จัดการสมาชิก">{project.members?.slice(0, 3).map(m => <span className="avatar" key={m.userId} style={{ background: m.user.avatarColor }}>{userInitials(m.user.name)}</span>)}<span className="add-member"><Plus size={13} /></span></button><button className="secondary invite-heading" onClick={() => setSettings('edit')}><Users size={16} />{project.yourRole === 'owner' ? 'เชิญสมาชิก' : 'สมาชิก'}</button><button className="icon-button project-settings" aria-label="ตั้งค่าโปรเจกต์" onClick={() => setSettings('edit')}><Settings2 size={20} /></button></>}</div>
        </div>
        {project ? <>
          <div className="stats-row">
            <div><span className="stat-icon"><FolderKanban size={20} /></span><div><small>งานทั้งหมด</small><strong>{counts.total}<span>งาน</span></strong></div></div>
            <div><span className="stat-icon mint"><Check size={20} /></span><div><small>เสร็จเรียบร้อย</small><strong>{counts.done}<span>{counts.total ? `${Math.round(counts.done / counts.total * 100)}% ของโปรเจกต์` : 'งาน'}</span></strong></div><div className="stat-progress"><i style={{ width: `${counts.total ? counts.done / counts.total * 100 : 0}%` }} /></div></div>
            <div><span className="stat-icon amber"><Clock3 size={20} /></span><div><small>ครบกำหนดวันนี้</small><strong>{counts.due}<span>งาน</span></strong></div></div>
            <div><span className="stat-icon rose"><Flag size={20} /></span><div><small>เลยกำหนด</small><strong>{counts.overdue}<span>งาน</span></strong></div></div>
          </div>
          <section className="task-workspace" aria-label="งานในโปรเจกต์">
            <div className="view-navigation"><div className="view-tabs">{Object.entries(viewIcons).map(([key, Icon]) => <button key={key} className={view === key ? 'active-tab' : ''} onClick={() => setView(key)} aria-pressed={view === key}><Icon size={17} /><span className="view-name">{key[0].toUpperCase() + key.slice(1)}</span><small>{key === 'list' ? 'รายการ' : key === 'board' ? 'บอร์ด' : 'ปฏิทิน'}</small>{key === 'list' && <span className="view-task-count">{tasks.length}</span>}</button>)}</div><span className="project-role"><ShieldCheck size={14} />{project.yourRole === 'viewer' ? 'View only' : project.yourRole === 'owner' ? 'Owner' : 'Editor'}</span></div>
            <div className="task-toolbar">
              <div className="toolbar-left"><label className="search-box"><Search size={17} /><input ref={searchRef} aria-label="ค้นหางาน" placeholder="ค้นหาชื่องาน คอนเทนต์ หรือช่องทาง…" value={search} onChange={e => setSearch(e.target.value)} /><kbd>⌘ K</kbd></label><button className={`filter-button ${filtersOpen || hasFilters ? 'selected' : ''}`} onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen}><Filter size={16} />ตัวกรอง{hasFilters && <i />}</button></div>
              <div className="toolbar-right"><button className="icon-button task-refresh" aria-label="รีเฟรชงาน" title="อัปเดตงานล่าสุด" disabled={refreshing || loading} onClick={() => refreshWorkspace()}><RefreshCw size={16} className={refreshing ? 'spin' : ''} /></button><select className="sort-select" aria-label="เรียงลำดับงาน" value={sort} onChange={e => setSort(e.target.value)}><option value="updated">แก้ไขล่าสุด</option><option value="due">วันครบกำหนด</option><option value="priority">ความสำคัญ</option></select>{canEdit && <button className="primary new-task" aria-label="New task" disabled={loading || Boolean(taskLoadError)} onClick={() => createTask()}><Plus size={17} />เพิ่มงาน</button>}</div>
            </div>
            {filtersOpen && <div className="filter-panel"><label>ความสำคัญ<select value={priority} onChange={e => setPriority(e.target.value)}><option value="all">ทุกระดับ</option><option value="urgent">Urgent · ด่วนที่สุด</option><option value="high">High · สำคัญมาก</option><option value="normal">Normal · ปกติ</option><option value="low">Low · ต่ำ</option></select></label><label>ช่องทางโพสต์<select value={channel} onChange={e => setChannel(e.target.value)}><option value="all">ทุกช่องทาง</option>{[...new Set(tasks.flatMap(t => t.channels || [t.channel]).filter(Boolean))].map(c => <option key={c}>{c}</option>)}</select></label><label>ประเภทคอนเทนต์<select aria-label="ประเภทคอนเทนต์" value={contentType} onChange={e => setContentType(e.target.value)}><option value="all">ทุกรูปแบบ</option>{[...new Set(tasks.flatMap(t => t.contentTypes || [t.contentType]).filter(Boolean))].map(type => <option key={type}>{type}</option>)}</select></label><label className="checkbox-label"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} />เฉพาะงานของฉัน</label><button className="text-button" onClick={clearFilters}>ล้างตัวกรอง</button></div>}
            <div className="view-help"><span className="view-help-icon"><CircleHelp size={15} /></span><p>{viewHelp}</p><span className="view-help-count">{filtered.length} งาน{mine ? 'ของฉัน' : ''}</span></div>
            {loading ? <div className="content-loader"><Loader2 className="spin" size={23} /><p>กำลังโหลดงาน…</p></div> : taskLoadError ? <div className="first-project workspace-load-error"><CircleHelp size={30} /><h2>โหลดงานไม่สำเร็จ</h2><p>ตรวจสอบการเชื่อมต่อ แล้วลองโหลดงานอีกครั้ง</p><button className="primary" disabled={refreshing} onClick={() => refreshWorkspace()}><RefreshCw size={16} />ลองโหลดงานอีกครั้ง</button></div> : <TaskViews key={project.id} view={view} tasks={filtered} project={project} onEdit={(task, options = {}) => setEditor({ task, ...options })} onOpenComments={task => setEditor({ task, initialTab: 'comments' })} onStatusChange={changeStatus} onCreate={createTask} canEdit={canEdit} search={search} hasFilters={hasFilters} onClearFilters={clearFilters} />}
          </section>
          <div className="workspace-bottom-note"><LockKeyhole size={12} />เฉพาะสมาชิกโปรเจกต์ที่ได้รับสิทธิ์เข้าถึง<span>{filtered.length} / {tasks.length} งาน</span></div>
        </> : projectsLoading ? <div className="content-loader" role="status"><Loader2 className="spin" size={23} /><p>กำลังโหลดโปรเจกต์…</p></div> : projectsError ? <div className="first-project workspace-load-error"><CircleHelp size={32} /><h2>โหลดโปรเจกต์ไม่สำเร็จ</h2><p>ตรวจสอบการเชื่อมต่อ แล้วลองโหลดอีกครั้ง</p><button className="primary" onClick={() => refreshProjects().catch(e => setError(e.message))}><RefreshCw size={16} />ลองโหลดโปรเจกต์อีกครั้ง</button></div> : <div className="first-project"><span className="empty-project-icon"><FolderKanban size={42} /></span><h2>A fresh start for your team.</h2><p>สร้างห้องโปรเจกต์แรก เพื่อเริ่มวางแผนคอนเทนต์และแบ่งงานในทีม</p><button className="primary" onClick={() => setSettings('create')}><Plus size={17} />สร้างโปรเจกต์แรก</button></div>}
      </main>
    </div>
    {editor && project && <TaskEditor key={`${project.id}:${editor.task?.id || 'new'}:${editor.reloadKey || 0}`} existingTasks={tasks} onAddTag={async (kind, value) => { const { project: updated } = await api(`/projects/${projectId}/tags`, { method: 'PATCH', body: { kind, value } }); if (isCurrentWorkspace(context)) setProjects(list => list.map(p => p.id === updated.id ? updated : p)); return updated; }} task={editor.task} initialValues={editor.initialValues} initialTab={editor.initialTab} initialSection={editor.initialSection} onReloadLatest={reloadLatestTask} initialCommentId={editor.initialCommentId} user={user} onCommentsChange={updateCommentCount} onCommentPosted={onCommentPosted} project={project} canEdit={canEdit} onSave={saveTask} onDelete={deleteTask} onClose={() => { if (isCurrentWorkspace(context)) setEditor(null); }} />}
    {settings && <ProjectSettings create={settings === 'create'} project={settings === 'create' ? undefined : project} onClose={() => { if (isCurrentWorkspace(context)) setSettings(null); }} onSaved={projectSaved} onDeleted={projectDeleted} />}
    {activity && <NotificationPanel notifications={notifications} onClose={() => setActivity(false)} onRead={async notification => { await api(`/notifications/${notification.id}/read`, { method: 'PATCH' }); if (isCurrentSession(context)) await refreshNotifications(); }} onReadAll={async () => { await api('/notifications/read-all', { method: 'POST' }); if (isCurrentSession(context)) await refreshNotifications(); }} onOpenTask={openNotificationTask} />}
    {adminOpen && <AdminPanel user={user} onClose={() => setAdminOpen(false)} onChanged={adminChanged} />}
    {securityOpen && <AccountSecurity user={user} onClose={() => setSecurityOpen(false)} />}
    {help && <div className="modal-backdrop"><div className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><button className="icon-button close-help" aria-label="ปิดคู่มือ" onClick={() => setHelp(false)}><X size={19} /></button><Brand /><h2 id="help-title">เริ่มทำงานกับ Room</h2><p>เริ่มจากสร้างโปรเจกต์ แล้วเพิ่มสมาชิกด้วยอีเมลที่สมัครบัญชีแล้ว เจ้าของห้องจัดการสิทธิ์ได้ ส่วน Editor แก้ไขงานได้ และ Viewer ดูได้อย่างเดียว</p><div><List size={18} /><span><b>List</b> เลือกสถานะงานได้ตรง ๆ และเพิ่มคอลัมน์เองได้</span></div><div><LayoutGrid size={18} /><span><b>Board</b> ลากการ์ดเพื่อเปลี่ยนสถานะ หรือแก้ในรายละเอียดงาน</span></div><div><CalendarDays size={18} /><span><b>Calendar</b> ดูงานตาม due date และเพิ่มงานในวันที่เลือก</span></div><p>คลิกงาน แล้วเลือกประเภทคอนเทนต์ได้หลายอย่าง เช่น วิดีโอ ภาพ หรืออินโฟกราฟิก พร้อมเลือกช่องทางที่จะโพสต์ได้หลายที่ เพิ่มตัวเลือกใหม่ได้จากในงานโดยตรง จากนั้นกดบันทึก</p><button className="primary" onClick={() => setHelp(false)}>เข้าใจแล้ว เริ่มใช้งาน<ArrowRight size={16} /></button></div></div>}
    {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
  </div>;
}
