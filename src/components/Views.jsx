import React, { useMemo, useState } from 'react';
import { ArrowUp, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Circle, Flag, GripVertical, Link2, ListTodo, MessageSquare, Plus, X } from 'lucide-react';
import './views.css';

export const STATUSES = [
  { id: 'todo', label: 'TO DO', color: '#8a94a6', light: '#f0f2f6' },
  { id: 'in_progress', label: 'IN PROGRESS', color: '#6585df', light: '#eef1ff' },
  { id: 'review', label: 'IN REVIEW', color: '#d69b2c', light: '#fff7e6' },
  { id: 'scheduled', label: 'SCHEDULED', color: '#0e9785', light: '#e5f6f1' },
  { id: 'done', label: 'COMPLETE', color: '#4caa78', light: '#edf7ef' },
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
  return <span className={`tm-priority ${compact ? 'tm-priority-compact' : ''}`} style={{ color: item.color }} title={`${item.label} priority`}><Flag size={12} fill={item.color} strokeWidth={1.5} />{!compact && item.label}</span>;
}

function ContentTag({ value }) {
  if (!value) return <span className="tm-muted">—</span>;
  const token = value.toLowerCase();
  const color = token.includes('video') || token.includes('vdo') || token.includes('reel') ? 'pink' : token.includes('photo') || token.includes('album') ? 'violet' : token.includes('info') ? 'blue' : 'purple';
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
  return <div className="tm-empty"><span className="tm-empty-icon"><ListTodo size={27} /></span><h3>{hasSearch ? 'No matching tasks' : 'Make room for your next great idea'}</h3><p>{hasSearch ? 'Try a different search or clear your filters.' : 'Add the first task, assign a teammate, and keep your project moving.'}</p>{canEdit && !hasSearch && <button className="tm-create-button" onClick={() => onCreate({})}><Plus size={16} />Create a task</button>}</div>;
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
            <thead><tr><th className="tm-name-heading">Task name</th><th>Status</th><th>Priority</th><th>Assignees</th><th>Due date</th><th>Type Content</th><th>Channels</th><th>Files & links</th>{fields.map(field => <th key={field.id}>{field.name}</th>)}</tr></thead>
            <tbody>{grouped.map(task => <tr key={task.id} className={task.status === 'done' ? 'tm-complete-row' : ''}>
              <td><div className="tm-task-name-cell"><span className="tm-task-status-marker" style={{ color: status.color }} aria-hidden="true"><Circle size={14} /></span><button className="tm-task-title" onClick={() => onEdit(task)}>{task.title}</button>{task.description && <MessageSquare size={13} className="tm-description-indicator" aria-label="Has description" />}{!!task.subtasks?.length && <span className="tm-subtask-progress" title="Completed checklist items"><CheckCircle2 size={12} />{task.subtasks.filter(item => item.done).length}/{task.subtasks.length}</span>}</div></td>
              <td><TaskStatusSelect task={task} canEdit={canEdit} pending={pending.has(task.id)} onStatusChange={onStatusChange} /></td>
              <td><Priority value={task.priority} /></td>
              <td><TaskAssignees task={task} members={members} /></td>
              <td><TaskDate task={task} /></td>
              <td><TaskTags task={task} kind="contentType" /></td>
              <td><TaskTags task={task} kind="channel" /></td>
              <td>{task.links?.length ? <div className="tm-link-cell">{task.links.slice(0, 1).map((link, index) => safeLink(link.url) ? <a key={index} href={safeLink(link.url)} target="_blank" rel="noopener noreferrer" title={link.url}><Link2 size={13} /><span>{link.label || 'Open file'}</span></a> : <span className="tm-muted" key={index}>Invalid link</span>)}{task.links.length > 1 && <button className="tm-link-more" onClick={() => onEdit(task)}>+{task.links.length - 1}</button>}</div> : <span className="tm-muted">—</span>}</td>
              {fields.map(field => <td key={field.id}><span className="tm-custom-value">{task.customFields?.[field.id] || <span className="tm-muted">—</span>}</span></td>)}
            </tr>)}</tbody>
          </table>
          {canEdit && <button className="tm-add-row" onClick={() => onCreate({ status: status.id })}><Plus size={15} />Add task<span>in {status.label.toLowerCase()}</span></button>}
          {!grouped.length && !canEdit && <p className="tm-empty-group">No tasks in this status.</p>}
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
          {(taskValues(task, 'contentTypes', 'contentType').length > 0 || taskValues(task, 'channels', 'channel').length > 0) && <div className="tm-card-tags">{taskValues(task, 'contentTypes', 'contentType').map(value => <ContentTag key={`content-${value}`} value={value} />)}{taskValues(task, 'channels', 'channel').map(value => <ChannelTag key={`channel-${value}`} value={value} />)}</div>}
          <div className="tm-card-details"><TaskDate task={task} /><span className="tm-card-details-right">{!!task.links?.length && <span title={`${task.links.length} attached links`}><Link2 size={13} />{task.links.length}</span>}{!!task.subtasks?.length && <span title="Checklist progress"><CheckCircle2 size={13} />{task.subtasks.filter(item => item.done).length}/{task.subtasks.length}</span>}<TaskAssignees task={task} members={members} compact /></span></div>
          {canEdit && <div className="tm-card-status-control"><select value={task.status} disabled={pending.has(task.id)} aria-label={`Move ${task.title} to status`} onChange={event => onStatusChange(task, event.target.value)}>{STATUSES.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select><ChevronDown size={12} aria-hidden="true" /></div>}
        </article>)}</div>
        {canEdit ? <button className="tm-board-add" onClick={() => onCreate({ status: status.id })}><Plus size={15} />Add task</button> : !grouped.length && <span className="tm-board-empty">No tasks yet</span>}
      </section>;
    })}
  </div><p className="tm-board-hint">{canEdit ? 'Drag tasks between columns, or use the status menu on each card.' : 'Open a card to see task details.'}</p></div>;
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
    <div className="tm-calendar-toolbar"><div className="tm-calendar-month"><h2>{month.toLocaleDateString('en-US', { month: 'long' })}<span>{month.getFullYear()}</span></h2><span className="tm-calendar-caption">Your team’s plan, at a glance</span></div><div className="tm-calendar-nav"><button className="tm-today-button" onClick={goToday}>Today</button><div><button className="tm-icon-button" aria-label="Previous month" onClick={() => goMonth(-1)}><ChevronLeft size={18} /></button><button className="tm-icon-button" aria-label="Next month" onClick={() => goMonth(1)}><ChevronRight size={18} /></button></div></div></div>
    <div className="tm-calendar-grid"><div className="tm-calendar-weekdays">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <div key={day}>{day}</div>)}</div><div className="tm-calendar-days">{days.map(date => {
      const key = dateKey(date);
      const dayTasks = grouped[key] || [];
      const currentMonth = date.getMonth() === month.getMonth();
      return <div key={key} className={`tm-calendar-day ${!currentMonth ? 'tm-calendar-outside' : ''} ${key === today ? 'tm-calendar-today' : ''} ${activeDay === key ? 'tm-calendar-selected' : ''}`}>
        <div className="tm-calendar-date-row"><button className="tm-calendar-day-number" aria-label={`Show tasks for ${displayDate(key, true)}`} aria-current={key === today ? 'date' : undefined} onClick={() => setActiveDay(activeDay === key ? null : key)}>{date.getDate()}</button>{canEdit && <button className="tm-calendar-add" aria-label={`Add task due ${displayDate(key, true)}`} onClick={() => onCreate({ dueDate: key })}><Plus size={12} /></button>}</div>
        <div className="tm-calendar-day-tasks">{dayTasks.slice(0, 3).map(task => {
          const status = STATUSES.find(item => item.id === task.status) || STATUSES[0];
          return <button key={task.id} className={`tm-calendar-task ${task.status === 'done' ? 'tm-calendar-task-done' : ''}`} style={{ '--status-color': status.color, '--status-light': status.light }} title={task.title} onClick={() => onEdit(task)}><span className="tm-calendar-task-dot" /><span>{task.title}</span></button>;
        })}{dayTasks.length > 3 && <button className="tm-calendar-more" onClick={() => setActiveDay(key)}>+{dayTasks.length - 3} more</button>}</div>
      </div>;
    })}</div></div>
    {activeDay && <section className="tm-calendar-day-panel"><div className="tm-calendar-panel-heading"><h3>{displayDate(activeDay, true)}<span>{(grouped[activeDay] || []).length} tasks</span></h3><button className="tm-icon-button" aria-label="Close day details" onClick={() => setActiveDay(null)}><X size={16} /></button></div>{(grouped[activeDay] || []).length ? <div className="tm-calendar-panel-tasks">{grouped[activeDay].map(task => <button key={task.id} onClick={() => onEdit(task)}><StatusBadge status={task.status} showLabel={false} /><span>{task.title}</span><Priority value={task.priority} /></button>)}</div> : <p className="tm-calendar-no-tasks">Nothing scheduled. A little breathing room.</p>}{canEdit && <button className="tm-add-row" onClick={() => onCreate({ dueDate: activeDay })}><Plus size={15} />Add task for this day</button>}</section>}
    {!!unscheduled.length && <section className="tm-unscheduled"><div className="tm-unscheduled-title"><CalendarDays size={16} /><h3>Without a due date</h3><span>{unscheduled.length}</span></div><div className="tm-unscheduled-tasks">{unscheduled.map(task => <button key={task.id} onClick={() => onEdit(task)}><StatusBadge status={task.status} showLabel={false} /><span>{task.title}</span><ArrowUp size={13} style={{ transform: 'rotate(45deg)' }} /></button>)}</div></section>}
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
