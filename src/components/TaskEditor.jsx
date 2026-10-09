import { useEffect, useRef, useState } from 'react';
import {
  AlignLeft, CalendarDays, Check, CheckCircle2, CheckSquare, ChevronDown, Circle,
  Flag, Link2, ListTodo, LoaderCircle, MessageSquare, Plus, Trash2, UserRound, X,
} from 'lucide-react';
import MultiSelect from './MultiSelect';
import TaskComments from './TaskComments';
import { getTagAppearance } from '../tagAppearance';
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
const CONTENT_TYPES = ['Video', 'Photo album', 'Infographic', 'Single Post', 'Reel', 'Story', 'ขายของ', 'Blog', 'Other'];
const CHANNELS = ['Facebook', 'Instagram', 'TikTok', 'YouTube', 'LINE', 'Website', 'Other'];
const CONTENT_HELP = { Video: 'วิดีโอ', VDO: 'วิดีโอ', 'Photo album': 'ชุดภาพ / อัลบั้ม', Infographic: 'ภาพสรุปข้อมูล', 'Single Post': 'ภาพเดี่ยว', Reel: 'วิดีโอสั้น', Story: 'สตอรี', 'ขายของ': 'โปรโมตสินค้า', Blog: 'บทความ', Other: 'รูปแบบอื่น ๆ' };
const CHANNEL_HELP = { Facebook: 'เพจและฟีด', Instagram: 'โพสต์ / รีล / สตอรี', TikTok: 'วิดีโอและไลฟ์', YouTube: 'วิดีโอและ Shorts', LINE: 'LINE OA', Website: 'เว็บไซต์ของทีม', Other: 'ช่องทางอื่น ๆ' };
const makeId = () => globalThis.crypto?.randomUUID?.() || `item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const uniqueValues = (values) => [...new Set(values.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean))];
const normalizeValues = (values, legacyValue) => uniqueValues(Array.isArray(values) ? values : legacyValue ? [legacyValue] : []);
const tagColor = (value, kind) => getTagAppearance(value, kind).color;

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

export function TaskEditor({ task, project, user, onSave, onDelete, onClose, canEdit = true, initialValues, existingTasks = [], onAddTag, initialTab = 'details', initialCommentId, onCommentsChange, onCommentPosted }) {
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
  const [activeTab, setActiveTab] = useState(initialTab === 'comments' ? 'comments' : 'details');
  const [commentsCount, setCommentsCount] = useState(task?.commentsCount || 0);
  const [commentDirty, setCommentDirty] = useState(false);
  const [commentPending, setCommentPending] = useState(false);
  const [pendingCloseAction, setPendingCloseAction] = useState('close');
  const commentDirtyRef = useRef(false);
  const tabsRef = useRef(null);
  const isExisting = Boolean(task?.id);
  const readonly = !canEdit;
  const discussionOnly = isExisting && activeTab === 'comments';
  const busy = saving || deleting || addingTag || commentPending;
  const hasUnsavedChanges = dirty || commentDirty;
  const members = (project?.members || []).map((member) => member.user || member).filter((member) => member?.id);
  const completed = draft.subtasks.filter((item) => item.done).length;
  const currentStatus = STATUS_OPTIONS.find((status) => status.value === draft.status) || STATUS_OPTIONS[0];
  const contentCatalog = uniqueValues([
    ...CONTENT_TYPES,
    ...(project?.contentTypeOptions || []),
    ...existingTasks.flatMap((item) => normalizeValues(item.contentTypes, item.contentType)),
    ...draft.contentTypes,
  ]).map((value) => ({ value, label: value, color: tagColor(value, 'contentType'), description: CONTENT_HELP[value] }));
  const channelCatalog = uniqueValues([
    ...CHANNELS,
    ...(project?.channelOptions || []),
    ...existingTasks.flatMap((item) => normalizeValues(item.channels, item.channel)),
    ...draft.channels,
  ]).map((value) => ({ value, label: value, color: tagColor(value, 'channel'), description: CHANNEL_HELP[value] }));

  closeRef.current = onClose;
  busyRef.current = busy;
  dirtyRef.current = hasUnsavedChanges;
  commentDirtyRef.current = commentDirty;

  useEffect(() => {
    setDraft(initialDraft(task, initialValues, project));
    setError('');
    setDirty(false);
    setDeletePrompt(false);
    setClosePrompt(false);
    setSubtaskTitle('');
    setCommentDirty(false);
    setCommentPending(false);
    setCommentsCount(task?.commentsCount || 0);
    setPendingCloseAction('close');
  }, [task?.id, project?.id]);

  useEffect(() => { setActiveTab(initialTab === 'comments' ? 'comments' : 'details'); }, [task?.id, initialTab, initialCommentId]);
  useEffect(() => { setCommentsCount(task?.commentsCount || 0); }, [task?.commentsCount]);

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
      const target = canEdit && initialTab !== 'comments' ? titleRef.current : dialogRef.current;
      target?.focus();
    }, 0);
    function handleKey(event) {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (busyRef.current) return;
        if (dirtyRef.current) { setDeletePrompt(false); setPendingCloseAction('close'); setClosePrompt(true); }
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
    if (hasUnsavedChanges) { setDeletePrompt(false); setPendingCloseAction('close'); setClosePrompt(true); }
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

  async function saveTask(event, discardComments = false) {
    event?.preventDefault();
    if (readonly || busy) return;
    if (commentDirtyRef.current && !discardComments) {
      setActiveTab('comments'); setPendingCloseAction('save'); setDeletePrompt(false); setClosePrompt(true); return;
    }
    if (!draft.title.trim()) {
      setError('ใส่ชื่องานก่อนบันทึก');
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
        setError('ใส่ลิงก์ไฟล์ให้ครบ โดยเริ่มด้วย https:// หรือ http://');
        return;
      }
      links.push({ label: link.label?.trim() || new URL(url).hostname.slice(0, 100), url });
    }
    const subtasks = subtaskTitle.trim() ? [...draft.subtasks, { id: makeId(), title: subtaskTitle.trim(), done: false }] : draft.subtasks;
    if (subtasks.some((item) => !item.title.trim())) {
      setError('ใส่ชื่อรายการงานย่อยให้ครบ หรือลบรายการที่ไม่ได้ใช้');
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
      setError(saveError?.message || 'บันทึกงานไม่สำเร็จ กรุณาลองอีกครั้ง');
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
      setError(deleteError?.message || 'ลบงานไม่สำเร็จ กรุณาลองอีกครั้ง');
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
          <span>{project?.name || 'โปรเจกต์'}</span><span className="tm-editor-slash">/</span><span>{isExisting ? 'รายละเอียดงาน' : 'สร้างงานใหม่'}</span>
        </div>
        <button type="button" className="tm-editor-icon-button" onClick={requestClose} disabled={busy} aria-label="Close task details"><X size={20} /></button>
      </div>
      <form onSubmit={saveTask} className="tm-editor-form">
        <div className="tm-editor-content">
          <div className="tm-editor-heading-row">
            <span className="tm-editor-status-kicker" style={{ '--tm-status-color': currentStatus.color }}><Circle size={13} />{currentStatus.label}</span>
            {readonly && <span className="tm-editor-readonly">ดูได้อย่างเดียว</span>}
          </div>
          <h2 className="tm-editor-sr-only" id="tm-editor-heading">{isExisting ? 'Task details' : 'Create a task'}</h2>
          <label className="tm-editor-sr-only" htmlFor="tm-editor-title">Task name</label>
          <input id="tm-editor-title" ref={titleRef} className="tm-editor-title" placeholder="ตั้งชื่องาน เช่น ทำวิดีโอเปิดตัวสินค้า"
            value={draft.title} onChange={(event) => update('title', event.target.value)} maxLength={250} disabled={readonly || busy} required />
          <p className="tm-editor-title-help">{activeTab === 'comments' ? readonly ? 'ความคิดเห็นและแคปชั่นที่ทีมเก็บไว้กับงานนี้' : 'เพิ่มแคปชั่น ขอแก้ไข และแท็กสมาชิกด้วย @ เพื่อแจ้งเตือนในเว็บ' : readonly ? 'รายละเอียดและแผนเผยแพร่ของงานนี้' : 'เลือกสถานะ ผู้รับผิดชอบ และแผนเผยแพร่ได้ในหน้านี้ แล้วกดบันทึกด้านล่าง'}</p>

          <div className="tm-editor-tabs" ref={tabsRef} role="tablist" aria-label="ส่วนของงาน" onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 'details' : event.key === 'End' ? 'comments' : activeTab === 'details' ? 'comments' : 'details';
            setActiveTab(next); tabsRef.current?.querySelector(`[data-editor-tab="${next}"]`)?.focus();
          }}>
            <button type="button" role="tab" aria-label="รายละเอียดงาน" aria-selected={activeTab === 'details'} aria-controls="tm-task-details-panel" id="tm-task-details-tab" data-editor-tab="details" tabIndex={activeTab === 'details' ? 0 : -1} onClick={() => setActiveTab('details')} disabled={busy}><ListTodo size={17} />รายละเอียดงาน</button>
            <button type="button" role="tab" aria-label="ความคิดเห็น" aria-selected={activeTab === 'comments'} aria-controls="tm-task-comments-panel" id="tm-task-comments-tab" data-editor-tab="comments" tabIndex={activeTab === 'comments' ? 0 : -1} onClick={() => setActiveTab('comments')} disabled={busy}><MessageSquare size={17} />ความคิดเห็น<span>{commentsCount}</span>{commentDirty && <span className="tm-editor-comment-draft-indicator" aria-label="มีข้อความที่ยังไม่ได้ส่ง" />}</button>
          </div>

          <div className="tm-editor-details" role="tabpanel" aria-label="รายละเอียดงาน" id="tm-task-details-panel" aria-labelledby="tm-task-details-tab" hidden={activeTab !== 'details'}>

          <div className="tm-editor-metadata">
            <MetadataField icon={Circle} label="สถานะงาน"><div className="tm-editor-select-wrap"><select aria-label="Status" value={draft.status} onChange={(event) => update('status', event.target.value)} disabled={readonly || busy}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select><ChevronDown size={13} /></div></MetadataField>
            <MetadataField icon={Flag} label="ความสำคัญ"><div className="tm-editor-select-wrap"><select aria-label="Priority" value={draft.priority} onChange={(event) => update('priority', event.target.value)} disabled={readonly || busy}>
              {PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select><ChevronDown size={13} /></div></MetadataField>
            <MetadataField icon={CalendarDays} label="กำหนดส่ง"><input type="date" aria-label="Due date" max="9999-12-31" value={draft.dueDate} onChange={(event) => update('dueDate', event.target.value)} disabled={readonly || busy} /></MetadataField>
            <MetadataField icon={UserRound} label="ผู้รับผิดชอบ" help="เลือกได้หลายคน สมาชิกจะได้รับแจ้งเตือนเมื่อมอบหมายงาน" wide>
              <MultiSelect label="Assignees" value={draft.assigneeIds} options={members.map((member) => ({ value: member.id, label: member.name, description: member.email, color: member.avatarColor }))}
                onChange={(values) => update('assigneeIds', values)} variant="assignee" placeholder="เลือกผู้รับผิดชอบ…" disabled={busy} readonly={readonly} maxSelected={50} />
            </MetadataField>
            {(project?.fields || []).map((field) => <MetadataField key={field.id} icon={AlignLeft} label={field.name}>
              {field.type === 'select' ? <div className="tm-editor-select-wrap"><select aria-label={field.name} value={draft.customFields[field.id] || ''}
                onChange={(event) => update('customFields', { ...draft.customFields, [field.id]: event.target.value })} disabled={readonly || busy}>
                <option value="">ยังไม่ระบุ</option>{(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
              </select><ChevronDown size={13} /></div> : <input aria-label={field.name} placeholder="ยังไม่ระบุ" value={draft.customFields[field.id] || ''}
                onChange={(event) => update('customFields', { ...draft.customFields, [field.id]: event.target.value })} disabled={readonly || busy} maxLength={2000} />}
            </MetadataField>)}
          </div>

          <section className="tm-editor-publishing-plan" aria-label="แผนคอนเทนต์และช่องทางเผยแพร่">
            <div className="tm-editor-plan-heading"><div><h3>แผนคอนเทนต์และการโพสต์</h3><p>เลือกว่าต้องทำอะไร และจะนำไปโพสต์ที่ไหน · เลือกได้หลายรายการ</p></div><span>{draft.contentTypes.length} รูปแบบ <span>·</span> {draft.channels.length} ช่องทาง</span></div>
            <div className="tm-editor-plan-grid">
              <MultiSelect label="Type Content" title="ประเภทคอนเทนต์" description="งานนี้ต้องทำคอนเทนต์แบบไหน" display="inline" value={draft.contentTypes} options={contentCatalog} onChange={(values) => update('contentTypes', values)}
                variant="type" disabled={busy} readonly={readonly} onPendingChange={setAddingTag} maxSelected={20}
                onCreate={onAddTag && !readonly ? (value) => addTag('contentType', value) : undefined} />
              <MultiSelect label="Channels" title="ช่องทางโพสต์" description="ต้องโพสต์ที่ไหนบ้าง" display="inline" value={draft.channels} options={channelCatalog} onChange={(values) => update('channels', values)}
                variant="channel" disabled={busy} readonly={readonly} onPendingChange={setAddingTag} maxSelected={20}
                onCreate={onAddTag && !readonly ? (value) => addTag('channel', value) : undefined} />
            </div>
          </section>

          <div className="tm-editor-section">
            <label className="tm-editor-section-title" htmlFor="tm-editor-description"><AlignLeft size={17} />รายละเอียดและบรีฟงาน</label>
            <textarea id="tm-editor-description" aria-label="Description" className="tm-editor-description" placeholder="ใส่บรีฟ แนวคิด หรือรายละเอียดที่ทีมต้องรู้…" value={draft.description}
              onChange={(event) => update('description', event.target.value)} rows={4} disabled={readonly || busy} maxLength={10000} />
          </div>

          <div className="tm-editor-section">
            <div className="tm-editor-section-heading"><h3 className="tm-editor-section-title"><CheckSquare size={17} />งานย่อย / Checklist
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
              {!readonly && draft.subtasks.length < 100 && <div className="tm-editor-add-checklist"><Plus size={15} /><input aria-label="New checklist item" placeholder="เพิ่มสิ่งที่ต้องทำในงานนี้…" value={subtaskTitle} disabled={busy}
                onChange={(event) => { setSubtaskTitle(event.target.value); setDirty(true); }} maxLength={300} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addSubtask(); } }} />
                <button type="button" aria-label="Add" onClick={addSubtask} disabled={busy || !subtaskTitle.trim()}>เพิ่ม</button></div>}
              {readonly && !draft.subtasks.length && <p className="tm-editor-empty">ยังไม่มีงานย่อย</p>}
            </div>
          </div>

          <div className="tm-editor-section tm-editor-links-section">
            <div className="tm-editor-section-heading"><h3 className="tm-editor-section-title"><Link2 size={17} />ไฟล์และลิงก์แนบ
              {draft.links.length > 0 && <span className="tm-editor-counter">{draft.links.length}</span>}</h3>
              {!readonly && <button className="tm-editor-text-button" type="button" aria-label="Add link" disabled={busy || draft.links.length >= 30} onClick={() => update('links', [...draft.links, { label: '', url: '' }])}><Plus size={14} />เพิ่มลิงก์</button>}
            </div>
            {!draft.links.length && <div className="tm-editor-link-empty"><Link2 size={20} /><span>แนบ Google Drive, ไฟล์ออกแบบ หรือแหล่งอ้างอิงไว้กับงานนี้</span></div>}
            {draft.links.map((link, index) => readonly ? <a className="tm-editor-read-link" key={index} href={safeUrl(link.url) || undefined} target="_blank" rel="noopener noreferrer"><Link2 size={15} />{link.label || link.url}</a> : <div className="tm-editor-link-row" key={index}>
              <div className="tm-editor-link-icon"><Link2 size={17} /></div><div className="tm-editor-link-inputs">
                <input aria-label={`Link ${index + 1} name`} placeholder="ชื่อลิงก์ เช่น ไฟล์ออกแบบ" value={link.label || ''} onChange={(event) => updateLink(index, 'label', event.target.value)} maxLength={100} disabled={busy} />
                <input type="url" aria-label={`Link ${index + 1} URL`} placeholder="https://…" value={link.url || ''} onChange={(event) => updateLink(index, 'url', event.target.value)} maxLength={2000} disabled={busy} />
              </div><button className="tm-editor-icon-button" type="button" aria-label={`Remove link ${index + 1}`} disabled={busy} onClick={() => update('links', draft.links.filter((_, linkIndex) => linkIndex !== index))}><X size={16} /></button>
            </div>)}
          </div>

          </div>

          <div className="tm-editor-discussion" role="tabpanel" aria-label="ความคิดเห็น" id="tm-task-comments-panel" aria-labelledby="tm-task-comments-tab" hidden={activeTab !== 'comments'}>
            <TaskComments task={task} project={project} user={user} canWrite={!readonly} active={activeTab === 'comments'} initialCommentId={initialCommentId}
              onCountChange={(taskId, count) => { setCommentsCount(count); onCommentsChange?.(taskId, count); }} onPosted={onCommentPosted} onDraftChange={setCommentDirty} onPendingChange={setCommentPending} />
          </div>

          {error && <div className="tm-editor-error" ref={noticeRef} role="alert">{error}</div>}
          {deletePrompt && <div className="tm-editor-confirm" ref={noticeRef} role="alert"><div><strong>ต้องการลบงานนี้หรือไม่?</strong><p>งาน รายการงานย่อย และความคิดเห็นของงานนี้จะถูกลบถาวร</p></div>
            <div className="tm-editor-confirm-actions"><button type="button" aria-label="Keep task" className="tm-editor-secondary-button" disabled={busy} onClick={() => setDeletePrompt(false)}>เก็บงานไว้</button>
              <button type="button" aria-label="Delete task" className="tm-editor-danger-button" disabled={busy} onClick={deleteTask}>{deleting && <LoaderCircle className="tm-editor-spin" size={15} />}ลบงาน</button></div></div>}
          {closePrompt && <div className="tm-editor-confirm" ref={noticeRef} role="alert"><div><strong>{commentDirty ? 'ยังมีข้อความที่ยังไม่ได้ส่ง' : 'ยังไม่ได้บันทึกการเปลี่ยนแปลง'}</strong><p>{commentDirty ? 'ส่งหรือบันทึกความคิดเห็นก่อนออก เพื่อเก็บข้อความไว้กับงานนี้' : 'บันทึกก่อนออก หรือยกเลิกสิ่งที่แก้ไขในงานนี้'}</p></div>
            <div className="tm-editor-confirm-actions"><button type="button" aria-label="Keep editing" className="tm-editor-secondary-button" onClick={() => setClosePrompt(false)}>แก้ไขต่อ</button>
              <button type="button" aria-label="Discard changes" className="tm-editor-danger-button" onClick={() => { if (pendingCloseAction === 'save') { setClosePrompt(false); commentDirtyRef.current = false; saveTask(null, true); } else onClose?.(); }}>{pendingCloseAction === 'save' ? 'บันทึกงานและทิ้งร่างข้อความ' : 'ไม่บันทึกและออก'}</button></div></div>}
        </div>

        <footer className="tm-editor-footer">
          <div className="tm-editor-footer-leading">{!readonly && <span className={`tm-editor-save-state ${hasUnsavedChanges ? 'tm-editor-save-state-dirty' : ''}`} role="status">{hasUnsavedChanges ? <span className="tm-editor-unsaved-dot" /> : <CheckCircle2 size={16} />}{saving ? 'กำลังบันทึก…' : commentDirty ? 'มีข้อความที่ยังไม่ได้ส่ง' : dirty ? 'มีการแก้ไขที่ยังไม่บันทึก' : isExisting ? 'ข้อมูลปัจจุบัน' : 'พร้อมสร้างงานใหม่'}</span>}
            {isExisting && !readonly && onDelete && <button type="button" aria-label="Delete task" className="tm-editor-delete-button" onClick={() => { setDeletePrompt(true); setClosePrompt(false); }} disabled={busy}><Trash2 size={16} /><span>ลบงาน</span></button>}</div>
          <div className="tm-editor-footer-actions"><button type="button" aria-label={readonly || discussionOnly ? 'Close' : 'Cancel'} className="tm-editor-secondary-button" onClick={requestClose} disabled={busy}>{readonly || discussionOnly ? 'ปิด' : 'ยกเลิก'}</button>
            {!readonly && (!discussionOnly || dirty) && <button className="tm-editor-primary-button" aria-label={saving ? 'Saving…' : isExisting ? 'Save changes' : 'Create task'} type="submit" disabled={busy}>{saving ? <LoaderCircle className="tm-editor-spin" size={17} /> : <Check size={17} />}{saving ? 'กำลังบันทึก…' : isExisting ? discussionOnly ? 'บันทึกรายละเอียดงาน' : 'บันทึกการเปลี่ยนแปลง' : 'สร้างงาน'}</button>}</div>
        </footer>
      </form>
    </section>
  </div>;
}

export default TaskEditor;
