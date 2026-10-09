import { useEffect, useRef, useState } from 'react';
import {
  AlignLeft, CalendarDays, Check, CheckSquare, ChevronDown, Circle,
  Flag, Link2, LoaderCircle, Plus, Trash2, UserRound, X,
} from 'lucide-react';
import MultiSelect from './MultiSelect';
import './editor.css';

const STATUS_OPTIONS = [
  { value: 'todo', label: 'To do', color: '#8893a5' },
  { value: 'in_progress', label: 'In progress', color: '#6c7ee8' },
  { value: 'review', label: 'In review', color: '#e6ad3b' },
  { value: 'scheduled', label: 'Scheduled', color: '#32a78b' },
  { value: 'done', label: 'Done', color: '#0e8778' },
];
const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];
const CONTENT_TYPES = ['Single Post', 'Photo album', 'Infographic', 'Video', 'Reel', 'Story', 'Blog', 'Other'];
const CHANNELS = ['Facebook', 'Instagram', 'TikTok', 'YouTube', 'LINE', 'Website', 'Other'];
const makeId = () => globalThis.crypto?.randomUUID?.() || `item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const uniqueValues = (values) => [...new Set(values.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean))];
const normalizeValues = (values, legacyValue) => uniqueValues(Array.isArray(values) ? values : legacyValue ? [legacyValue] : []);
const tagColor = (value, kind) => {
  const namedColors = { Facebook: '#3873cf', Instagram: '#bd658f', TikTok: '#556073', YouTube: '#d75d62', LINE: '#529866', Website: '#538bb1', Video: '#c5677d', VDO: '#c5677d', Infographic: '#408fac', 'Photo album': '#9162b9' };
  if (namedColors[value]) return namedColors[value];
  const palette = kind === 'channel' ? ['#477b9e', '#547c94', '#6176b1', '#508e8c'] : ['#8262ad', '#aa6a8e', '#6e80b8', '#978046'];
  const hash = Array.from(value).reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return palette[hash % palette.length];
};

function initialDraft(task, initialValues, project) {
  const values = task || initialValues || {};
  return {
    title: values.title || '',
    description: values.description || '',
    status: values.status || 'todo',
    priority: values.priority || 'normal',
    dueDate: values.dueDate?.slice(0, 10) || '',
    assigneeIds: normalizeValues(values.assigneeIds, values.assigneeId),
    contentTypes: normalizeValues(values.contentTypes, values.contentType),
    channels: normalizeValues(values.channels, values.channel),
    links: (values.links || []).map((link) => ({ ...link })),
    subtasks: (values.subtasks || []).map((item) => ({ ...item, id: item.id || makeId() })),
    customFields: { ...(values.customFields || {}) },
    projectId: project?.id || values.projectId,
  };
}

function safeUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function MetadataField({ icon: Icon, label, help, wide = false, children }) {
  return <div className={`tm-editor-meta-field ${wide ? 'tm-editor-meta-field-wide' : ''}`}>
    <div className="tm-editor-meta-label"><div><Icon size={15} aria-hidden="true" /><span>{label}</span></div>{help && <small>{help}</small>}</div>
    {children}
  </div>;
}

export function TaskEditor({ task, project, onSave, onDelete, onClose, canEdit = true, initialValues, existingTasks = [], onAddTag }) {
  const [draft, setDraft] = useState(() => initialDraft(task, initialValues, project));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [deletePrompt, setDeletePrompt] = useState(false);
  const [error, setError] = useState('');
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const noticeRef = useRef(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(false);
  const dirtyRef = useRef(false);
  const [closePrompt, setClosePrompt] = useState(false);
  const [dirty, setDirty] = useState(false);
  const isExisting = Boolean(task?.id);
  const readonly = !canEdit;
  const busy = saving || deleting || addingTag;
  const members = (project?.members || []).map((member) => member.user || member).filter((member) => member?.id);
  const completed = draft.subtasks.filter((item) => item.done).length;
  const currentStatus = STATUS_OPTIONS.find((status) => status.value === draft.status) || STATUS_OPTIONS[0];
  const contentCatalog = uniqueValues([
    ...(project?.contentTypeOptions?.length ? project.contentTypeOptions : CONTENT_TYPES),
    ...existingTasks.flatMap((item) => normalizeValues(item.contentTypes, item.contentType)),
    ...draft.contentTypes,
  ]).map((value) => ({ value, label: value, color: tagColor(value, 'contentType') }));
  const channelCatalog = uniqueValues([
    ...(project?.channelOptions?.length ? project.channelOptions : CHANNELS),
    ...existingTasks.flatMap((item) => normalizeValues(item.channels, item.channel)),
    ...draft.channels,
  ]).map((value) => ({ value, label: value, color: tagColor(value, 'channel') }));

  closeRef.current = onClose;
  busyRef.current = busy;
  dirtyRef.current = dirty;

  useEffect(() => {
    setDraft(initialDraft(task, initialValues, project));
    setError('');
    setDirty(false);
    setDeletePrompt(false);
    setClosePrompt(false);
    setSubtaskTitle('');
  }, [task?.id, project?.id]);

  useEffect(() => {
    if (!error && !deletePrompt && !closePrompt) return;
    noticeRef.current?.scrollIntoView({ block: 'nearest' });
    if (deletePrompt || closePrompt) noticeRef.current?.querySelector('button')?.focus();
  }, [error, deletePrompt, closePrompt]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => {
      const target = canEdit ? titleRef.current : dialogRef.current;
      target?.focus();
    }, 0);
    function handleKey(event) {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (busyRef.current) return;
        if (dirtyRef.current) { setDeletePrompt(false); setClosePrompt(true); }
        else closeRef.current?.();
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
      ) || []).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  function update(name, value) {
    setDraft((current) => ({ ...current, [name]: value }));
    setDirty(true);
    setError('');
  }

  function requestClose() {
    if (busy) return;
    if (dirty) { setDeletePrompt(false); setClosePrompt(true); }
    else onClose?.();
  }

  function updateLink(index, key, value) {
    update('links', draft.links.map((link, linkIndex) => linkIndex === index ? { ...link, [key]: value } : link));
  }

  function updateSubtask(id, patch) {
    update('subtasks', draft.subtasks.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  async function addTag(kind, value) {
    const updatedProject = await onAddTag(kind, value);
    const options = kind === 'channel' ? updatedProject?.channelOptions : updatedProject?.contentTypeOptions;
    const canonical = options?.find((option) => option.toLocaleLowerCase() === value.toLocaleLowerCase()) || value;
    return { value: canonical, label: canonical, color: tagColor(canonical, kind) };
  }

  function addSubtask() {
    const title = subtaskTitle.trim();
    if (!title) return;
    update('subtasks', [...draft.subtasks, { id: makeId(), title, done: false }]);
    setSubtaskTitle('');
  }

  async function saveTask(event) {
    event.preventDefault();
    if (readonly || busy) return;
    if (!draft.title.trim()) {
      setError('Give your task a name before saving.');
      titleRef.current?.focus();
      return;
    }
    if (draft.assigneeIds.length > 50 || draft.contentTypes.length > 20 || draft.channels.length > 20) {
      setError('เลือกผู้รับผิดชอบได้สูงสุด 50 คน และเลือกประเภทคอนเทนต์หรือช่องทางได้สูงสุดอย่างละ 20 รายการ');
      return;
    }
    const links = [];
    for (const link of draft.links) {
      if (!link.label?.trim() && !link.url?.trim()) continue;
      const url = safeUrl(link.url?.trim());
      if (!url) {
        setError('File links must start with https:// or http:// and contain a valid address.');
        return;
      }
      links.push({ label: link.label?.trim() || new URL(url).hostname.slice(0, 100), url });
    }
    const subtasks = subtaskTitle.trim() ? [...draft.subtasks, { id: makeId(), title: subtaskTitle.trim(), done: false }] : draft.subtasks;
    if (subtasks.some((item) => !item.title.trim())) {
      setError('Each checklist item needs a title. You can remove empty items.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onSave?.({
        title: draft.title.trim(),
        description: draft.description.trim(),
        status: draft.status,
        priority: draft.priority,
        dueDate: draft.dueDate || null,
        assigneeIds: uniqueValues(draft.assigneeIds),
        contentTypes: uniqueValues(draft.contentTypes),
        channels: uniqueValues(draft.channels),
        links,
        subtasks: subtasks.map((item) => ({ id: item.id, title: item.title.trim(), done: Boolean(item.done) })),
        customFields: draft.customFields,
      });
      setDirty(false);
      dirtyRef.current = false;
      onClose?.();
    } catch (saveError) {
      setError(saveError?.message || 'The task could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteTask() {
    if (!onDelete || readonly || busy) return;
    setError('');
    setDeleting(true);
    try {
      await onDelete(task);
      setDirty(false);
      dirtyRef.current = false;
      onClose?.();
    } catch (deleteError) {
      setError(deleteError?.message || 'The task could not be deleted. Please try again.');
      setDeletePrompt(false);
    } finally {
      setDeleting(false);
    }
  }

  return <div className="tm-editor-overlay" onMouseDown={(event) => {
    if (event.target === event.currentTarget) requestClose();
  }}>
    <section className="tm-editor-dialog" ref={dialogRef} role="dialog" aria-modal="true"
      aria-labelledby="tm-editor-heading" tabIndex={-1}>
      <div className="tm-editor-topbar">
        <div className="tm-editor-breadcrumb"><span className="tm-editor-project-dot" style={{ background: project?.color || 'var(--accent, #0e8778)' }} />
          <span>{project?.name || 'Project'}</span><span className="tm-editor-slash">/</span><span>{isExisting ? 'Task details' : 'New task'}</span>
        </div>
        <button type="button" className="tm-editor-icon-button" onClick={requestClose} disabled={busy} aria-label="Close task details"><X size={20} /></button>
      </div>
      <form onSubmit={saveTask} className="tm-editor-form">
        <div className="tm-editor-content">
          <div className="tm-editor-heading-row">
            <span className="tm-editor-status-kicker" style={{ '--tm-status-color': currentStatus.color }}><Circle size={13} />{currentStatus.label}</span>
            {readonly && <span className="tm-editor-readonly">View only</span>}
          </div>
          <h2 className="tm-editor-sr-only" id="tm-editor-heading">{isExisting ? 'Task details' : 'Create a task'}</h2>
          <label className="tm-editor-sr-only" htmlFor="tm-editor-title">Task name</label>
          <input id="tm-editor-title" ref={titleRef} className="tm-editor-title" placeholder="What needs to get done?"
            value={draft.title} onChange={(event) => update('title', event.target.value)} maxLength={250} disabled={readonly || busy} required />
          <p className="tm-editor-title-help">{isExisting ? 'Keep your team aligned, one task at a time.' : 'A little clarity goes a long way. Add the details below.'}</p>

          <div className="tm-editor-metadata">
            <MetadataField icon={Circle} label="Status"><div className="tm-editor-select-wrap"><select aria-label="Status" value={draft.status} onChange={(event) => update('status', event.target.value)} disabled={readonly || busy}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select><ChevronDown size={13} /></div></MetadataField>
            <MetadataField icon={Flag} label="Priority"><div className="tm-editor-select-wrap"><select aria-label="Priority" value={draft.priority} onChange={(event) => update('priority', event.target.value)} disabled={readonly || busy}>
              {PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select><ChevronDown size={13} /></div></MetadataField>
            <MetadataField icon={CalendarDays} label="Due date"><input type="date" aria-label="Due date" max="9999-12-31" value={draft.dueDate} onChange={(event) => update('dueDate', event.target.value)} disabled={readonly || busy} /></MetadataField>
            <MetadataField icon={UserRound} label="Assignees" help="ผู้รับผิดชอบ · เลือกได้หลายคน" wide>
              <MultiSelect label="Assignees" value={draft.assigneeIds} options={members.map((member) => ({ value: member.id, label: member.name, description: member.email, color: member.avatarColor }))}
                onChange={(values) => update('assigneeIds', values)} variant="assignee" placeholder="เลือกผู้รับผิดชอบ…" disabled={busy} readonly={readonly} maxSelected={50} />
            </MetadataField>
            <MetadataField icon={AlignLeft} label="Type Content" help="รูปแบบงาน · เลือกหลายประเภทได้" wide>
              <MultiSelect label="Type Content" value={draft.contentTypes} options={contentCatalog} onChange={(values) => update('contentTypes', values)}
                variant="type" placeholder="เลือกประเภทคอนเทนต์…" disabled={busy} readonly={readonly} onPendingChange={setAddingTag} maxSelected={20}
                onCreate={onAddTag && !readonly ? (value) => addTag('contentType', value) : undefined} />
            </MetadataField>
            <MetadataField icon={Link2} label="Channels" help="ช่องทางเผยแพร่ · เลือกได้หลายช่องทาง" wide>
              <MultiSelect label="Channels" value={draft.channels} options={channelCatalog} onChange={(values) => update('channels', values)}
                variant="channel" placeholder="เลือกช่องทางเผยแพร่…" disabled={busy} readonly={readonly} onPendingChange={setAddingTag} maxSelected={20}
                onCreate={onAddTag && !readonly ? (value) => addTag('channel', value) : undefined} />
            </MetadataField>
            {(project?.fields || []).map((field) => <MetadataField key={field.id} icon={AlignLeft} label={field.name}>
              {field.type === 'select' ? <div className="tm-editor-select-wrap"><select aria-label={field.name} value={draft.customFields[field.id] || ''}
                onChange={(event) => update('customFields', { ...draft.customFields, [field.id]: event.target.value })} disabled={readonly || busy}>
                <option value="">Not set</option>{(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
              </select><ChevronDown size={13} /></div> : <input aria-label={field.name} placeholder="Not set" value={draft.customFields[field.id] || ''}
                onChange={(event) => update('customFields', { ...draft.customFields, [field.id]: event.target.value })} disabled={readonly || busy} maxLength={2000} />}
            </MetadataField>)}
          </div>

          <div className="tm-editor-section">
            <label className="tm-editor-section-title" htmlFor="tm-editor-description"><AlignLeft size={17} />Description</label>
            <textarea id="tm-editor-description" className="tm-editor-description" placeholder="Add a brief, context, or anything your team should know…" value={draft.description}
              onChange={(event) => update('description', event.target.value)} rows={4} disabled={readonly || busy} maxLength={10000} />
          </div>

          <div className="tm-editor-section">
            <div className="tm-editor-section-heading"><h3 className="tm-editor-section-title"><CheckSquare size={17} />Checklist
              {draft.subtasks.length > 0 && <span className="tm-editor-counter">{completed}/{draft.subtasks.length}</span>}</h3></div>
            {draft.subtasks.length > 0 && <div className="tm-editor-progress-track"><div style={{ width: `${completed / draft.subtasks.length * 100}%` }} /></div>}
            <div className="tm-editor-checklist">
              {draft.subtasks.map((item, index) => <div className={`tm-editor-checklist-item ${item.done ? 'tm-editor-checklist-done' : ''}`} key={item.id}>
                <label className="tm-editor-checkbox"><input type="checkbox" checked={Boolean(item.done)} disabled={readonly || busy}
                  onChange={(event) => updateSubtask(item.id, { done: event.target.checked })} aria-label={`Complete checklist item ${index + 1}`} /><span><Check size={11} strokeWidth={3} /></span></label>
                <input className="tm-editor-checklist-text" aria-label={`Checklist item ${index + 1}`} value={item.title} disabled={readonly || busy}
                  onChange={(event) => updateSubtask(item.id, { title: event.target.value })} maxLength={300} />
                {!readonly && <button className="tm-editor-icon-button tm-editor-item-remove" type="button" disabled={busy} aria-label={`Remove checklist item ${index + 1}`}
                  onClick={() => update('subtasks', draft.subtasks.filter((subtask) => subtask.id !== item.id))}><X size={15} /></button>}
              </div>)}
              {!readonly && draft.subtasks.length < 100 && <div className="tm-editor-add-checklist"><Plus size={15} /><input aria-label="New checklist item" placeholder="Add a checklist item…" value={subtaskTitle} disabled={busy}
                onChange={(event) => { setSubtaskTitle(event.target.value); setDirty(true); }} maxLength={300} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addSubtask(); } }} />
                <button type="button" onClick={addSubtask} disabled={busy || !subtaskTitle.trim()}>Add</button></div>}
              {readonly && !draft.subtasks.length && <p className="tm-editor-empty">No checklist items yet.</p>}
            </div>
          </div>

          <div className="tm-editor-section tm-editor-links-section">
            <div className="tm-editor-section-heading"><h3 className="tm-editor-section-title"><Link2 size={17} />Files & links
              {draft.links.length > 0 && <span className="tm-editor-counter">{draft.links.length}</span>}</h3>
              {!readonly && <button className="tm-editor-text-button" type="button" disabled={busy || draft.links.length >= 30} onClick={() => update('links', [...draft.links, { label: '', url: '' }])}><Plus size={14} />Add link</button>}
            </div>
            {!draft.links.length && <div className="tm-editor-link-empty"><Link2 size={20} /><span>Keep references, Drive files, and designs in one place.</span></div>}
            {draft.links.map((link, index) => readonly ? <a className="tm-editor-read-link" key={index} href={safeUrl(link.url) || undefined} target="_blank" rel="noopener noreferrer"><Link2 size={15} />{link.label || link.url}</a> : <div className="tm-editor-link-row" key={index}>
              <div className="tm-editor-link-icon"><Link2 size={17} /></div><div className="tm-editor-link-inputs">
                <input aria-label={`Link ${index + 1} name`} placeholder="Link name, e.g. Design files" value={link.label || ''} onChange={(event) => updateLink(index, 'label', event.target.value)} maxLength={100} disabled={busy} />
                <input type="url" aria-label={`Link ${index + 1} URL`} placeholder="https://…" value={link.url || ''} onChange={(event) => updateLink(index, 'url', event.target.value)} maxLength={2000} disabled={busy} />
              </div><button className="tm-editor-icon-button" type="button" aria-label={`Remove link ${index + 1}`} disabled={busy} onClick={() => update('links', draft.links.filter((_, linkIndex) => linkIndex !== index))}><X size={16} /></button>
            </div>)}
          </div>

          {error && <div className="tm-editor-error" ref={noticeRef} role="alert">{error}</div>}
          {deletePrompt && <div className="tm-editor-confirm" ref={noticeRef} role="alert"><div><strong>Delete this task?</strong><p>The task and its checklist will be permanently removed.</p></div>
            <div className="tm-editor-confirm-actions"><button type="button" className="tm-editor-secondary-button" disabled={busy} onClick={() => setDeletePrompt(false)}>Keep task</button>
              <button type="button" className="tm-editor-danger-button" disabled={busy} onClick={deleteTask}>{deleting && <LoaderCircle className="tm-editor-spin" size={15} />}Delete task</button></div></div>}
          {closePrompt && <div className="tm-editor-confirm" ref={noticeRef} role="alert"><div><strong>Leave without saving?</strong><p>Your changes to this task will be discarded.</p></div>
            <div className="tm-editor-confirm-actions"><button type="button" className="tm-editor-secondary-button" onClick={() => setClosePrompt(false)}>Keep editing</button>
              <button type="button" className="tm-editor-danger-button" onClick={onClose}>Discard changes</button></div></div>}
        </div>

        <footer className="tm-editor-footer">
          <div>{isExisting && !readonly && onDelete && <button type="button" className="tm-editor-delete-button" onClick={() => { setDeletePrompt(true); setClosePrompt(false); }} disabled={busy}><Trash2 size={16} /><span>Delete task</span></button>}</div>
          <div className="tm-editor-footer-actions"><button type="button" className="tm-editor-secondary-button" onClick={requestClose} disabled={busy}>{readonly ? 'Close' : 'Cancel'}</button>
            {!readonly && <button className="tm-editor-primary-button" type="submit" disabled={busy}>{saving ? <LoaderCircle className="tm-editor-spin" size={16} /> : <Check size={16} />}{saving ? 'Saving…' : isExisting ? 'Save changes' : 'Create task'}</button>}</div>
        </footer>
      </form>
    </section>
  </div>;
}

export default TaskEditor;
