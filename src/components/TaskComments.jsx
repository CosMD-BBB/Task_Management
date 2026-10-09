import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AtSign, Check, ChevronDown, FileText, LoaderCircle, MessageSquare, Pencil, RefreshCw, Send, Trash2, X } from 'lucide-react';
import { api } from '../api';
import './task-comments.css';

const MESSAGE_KINDS = [
  { value: 'comment', label: 'ความคิดเห็น', help: 'พูดคุยและอัปเดตงานกับทีม' },
  { value: 'caption', label: 'แคปชั่น', help: 'เก็บข้อความที่จะใช้โพสต์ไว้กับงานนี้' },
  { value: 'revision', label: 'ขอแก้ไข', help: 'บอกสิ่งที่ต้องแก้ และแท็กคนที่รับผิดชอบ' },
];
const emptyDraft = () => ({ body: '', kind: 'comment', mentions: [] });
const initials = (name = '') => name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase() || '?';
const draftSignature = draft => JSON.stringify({ body: draft.body, kind: draft.kind, mentions: draft.mentions });

function avatarStyle(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color || '')) return { '--comment-avatar': 'var(--accent)', '--comment-avatar-ink': 'var(--accent-contrast)' };
  const channels = color.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  const luminance = channels.reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  return { '--comment-avatar': color, '--comment-avatar-ink': 1.05 / (luminance + .05) >= 4.5 ? '#FFFFFF' : '#000000' };
}

function activeMembers(project) {
  const unique = new Map();
  for (const member of project?.members || []) {
    const person = member.user || member;
    if (person?.id && !person.disabled && person.emailVerified !== false) unique.set(person.id, person);
  }
  return [...unique.values()];
}

// A normal text edit either shifts intact mentions or removes a touched range.
// JavaScript string indices are UTF-16, matching textarea selections and the API.
function adjustMentions(previous, next, mentions) {
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start += 1;
  let suffix = 0;
  while (suffix < previous.length - start && suffix < next.length - start && previous[previous.length - suffix - 1] === next[next.length - suffix - 1]) suffix += 1;
  const end = previous.length - suffix;
  const difference = next.length - previous.length;
  return mentions.flatMap(mention => {
    const adjusted = mention.end <= start ? mention : mention.start >= end ? { ...mention, start: mention.start + difference, end: mention.end + difference } : null;
    return adjusted && next.slice(adjusted.start, adjusted.end) === `@${adjusted.name}` ? [adjusted] : [];
  });
}

function mentionQuery(body, caret, mentions) {
  const before = body.slice(0, caret);
  const start = before.lastIndexOf('@');
  if (start < 0 || (start > 0 && !/[\s([{]/.test(before[start - 1]))) return null;
  if (mentions.some(mention => start >= mention.start && start < mention.end)) return null;
  const query = before.slice(start + 1);
  if (query.length > 100 || /[\n\r@]/.test(query)) return null;
  return { start, end: caret, query };
}

function readableDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function MessageBody({ body, mentions = [] }) {
  const pieces = [];
  let cursor = 0;
  for (const mention of [...mentions].sort((a, b) => a.start - b.start)) {
    if (!Number.isInteger(mention.start) || !Number.isInteger(mention.end) || mention.start < cursor || mention.end > body.length || mention.end <= mention.start) continue;
    pieces.push(body.slice(cursor, mention.start));
    pieces.push(<span className="tm-comment-mention" key={`${mention.userId}-${mention.start}`} title={mention.name}>{body.slice(mention.start, mention.end)}</span>);
    cursor = mention.end;
  }
  pieces.push(body.slice(cursor));
  return <div className="tm-comment-body">{pieces}</div>;
}

function MessageComposer({ draft, onChange, members, user, editing = false, busy = false, active = false, submitLabel, canSubmit = true, onSubmit, onCancel }) {
  const id = useId();
  const inputRef = useRef(null);
  const [caret, setCaret] = useState(draft.body.length);
  const [optionIndex, setOptionIndex] = useState(0);
  const [dismissed, setDismissed] = useState(null);
  const [focused, setFocused] = useState(false);
  const query = mentionQuery(draft.body, caret, draft.mentions);
  const dropdownOpen = Boolean(focused && query && dismissed !== `${query.start}:${query.query}` && !busy);
  const matches = query ? members.filter(member => `${member.name} ${member.email}`.toLocaleLowerCase().includes(query.query.toLocaleLowerCase())).slice(0, 12) : [];
  const selectedIndex = Math.min(optionIndex, Math.max(0, matches.length - 1));
  const kind = MESSAGE_KINDS.find(option => option.value === draft.kind) || MESSAGE_KINDS[0];
  const selectedMembers = [...new Map(draft.mentions.map(mention => [mention.userId, mention])).values()];

  useEffect(() => {
    if (active && editing && inputRef.current) inputRef.current.focus({ preventScroll: true });
  }, [editing]);

  function changeText(event) {
    const body = event.target.value;
    onChange({ ...draft, body, mentions: adjustMentions(draft.body, body, draft.mentions) });
    setCaret(event.target.selectionStart);
    setOptionIndex(0);
    setDismissed(null);
  }

  function chooseMember(member) {
    if (!query || busy) return;
    const token = `@${member.name}`;
    const replacement = `${token} `;
    const body = draft.body.slice(0, query.start) + replacement + draft.body.slice(query.end);
    if (body.length > 10000 || draft.mentions.length >= 20) return;
    const remaining = adjustMentions(draft.body, body, draft.mentions);
    const mentions = [...remaining, { userId: member.id, name: member.name, start: query.start, end: query.start + token.length }].sort((a, b) => a.start - b.start);
    onChange({ ...draft, body, mentions });
    const nextCaret = query.start + replacement.length;
    setCaret(nextCaret);
    setDismissed(`${query.start}:${member.name}`);
    window.requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(nextCaret, nextCaret); });
  }

  function handleKey(event) {
    if (dropdownOpen && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); setDismissed(`${query.start}:${query.query}`); return;
    }
    if (dropdownOpen && matches.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault(); setOptionIndex((selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length); return;
    }
    if (dropdownOpen && matches.length && event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation(); chooseMember(matches[selectedIndex]); return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault(); event.stopPropagation(); if (draft.body.trim() && !busy && canSubmit) onSubmit();
    }
  }

  return <div className={`tm-comment-composer ${editing ? 'tm-comment-composer-editing' : ''}`}>
    <div className="tm-comment-composer-heading"><span className="tm-comment-avatar" style={avatarStyle(user?.avatarColor)}>{initials(user?.name)}</span><div><strong>{editing ? 'แก้ไขข้อความของคุณ' : 'เพิ่มข้อความให้ทีม'}</strong><span>{kind.help}</span></div></div>
    <div className="tm-comment-kind-select"><label htmlFor={`${id}-kind`}>ประเภทข้อความ</label><div><select id={`${id}-kind`} aria-label={editing ? 'ประเภทข้อความที่แก้ไข' : 'ประเภทข้อความ'} value={draft.kind} disabled={busy} onChange={event => onChange({ ...draft, kind: event.target.value })}>
      {MESSAGE_KINDS.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
    </select><ChevronDown size={15} /></div></div>
    <div className="tm-comment-textarea-wrap">
      <textarea ref={inputRef} aria-label={editing ? 'แก้ไขข้อความ' : 'เขียนความคิดเห็น'} placeholder={draft.kind === 'caption' ? 'เขียนแคปชั่นที่จะใช้โพสต์…' : draft.kind === 'revision' ? 'อธิบายสิ่งที่ต้องแก้ และพิมพ์ @ เพื่อแท็กผู้รับผิดชอบ…' : 'อัปเดตงานหรือถามทีม พิมพ์ @ เพื่อแท็กสมาชิก…'} value={draft.body} maxLength={10000} rows={4} disabled={busy}
        aria-expanded={dropdownOpen} aria-controls={dropdownOpen ? `${id}-members` : undefined} aria-autocomplete="list" aria-activedescendant={dropdownOpen && matches.length ? `${id}-member-${selectedIndex}` : undefined}
        onChange={changeText} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onSelect={event => setCaret(event.target.selectionStart)} onKeyDown={handleKey} />
      {dropdownOpen && <div className="tm-comment-mention-menu" role="listbox" id={`${id}-members`} aria-label="สมาชิกที่แท็กได้"><div className="tm-comment-mention-menu-heading"><AtSign size={15} /><span>{draft.mentions.length >= 20 ? 'แท็กได้สูงสุด 20 ครั้งต่อข้อความ นำบางแท็กออกเพื่อเพิ่ม' : 'เลือกสมาชิกที่ต้องการแจ้งเตือน'}</span></div>
        {matches.map((member, index) => <button type="button" role="option" tabIndex={-1} id={`${id}-member-${index}`} aria-label={`${member.name} (${member.email})`} aria-selected={selectedIndex === index} className={selectedIndex === index ? 'is-selected' : ''} key={member.id} disabled={draft.mentions.length >= 20} onMouseDown={event => event.preventDefault()} onClick={() => chooseMember(member)}>
          <span className="tm-comment-avatar" style={avatarStyle(member.avatarColor)}>{initials(member.name)}</span><span><strong>{member.name}</strong><small>{member.email}</small></span>{selectedIndex === index && <Check size={15} />}
        </button>)}
        {!matches.length && <p>ไม่พบสมาชิกที่ตรงกับชื่อ ลองค้นหาด้วยชื่อหรืออีเมล</p>}
      </div>}
    </div>
    {selectedMembers.length > 0 && <div className="tm-comment-selected-mentions" aria-label="สมาชิกที่จะได้รับแจ้งเตือน"><span><AtSign size={13} />แจ้งเตือน</span>{selectedMembers.map(mention => <span className="tm-comment-selected-person" key={mention.userId}>@{mention.name}<button type="button" aria-label={`เอาแท็ก ${mention.name} ออก`} disabled={busy} onClick={() => onChange({ ...draft, mentions: draft.mentions.filter(item => item.userId !== mention.userId) })}><X size={13} /></button></span>)}</div>}
    <div className="tm-comment-composer-footer"><small>พิมพ์ @ เพื่อแท็กสมาชิก · ขึ้นบรรทัดใหม่ได้<span>{draft.body.length.toLocaleString()} / 10,000</span></small><div>
      {editing && <button type="button" className="tm-comment-secondary" onClick={onCancel} disabled={busy}>ยกเลิกการแก้ไข</button>}
      <button type="button" className="tm-comment-submit" onClick={onSubmit} disabled={busy || !canSubmit || !draft.body.trim()}>{busy ? <LoaderCircle className="tm-comment-spin" size={16} /> : editing ? <Check size={16} /> : <Send size={16} />}{submitLabel || (editing ? 'บันทึกความคิดเห็น' : 'ส่งความคิดเห็น')}</button>
    </div></div>
  </div>;
}

export default function TaskComments({ task, project, user, canWrite = true, active = true, initialCommentId, onCountChange, onPosted, onDraftChange, onPendingChange }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(Boolean(task?.id));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState(emptyDraft);
  const [editing, setEditing] = useState(null);
  const [cancelEditPrompt, setCancelEditPrompt] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [highlightId, setHighlightId] = useState(initialCommentId || null);
  const commentsRef = useRef([]);
  const requestVersion = useRef(0);
  const mountedRef = useRef(true);
  const taskIdRef = useRef(task?.id);
  const callbacks = useRef({ onCountChange, onPosted, onDraftChange, onPendingChange });
  const commentNodes = useRef(new Map());
  callbacks.current = { onCountChange, onPosted, onDraftChange, onPendingChange };
  taskIdRef.current = task?.id;
  const members = useMemo(() => activeMembers(project), [project]);
  const deletedEdit = Boolean(editing && !loading && !comments.some(comment => comment.id === editing.id));
  const dirty = Boolean(draft.body.length || draft.mentions.length || (editing && (draftSignature(editing.draft) !== editing.originalSignature || (deletedEdit && editing.draft.body.length))));

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; requestVersion.current += 1; }; }, []);
  useEffect(() => { callbacks.current.onDraftChange?.(dirty); }, [dirty]);
  useEffect(() => { callbacks.current.onPendingChange?.(busy); }, [busy]);

  function replaceComments(next) {
    commentsRef.current = next;
    setComments(next);
    callbacks.current.onCountChange?.(taskIdRef.current, next.length);
  }

  async function loadComments(initial = false) {
    if (!task?.id) return;
    const version = ++requestVersion.current;
    const currentTaskId = task.id;
    if (initial) setLoading(true); else setRefreshing(true);
    try {
      const response = await api(`/tasks/${task.id}/comments`);
      if (!mountedRef.current || version !== requestVersion.current || currentTaskId !== taskIdRef.current) return;
      replaceComments(response.comments || []);
      setError('');
    } catch (loadError) {
      if (mountedRef.current && version === requestVersion.current) setError(loadError.message || 'โหลดความคิดเห็นไม่สำเร็จ');
    } finally {
      if (mountedRef.current && version === requestVersion.current) { setLoading(false); setRefreshing(false); }
    }
  }

  useEffect(() => {
    setDraft(emptyDraft()); setEditing(null); setDeleteId(null); setCancelEditPrompt(false); setNotice(''); setError('');
    commentsRef.current = []; setComments([]); setHighlightId(initialCommentId || null);
    if (task?.id) loadComments(true); else setLoading(false);
  }, [task?.id]);

  useEffect(() => {
    if (!active || !task?.id) return;
    const refresh = () => { if (!document.hidden) loadComments(false); };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [active, task?.id]);

  useEffect(() => { if (initialCommentId) setHighlightId(initialCommentId); }, [initialCommentId]);
  useEffect(() => {
    if (active && highlightId && !loading) commentNodes.current.get(highlightId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [active, highlightId, loading, comments.length]);

  function payloadFrom(value) {
    const activeIds = new Set(members.map(member => member.id));
    return { body: value.body, kind: value.kind, mentions: value.mentions.filter(mention => activeIds.has(mention.userId)).map(({ userId, start, end }) => ({ userId, start, end })) };
  }

  async function sendComment() {
    if (!task?.id || !canWrite || busy || !draft.body.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await api(`/tasks/${task.id}/comments`, { method: 'POST', body: payloadFrom(draft) });
      if (!mountedRef.current) return;
      requestVersion.current += 1;
      replaceComments([...commentsRef.current, response.comment]);
      setDraft(emptyDraft()); setHighlightId(response.comment.id); setNotice('ส่งข้อความแล้ว สมาชิกที่แท็กจะได้รับแจ้งเตือนในเว็บ');
      callbacks.current.onPosted?.(response.comment);
    } catch (sendError) { if (mountedRef.current) setError(sendError.message || 'ส่งความคิดเห็นไม่สำเร็จ ข้อความของคุณยังอยู่'); }
    finally { if (mountedRef.current) { setBusy(false); setLoading(false); setRefreshing(false); } }
  }

  function beginEdit(comment) {
    if (busy || !comment.canEdit) return;
    if (editing && (draftSignature(editing.draft) !== editing.originalSignature || (deletedEdit && editing.draft.body.length))) { setCancelEditPrompt(true); return; }
    const value = { body: comment.body, kind: comment.kind, mentions: comment.mentions.map(mention => ({ ...mention })) };
    setEditing({ id: comment.id, draft: value, originalSignature: draftSignature(value) }); setCancelEditPrompt(false); setDeleteId(null); setError('');
  }

  function cancelEdit() {
    if (editing && (draftSignature(editing.draft) !== editing.originalSignature || (deletedEdit && editing.draft.body.length))) setCancelEditPrompt(true);
    else setEditing(null);
  }

  async function saveEdit() {
    if (!editing || busy || !canWrite || !editing.draft.body.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await api(`/tasks/${task.id}/comments/${editing.id}`, { method: 'PATCH', body: payloadFrom(editing.draft) });
      if (!mountedRef.current) return;
      requestVersion.current += 1;
      replaceComments(commentsRef.current.map(comment => comment.id === response.comment.id ? response.comment : comment));
      setEditing(null); setCancelEditPrompt(false); setHighlightId(response.comment.id); setNotice('บันทึกข้อความที่แก้ไขแล้ว'); callbacks.current.onPosted?.(response.comment);
    } catch (saveError) { if (mountedRef.current) setError(saveError.message || 'แก้ไขข้อความไม่สำเร็จ กรุณาลองใหม่'); }
    finally { if (mountedRef.current) { setBusy(false); setRefreshing(false); } }
  }

  async function repostDeletedEdit() {
    if (!deletedEdit || !editing || !canWrite || busy || !editing.draft.body.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await api(`/tasks/${task.id}/comments`, { method: 'POST', body: payloadFrom(editing.draft) });
      if (!mountedRef.current) return;
      requestVersion.current += 1;
      replaceComments([...commentsRef.current, response.comment]);
      setEditing(null); setCancelEditPrompt(false); setHighlightId(response.comment.id); setNotice('ส่งร่างเป็นความคิดเห็นใหม่แล้ว');
      callbacks.current.onPosted?.(response.comment);
    } catch (postError) { if (mountedRef.current) setError(postError.message || 'ส่งร่างไม่สำเร็จ ข้อความของคุณยังอยู่'); }
    finally { if (mountedRef.current) { setBusy(false); setRefreshing(false); } }
  }

  async function deleteComment(comment) {
    if (busy || !comment.canDelete) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`/tasks/${task.id}/comments/${comment.id}`, { method: 'DELETE' });
      if (!mountedRef.current) return;
      requestVersion.current += 1;
      replaceComments(commentsRef.current.filter(item => item.id !== comment.id));
      if (editing?.id === comment.id) setEditing(null);
      setDeleteId(null); setNotice('ลบความคิดเห็นแล้ว');
    } catch (deleteError) { if (mountedRef.current) setError(deleteError.message || 'ลบข้อความไม่สำเร็จ กรุณาลองใหม่'); }
    finally { if (mountedRef.current) { setBusy(false); setRefreshing(false); } }
  }

  if (!task?.id) return <div className="tm-comments-create-first"><MessageSquare size={32} /><h3>สร้างงานก่อน แล้วเริ่มคุยกับทีมได้เลย</h3><p>หลังสร้างงาน คุณสามารถเพิ่มแคปชั่น ขอแก้ไข และแท็กสมาชิกด้วย @ ได้ในแท็บนี้</p></div>;

  return <section className="tm-comments" aria-label="การสนทนาในงาน" onKeyDown={event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (deleteId || cancelEditPrompt || editing) {
      event.preventDefault(); event.stopPropagation();
      if (busy) return;
      if (deleteId) setDeleteId(null);
      else if (cancelEditPrompt) setCancelEditPrompt(false);
      else cancelEdit();
    }
  }}>
    <div className="tm-comments-heading"><div><h3><MessageSquare size={19} />คุยกับทีมในงานนี้<span>{comments.length}</span></h3><p>เก็บความคิดเห็น แคปชั่น และสิ่งที่ต้องแก้ไว้กับงาน เพื่อให้ทีมตามต่อได้ง่าย</p></div><button type="button" className="tm-comment-refresh" aria-label="รีเฟรชความคิดเห็น" disabled={loading || refreshing || busy} onClick={() => loadComments(false)}><RefreshCw size={17} className={refreshing ? 'tm-comment-spin' : ''} /></button></div>
    {loading ? <div className="tm-comments-loading" role="status"><LoaderCircle className="tm-comment-spin" size={20} />กำลังโหลดความคิดเห็น…</div> : <div className="tm-comment-thread" aria-label="รายการความคิดเห็น">
      {!comments.length && <div className="tm-comments-empty"><MessageSquare size={26} /><strong>เริ่มบทสนทนาของงานนี้</strong><p>เพิ่มแคปชั่นหรือบอกสิ่งที่ต้องแก้ และแท็กคนในทีมด้วย @</p></div>}
      {comments.map(comment => {
        const kind = MESSAGE_KINDS.find(option => option.value === comment.kind) || MESSAGE_KINDS[0];
        return <article key={comment.id} ref={node => { if (node) commentNodes.current.set(comment.id, node); else commentNodes.current.delete(comment.id); }} className={`tm-comment ${highlightId === comment.id ? 'tm-comment-highlighted' : ''}`} data-comment-id={comment.id} aria-label={`ความคิดเห็นโดย ${comment.author?.name || 'สมาชิกที่ออกจากระบบ'}`}>
          <header><span className="tm-comment-avatar" style={avatarStyle(comment.author?.avatarColor)}>{initials(comment.author?.name)}</span><div className="tm-comment-author"><strong>{comment.author?.name || 'สมาชิกที่ออกจากระบบ'}</strong><span><time dateTime={comment.createdAt}>{readableDate(comment.createdAt)}</time>{comment.updatedAt !== comment.createdAt && <span>· แก้ไขแล้ว {readableDate(comment.updatedAt)}</span>}</span></div><span className={`tm-comment-kind tm-comment-kind-${comment.kind}`}>{comment.kind === 'caption' ? <FileText size={12} /> : comment.kind === 'revision' ? <Pencil size={12} /> : <MessageSquare size={12} />}{kind.label}</span>
            {(comment.canEdit || comment.canDelete) && <div className="tm-comment-actions">{comment.canEdit && <button type="button" aria-label="แก้ไขความคิดเห็น" disabled={busy} onClick={() => beginEdit(comment)}><Pencil size={15} /></button>}{comment.canDelete && <button type="button" aria-label="ลบความคิดเห็น" disabled={busy} onClick={() => setDeleteId(comment.id)}><Trash2 size={15} /></button>}</div>}
          </header>
          {editing?.id === comment.id ? <MessageComposer draft={editing.draft} onChange={value => { setEditing(current => ({ ...current, draft: value })); setNotice(''); }} members={members} user={user} editing active={active} busy={busy} onSubmit={saveEdit} onCancel={cancelEdit} /> : <MessageBody body={comment.body} mentions={comment.mentions} />}
          {deleteId === comment.id && <div className="tm-comment-confirm" role="alert"><strong>ต้องการลบข้อความนี้หรือไม่?</strong><p>ข้อความจะถูกลบออกจากงานนี้ถาวร</p><div><button type="button" className="tm-comment-secondary" disabled={busy} onClick={() => setDeleteId(null)}>เก็บความคิดเห็นไว้</button><button type="button" className="tm-comment-danger" disabled={busy} onClick={() => deleteComment(comment)}>ยืนยันลบความคิดเห็น</button></div></div>}
        </article>;
      })}
    </div>}
    {deletedEdit && <div className="tm-comments-recovered-draft" role="group" aria-label="ร่างความคิดเห็นที่ถูกลบ"><div className="tm-comment-confirm" role="status"><strong>ข้อความเดิมถูกลบแล้ว ร่างของคุณยังอยู่</strong><p>คุณสามารถส่งข้อความนี้เป็นความคิดเห็นใหม่ หรือยกเลิกการแก้ไขได้</p></div>
      <MessageComposer draft={editing.draft} onChange={value => setEditing(current => ({ ...current, draft: value }))} members={members} user={user} editing active={active} busy={busy} canSubmit={canWrite} submitLabel="ส่งเป็นความคิดเห็นใหม่" onSubmit={repostDeletedEdit} onCancel={cancelEdit} />
    </div>}
    {cancelEditPrompt && <div className="tm-comment-confirm" role="alert"><strong>ยังไม่ได้บันทึกข้อความที่แก้ไข</strong><p>แก้ไขต่อ หรือยกเลิกสิ่งที่แก้ไขในความคิดเห็นนี้</p><div><button type="button" className="tm-comment-secondary" onClick={() => setCancelEditPrompt(false)}>แก้ไขข้อความต่อ</button><button type="button" className="tm-comment-danger" onClick={() => { setEditing(null); setCancelEditPrompt(false); }}>ยกเลิกข้อความที่แก้ไข</button></div></div>}
    {error && <div className="tm-comments-error" role="alert"><span>{error}</span><button type="button" disabled={busy || refreshing} onClick={() => loadComments(false)}>โหลดอีกครั้ง</button></div>}
    {notice && <p className="tm-comments-notice" role="status"><Check size={15} />{notice}</p>}
    {!canWrite ? <div className="tm-comments-readonly"><MessageSquare size={17} /><span>คุณมีสิทธิ์ดูความคิดเห็น หากต้องการเขียนข้อความ ให้ผู้ดูแลโปรเจกต์เพิ่มสิทธิ์แก้ไข</span></div> : <MessageComposer draft={draft} onChange={value => { setDraft(value); setNotice(''); }} members={members} user={user} active={active && !initialCommentId && !editing} busy={busy} onSubmit={sendComment} />}
  </section>;
}
