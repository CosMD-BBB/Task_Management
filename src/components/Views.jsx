import React, { useMemo, useState } from 'react';
import { ArrowUp, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Circle, Flag, GripVertical, Link2, ListTodo, MessageSquare, Plus, X } from 'lucide-react';
import './views.css';

export const STATUSES = [
  { id: 'todo', label: 'TO DO', color: '#64748b', light: '#f0f2f6' },
  { id: 'in_progress', label: 'IN PROGRESS', color: '#7655d6', light: '#f0ebfc' },
  { id: 'review', label: 'IN REVIEW', color: '#ad7410', light: '#fff7e6' },
  { id: 'scheduled', label: 'SCHEDULED', color: '#0b8b7b', light: '#e5f6f1' },
  { id: 'done', label: 'COMPLETE', color: '#25874f', light: '#edf7ef' },
];

export const PRIORITIES = [
  { id: 'urgent', label: 'Urgent', color: '#dc4a61' },
  { id: 'high', label: 'High', color: '#dc9639' },
  { id: 'normal', label: 'Normal', color: '#6184cf' },
  { id: 'low', label: 'Low', color: '#96a0ad' },
];

function dateInBangkok() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function displayDate(value, showYear = false) {
  if (!value) return 'No due date';
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(showYear ? { year: 'numeric' } : {}) });
}

function safeLink(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
}

function Avatar({ user, small = false }) {
  return <span className={`tm-avatar ${small ? 'tm-avatar-small' : ''}`} style={{ '--avatar-color': user?.avatarColor || '#e9b87b' }} title={user?.name || 'Unassigned'} aria-label={user?.name || 'Unassigned'}>{user ? initials(user.name) : <Circle size={13} />}</span>;
}

function taskValues(task, field, legacyField) {
  const values = Array.isArray(task[field]) ? task[field] : task[legacyField] ? [task[legacyField]] : [];
  return [...new Set(values.filter(Boolean))];
}

function TaskAssignees({ task, members, compact = false }) {
  const users = taskValues(task, 'assigneeIds', 'assigneeId').map(id => members[id]).filter(Boolean);
  if (!users.length) return compact ? <Avatar small /> : <span className="tm-assignee-empty">ยังไม่มอบหมาย</span>;
  const visible = compact ? users.slice(0, 3) : users;
  return <span className={`tm-assignees ${compact ? 'tm-assignees-compact' : ''}`} title={users.map(user => user.name).join(', ')}>
    <span className="tm-assignee-avatars">{visible.map(user => <Avatar key={user.id} user={user} small />)}{compact && users.length > 3 && <span className="tm-assignee-extra">+{users.length - 3}</span>}</span>
    {!compact && <span className="tm-assignee-names">{users.map(user => user.name?.split(' ')[0]).join(', ')}</span>}
  </span>;
}

function Priority({ value, compact = false }) {
  const item = PRIORITIES.find(priority => priority.id === value) || PRIORITIES[2];
  return <span className={`tm-priority ${compact ? 'tm-priority-compact' : ''}`} style={{ '--priority-color': item.color }} title={`${item.label} priority`}><Flag size={12} fill="currentColor" strokeWidth={1.5} />{!compact && item.label}</span>;
}

function ContentTag({ value }) {
  if (!value) return <span className="tm-muted">—</span>;
  const token = value.toLowerCase();
  const color = token.includes('video') || token.includes('vdo') || token.includes('reel') || token.includes('วิดีโอ') ? 'pink' : token.includes('photo') || token.includes('album') || token.includes('ภาพ') ? 'violet' : token.includes('info') || token.includes('อินโฟ') ? 'blue' : 'purple';
  return <span className={`tm-tag tm-tag-${color}`}>{value}</span>;
}

function ChannelTag({ value }) {
  if (!value) return <span className="tm-muted">—</span>;
  return <span className={`tm-channel tm-channel-${value.toLowerCase().replace(/[^a-z]/g, '')}`}>{value}</span>;
}

function TaskTags({ task, kind }) {
  const values = kind === 'contentType' ? taskValues(task, 'contentTypes', 'contentType') : taskValues(task, 'channels', 'channel');
  if (!values.length) return <span className="tm-muted">—</span>;
  return <span className="tm-task-tags">{values.map(value => kind === 'contentType' ? <ContentTag key={value} value={value} /> : <ChannelTag key={value} value={value} />)}</span>;
}

function TaskTagEditor({ task, kind, onEdit, canEdit, labeled = false }) {
  const content = kind === 'contentType';
  const values = content ? taskValues(task, 'contentTypes', 'contentType') : taskValues(task, 'channels', 'channel');
  return <button className={`tm-tag-editor ${labeled ? 'tm-tag-editor-labeled' : ''}`} onClick={() => onEdit(task)} aria-label={`${canEdit ? 'แก้ไข' : 'ดู'}${content ? 'ประเภทคอนเทนต์' : 'ช่องทางโพสต์'}ของ ${task.title}`} title={canEdit ? 'เลือกได้หลายรายการ หรือเพิ่มตัวเลือกใหม่ในรายละเอียดงาน' : 'เปิดรายละเอียดงาน'}>
    {labeled && <span className="tm-tag-editor-label">{content ? 'คอนเทนต์' : 'โพสต์ที่'}</span>}
    <span className="tm-tag-editor-values">{values.length ? <TaskTags task={task} kind={kind} /> : <span className="tm-tag-editor-empty">{canEdit ? content ? 'เลือกคอนเทนต์' : 'เลือกช่องทาง' : 'ยังไม่ระบุ'}</span>}{canEdit && <span className="tm-tag-editor-add" aria-hidden="true"><Plus size={12} /></span>}</span>
  </button>;
}

function TaskStatusSelect({ task, canEdit, pending, onStatusChange }) {
  const status = STATUSES.find(item => item.id === task.status) || STATUSES[0];
  return <span className="tm-inline-status" style={{ '--status-color': status.color, '--status-light': status.light }}>
    <span className="tm-inline-status-dot" aria-hidden="true" />
    <select aria-label={`Status for ${task.title}`} title={canEdit ? 'เลือกสถานะของงาน' : 'ดูได้อย่างเดียว'} value={task.status} disabled={!canEdit || pending} onChange={event => onStatusChange(task, event.target.value)}>
      {STATUSES.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select><ChevronDown size={11} aria-hidden="true" />
  </span>;
}

function TaskDate({ task }) {
  const late = task.dueDate && task.dueDate < dateInBangkok() && task.status !== 'done';
  return <span className={`tm-due ${late ? 'tm-due-overdue' : ''}`} title={task.dueDate ? `${displayDate(task.dueDate, true)}${late ? ' · Overdue' : ''}` : 'No due date'}>{task.dueDate ? <><CalendarDays size={12} />{displayDate(task.dueDate)}</> : <span className="tm-muted">—</span>}</span>;
}

function StatusBadge({ status, showLabel = true }) {
  const item = STATUSES.find(entry => entry.id === status) || STATUSES[0];
  return <span className="tm-status-badge" style={{ '--status-color': item.color, '--status-light': item.light }}><span className="tm-status-dot">{status === 'done' && <Check size={9} />}</span>{showLabel && item.label}</span>;
}

function EmptyState({ hasSearch, onCreate, canEdit }) {
  return <div className="tm-empty"><span className="tm-empty-icon"><ListTodo size={27} /></span><h3>{hasSearch ? 'ไม่พบงานที่ตรงกับการค้นหา' : 'เริ่มต้นด้วยงานแรกของทีม'}</h3><p>{hasSearch ? 'ลองเปลี่ยนคำค้น หรือเลือกแสดงงานทั้งหมด' : 'เพิ่มงาน เลือกผู้รับผิดชอบ แล้วระบุคอนเทนต์และช่องทางที่ต้องโพสต์'}</p>{canEdit && !hasSearch && <button className="tm-create-button" onClick={() => onCreate({})}><Plus size={16} />เพิ่มงานแรก</button>}</div>;
}

function ListView({ tasks, project, onEdit, onStatusChange, onCreate, canEdit, pending }) {
  const [collapsed, setCollapsed] = useState({});
  const members = useMemo(() => Object.fromEntries((project?.members || []).map(member => [member.userId || member.user?.id, member.user])), [project]);
  const fields = project?.fields || [];
  return <div className="tm-list-view">
    {STATUSES.map(status => {
      const grouped = tasks.filter(task => task.status === status.id);
      if (!grouped.length && status.id !== 'todo') return null;
      return <section className="tm-task-group" key={status.id}>
        <div className="tm-group-heading">
          <button className={`tm-group-toggle ${collapsed[status.id] ? 'tm-collapsed' : ''}`} aria-label={`${collapsed[status.id] ? 'Expand' : 'Collapse'} ${status.label} tasks`} aria-expanded={!collapsed[status.id]} onClick={() => setCollapsed(old => ({ ...old, [status.id]: !old[status.id] }))}><ChevronDown size={15} /></button>
          <StatusBadge status={status.id} /><span className="tm-group-count">{grouped.length}</span>
          {canEdit && <button className="tm-icon-button tm-group-add" aria-label={`Add ${status.label.toLowerCase()} task`} onClick={() => onCreate({ status: status.id })}><Plus size={15} /></button>}
          <span className="tm-group-rule" />
        </div>
        {!collapsed[status.id] && <div className="tm-table-scroll">
          <table className="tm-task-table">
            <thead><tr><th className="tm-name-heading">ชื่องาน<span>Task</span></th><th>สถานะ<span>Status</span></th><th>ความสำคัญ<span>Priority</span></th><th>ผู้รับผิดชอบ<span>Assignees</span></th><th>กำหนดส่ง<span>Due date</span></th><th>ประเภทคอนเทนต์<span>เลือกได้หลายแบบ</span></th><th>ช่องทางโพสต์<span>เลือกได้หลายช่องทาง</span></th><th>ไฟล์และลิงก์<span>Attachments</span></th>{fields.map(field => <th key={field.id}>{field.name}</th>)}</tr></thead>
            <tbody>{grouped.map(task => <tr key={task.id} className={task.status === 'done' ? 'tm-complete-row' : ''}>
              <td><div className="tm-task-name-cell"><span className="tm-task-status-marker" style={{ color: status.color }} aria-hidden="true"><Circle size={14} /></span><button className="tm-task-title" onClick={() => onEdit(task)}>{task.title}</button>{task.description && <MessageSquare size={13} className="tm-description-indicator" aria-label="Has description" />}{!!task.subtasks?.length && <span className="tm-subtask-progress" title="Completed checklist items"><CheckCircle2 size={12} />{task.subtasks.filter(item => item.done).length}/{task.subtasks.length}</span>}</div></td>
              <td data-label="สถานะ"><TaskStatusSelect task={task} canEdit={canEdit} pending={pending.has(task.id)} onStatusChange={onStatusChange} /></td>
              <td data-label="ความสำคัญ"><Priority value={task.priority} /></td>
              <td data-label="ผู้รับผิดชอบ"><TaskAssignees task={task} members={members} /></td>
              <td data-label="กำหนดส่ง"><TaskDate task={task} /></td>
              <td data-label="ประเภทคอนเทนต์ · เลือกได้หลายแบบ"><TaskTagEditor task={task} kind="contentType" onEdit={onEdit} canEdit={canEdit} /></td>
              <td data-label="ช่องทางโพสต์ · เลือกได้หลายช่องทาง"><TaskTagEditor task={task} kind="channel" onEdit={onEdit} canEdit={canEdit} /></td>
              <td data-label="ไฟล์และลิงก์">{task.links?.length ? <div className="tm-link-cell">{task.links.slice(0, 1).map((link, index) => safeLink(link.url) ? <a key={index} href={safeLink(link.url)} target="_blank" rel="noopener noreferrer" title={link.url}><Link2 size={13} /><span>{link.label || 'เปิดไฟล์'}</span></a> : <span className="tm-muted" key={index}>ลิงก์ไม่ถูกต้อง</span>)}{task.links.length > 1 && <button className="tm-link-more" onClick={() => onEdit(task)}>+{task.links.length - 1}</button>}</div> : <span className="tm-muted">—</span>}</td>
              {fields.map(field => <td data-label={field.name} key={field.id}><span className="tm-custom-value">{task.customFields?.[field.id] || <span className="tm-muted">—</span>}</span></td>)}
            </tr>)}</tbody>
          </table>
          {canEdit && <button className="tm-add-row" onClick={() => onCreate({ status: status.id })}><Plus size={15} />เพิ่มงาน<span>{status.label}</span></button>}
          {!grouped.length && !canEdit && <p className="tm-empty-group">ยังไม่มีงานในสถานะนี้</p>}
        </div>}
      </section>;
    })}
  </div>;
}

function BoardView({ tasks, project, onEdit, onStatusChange, onCreate, canEdit, pending }) {
  const [dragging, setDragging] = useState(null);
  const [target, setTarget] = useState(null);
  const members = useMemo(() => Object.fromEntries((project?.members || []).map(member => [member.userId || member.user?.id, member.user])), [project]);
  function drop(event, status) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/plain') || dragging;
    const task = tasks.find(item => item.id === taskId);
    if (task && canEdit && task.status !== status) onStatusChange(task, status);
    setDragging(null);
    setTarget(null);
  }
  return <div className="tm-board-scroll"><div className="tm-board">
    {STATUSES.map(status => {
      const grouped = tasks.filter(task => task.status === status.id);
      return <section className={`tm-board-column ${target === status.id ? 'tm-board-drop-target' : ''}`} key={status.id} onDragOver={event => { if (canEdit && dragging) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setTarget(status.id); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setTarget(null); }} onDrop={event => drop(event, status.id)}>
        <div className="tm-board-heading"><StatusBadge status={status.id} /><span className="tm-group-count">{grouped.length}</span>{canEdit && <button className="tm-icon-button" aria-label={`Add ${status.label.toLowerCase()} task`} onClick={() => onCreate({ status: status.id })}><Plus size={16} /></button>}</div>
        <div className="tm-board-cards">{grouped.map(task => <article className={`tm-board-card ${dragging === task.id ? 'tm-board-card-dragging' : ''} ${pending.has(task.id) ? 'tm-task-pending' : ''}`} key={task.id} draggable={canEdit && !pending.has(task.id)} onDragStart={event => { setDragging(task.id); event.dataTransfer.setData('text/plain', task.id); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDragging(null); setTarget(null); }}>
          <div className="tm-card-top"><Priority value={task.priority} />{canEdit && <GripVertical size={14} className="tm-card-grip" aria-hidden="true" />}</div>
          <button className="tm-card-title" onClick={() => onEdit(task)}>{task.title}</button>
          {task.description && <p className="tm-card-description">{task.description}</p>}
          <div className="tm-card-tags"><TaskTagEditor task={task} kind="contentType" onEdit={onEdit} canEdit={canEdit} labeled /><TaskTagEditor task={task} kind="channel" onEdit={onEdit} canEdit={canEdit} labeled /></div>
          <div className="tm-card-details"><TaskDate task={task} /><span className="tm-card-details-right">{!!task.links?.length && <span title={`${task.links.length} attached links`}><Link2 size={13} />{task.links.length}</span>}{!!task.subtasks?.length && <span title="Checklist progress"><CheckCircle2 size={13} />{task.subtasks.filter(item => item.done).length}/{task.subtasks.length}</span>}<TaskAssignees task={task} members={members} compact /></span></div>
          {canEdit && <div className="tm-card-status-control"><select value={task.status} disabled={pending.has(task.id)} aria-label={`Move ${task.title} to status`} onChange={event => onStatusChange(task, event.target.value)}>{STATUSES.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select><ChevronDown size={12} aria-hidden="true" /></div>}
        </article>)}</div>
        {canEdit ? <button className="tm-board-add" onClick={() => onCreate({ status: status.id })}><Plus size={15} />เพิ่มงาน</button> : !grouped.length && <span className="tm-board-empty">ยังไม่มีงาน</span>}
      </section>;
    })}
  </div><p className="tm-board-hint">{canEdit ? 'ลากการ์ดเพื่อย้ายสถานะ หรือเลือกสถานะที่ด้านล่างการ์ด · คลิกคอนเทนต์และช่องทางเพื่อเลือกหลายรายการ' : 'คลิกชื่องานเพื่อดูรายละเอียด'}</p></div>;
}

function CalendarView({ tasks, onEdit, onCreate, canEdit }) {
  const today = dateInBangkok();
  const [month, setMonth] = useState(() => { const parts = today.split('-').map(Number); return new Date(parts[0], parts[1] - 1, 1); });
  const [activeDay, setActiveDay] = useState(null);
  const grouped = useMemo(() => {
    const result = {};
    tasks.forEach(task => { if (task.dueDate) (result[task.dueDate] ||= []).push(task); });
    return result;
  }, [tasks]);
  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cellCount = Math.ceil((offset + count) / 7) * 7;
    return Array.from({ length: cellCount }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index - offset + 1));
  }, [month]);
  function goMonth(offset) { setMonth(current => new Date(current.getFullYear(), current.getMonth() + offset, 1)); setActiveDay(null); }
  function goToday() { const parts = today.split('-').map(Number); setMonth(new Date(parts[0], parts[1] - 1, 1)); setActiveDay(null); }
  const unscheduled = tasks.filter(task => !task.dueDate);
  return <div className="tm-calendar-view">
    <div className="tm-calendar-toolbar"><div className="tm-calendar-month"><h2>{month.toLocaleDateString('th-TH', { month: 'long' })}<span>{month.getFullYear()}</span></h2><span className="tm-calendar-caption">วางแผนงานตามกำหนดส่ง · กด + ในวันที่ต้องการเพิ่มงาน</span></div><div className="tm-calendar-nav"><button className="tm-today-button" onClick={goToday}>วันนี้</button><div><button className="tm-icon-button" aria-label="Previous month" onClick={() => goMonth(-1)}><ChevronLeft size={18} /></button><button className="tm-icon-button" aria-label="Next month" onClick={() => goMonth(1)}><ChevronRight size={18} /></button></div></div></div>
    <div className="tm-calendar-grid"><div className="tm-calendar-weekdays">{['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'].map(day => <div key={day}>{day}</div>)}</div><div className="tm-calendar-days">{days.map(date => {
      const key = dateKey(date);
      const dayTasks = grouped[key] || [];
      const currentMonth = date.getMonth() === month.getMonth();
      return <div key={key} className={`tm-calendar-day ${!currentMonth ? 'tm-calendar-outside' : ''} ${key === today ? 'tm-calendar-today' : ''} ${activeDay === key ? 'tm-calendar-selected' : ''}`}>
        <div className="tm-calendar-date-row"><button className="tm-calendar-day-number" aria-label={`Show tasks for ${displayDate(key, true)}`} aria-current={key === today ? 'date' : undefined} onClick={() => setActiveDay(activeDay === key ? null : key)}>{date.getDate()}</button>{canEdit && <button className="tm-calendar-add" aria-label={`Add task due ${displayDate(key, true)}`} onClick={() => onCreate({ dueDate: key })}><Plus size={12} /></button>}</div>
        <div className="tm-calendar-day-tasks">{dayTasks.slice(0, 3).map(task => {
          const status = STATUSES.find(item => item.id === task.status) || STATUSES[0];
          return <button key={task.id} className={`tm-calendar-task ${task.status === 'done' ? 'tm-calendar-task-done' : ''}`} style={{ '--status-color': status.color, '--status-light': status.light }} title={task.title} onClick={() => onEdit(task)}><span className="tm-calendar-task-dot" /><span>{task.title}</span></button>;
        })}{dayTasks.length > 3 && <button className="tm-calendar-more" onClick={() => setActiveDay(key)}>อีก {dayTasks.length - 3} งาน</button>}</div>
      </div>;
    })}</div></div>
    {activeDay && <section className="tm-calendar-day-panel"><div className="tm-calendar-panel-heading"><h3>{displayDate(activeDay, true)}<span>{(grouped[activeDay] || []).length} งาน</span></h3><button className="tm-icon-button" aria-label="Close day details" onClick={() => setActiveDay(null)}><X size={16} /></button></div>{(grouped[activeDay] || []).length ? <div className="tm-calendar-panel-tasks">{grouped[activeDay].map(task => <button key={task.id} onClick={() => onEdit(task)}><StatusBadge status={task.status} showLabel={false} /><span>{task.title}</span><Priority value={task.priority} /></button>)}</div> : <p className="tm-calendar-no-tasks">ยังไม่มีงานในวันนี้ เพิ่มงานเพื่อวางแผนล่วงหน้าได้เลย</p>}{canEdit && <button className="tm-add-row" onClick={() => onCreate({ dueDate: activeDay })}><Plus size={15} />เพิ่มงานในวันนี้</button>}</section>}
    {!!unscheduled.length && <section className="tm-unscheduled"><div className="tm-unscheduled-title"><CalendarDays size={16} /><h3>งานที่ยังไม่กำหนดวันส่ง</h3><span>{unscheduled.length}</span></div><div className="tm-unscheduled-tasks">{unscheduled.map(task => <button key={task.id} onClick={() => onEdit(task)}><StatusBadge status={task.status} showLabel={false} /><span>{task.title}</span><ArrowUp size={13} style={{ transform: 'rotate(45deg)' }} /></button>)}</div></section>}
  </div>;
}

export function TaskViews({ view = 'list', tasks = [], project, onEdit, onStatusChange, onCreate, canEdit = false, search = '' }) {
  const [pending, setPending] = useState(new Set());
  const [error, setError] = useState('');
  async function changeStatus(task, status) {
    if (pending.has(task.id) || task.status === status || !canEdit) return;
    setError('');
    setPending(current => new Set([...current, task.id]));
    try { await onStatusChange(task, status); }
    catch (err) { setError(err.message || 'Could not update the task. Please try again.'); }
    finally { setPending(current => { const next = new Set(current); next.delete(task.id); return next; }); }
  }
  const props = { tasks, project, onEdit, onCreate, canEdit, onStatusChange: changeStatus, pending };
  return <div className={`tm-views tm-view-${view}`}>
    {error && <div className="tm-view-error" role="alert"><span>{error}</span><button className="tm-icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={14} /></button></div>}
    {!tasks.length && view !== 'calendar' ? <EmptyState hasSearch={!!search} canEdit={canEdit} onCreate={onCreate} /> : view === 'board' ? <BoardView {...props} /> : view === 'calendar' ? <CalendarView {...props} /> : <ListView {...props} />}
  </div>;
}

export default TaskViews;
