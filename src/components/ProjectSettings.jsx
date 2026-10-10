import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ImagePlus, Loader2, Plus, Settings2, Users, X } from 'lucide-react';
import { api } from '../api';
import { tagAppearanceStyle } from '../tagAppearance.js';
import './project-settings.css';

const initials = name => name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();

async function prepareImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('เลือกไฟล์รูป JPG, PNG หรือ WebP ครับ');
  if (file.size > 8 * 1024 * 1024) throw new Error('รูปภาพต้องมีขนาดไม่เกิน 8 MB');
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    const scale = Math.min(1, 1200 / image.width, 800 / image.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    let result = canvas.toDataURL('image/webp', 0.8);
    if (result.length > 600 * 1024) result = canvas.toDataURL('image/webp', 0.5);
    if (result.length > 600 * 1024) throw new Error('รูปนี้ใหญ่เกินไป ลองเลือกภาพขนาดเล็กลงครับ');
    return result;
  } finally { URL.revokeObjectURL(source); }
}

function OptionCatalog({ label, kind, values, disabled, onChange }) {
  const [entry, setEntry] = useState('');
  const add = () => {
    const value = entry.trim();
    if (!value || disabled || values.length >= 60) return;
    if (!values.some(x => x.toLocaleLowerCase() === value.toLocaleLowerCase())) onChange([...values, value]);
    setEntry('');
  };
  return <div className="project-option-catalog"><h4>{label}</h4><div className="project-option-chips">{values.map(value => <span key={value} style={tagAppearanceStyle(value, kind)} data-tag-kind={kind} data-tag-value={value}>{value}{!disabled && <button type="button" aria-label={`ลบตัวเลือก ${value} จาก ${label}`} onClick={() => onChange(values.filter(x => x !== value))}><X size={12} /></button>}</span>)}{!values.length && <small>เพิ่มตัวเลือกที่ทีมใช้ได้เลย</small>}</div>{!disabled && <div className="project-option-add"><input aria-label={`ตัวเลือกใหม่ของ ${label}`} value={entry} onChange={e => setEntry(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} maxLength={100} placeholder={label === 'Type Content' ? 'เช่น ขายของ / รีวิวสินค้า' : 'เช่น LINE OA / Shopee'} /><button type="button" className="secondary" disabled={!entry.trim() || values.length >= 60} onClick={add}><Plus size={14} />เพิ่มตัวเลือก</button></div>}</div>;
}

export default function ProjectSettings({ project, onClose, onSaved, onDeleted, create = false }) {
  const [form, setForm] = useState({
    name: project?.name || '', description: project?.description || '', color: project?.color || '#0e8778',
    coverImage: project?.coverImage || null, fields: project?.fields || [],
    contentTypeOptions: project?.contentTypeOptions || ['Infographic', 'Video', 'Photo album', 'Single Post', 'ขายของ'],
    channelOptions: project?.channelOptions || ['Facebook', 'Instagram', 'TikTok', 'YouTube', 'LINE'],
  });
  const [current, setCurrent] = useState(project);
  const [invite, setInvite] = useState({ email: '', role: 'editor' });
  const [fieldName, setFieldName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dialog = useRef(null);
  const nameInput = useRef(null);
  const discardDialog = useRef(null);
  const discardFocus = useRef(null);
  const savedForm = useRef(JSON.stringify(form));
  const dirty = JSON.stringify(form) !== savedForm.current;
  const owner = create || current?.yourRole === 'owner';
  const requestClose = useCallback(() => {
    if (busy) return;
    if (dirty) { discardFocus.current = document.activeElement; setConfirmDiscard(true); }
    else onClose();
  }, [busy, dirty, onClose]);
  useEffect(() => {
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (nameInput.current && !nameInput.current.disabled) nameInput.current.focus();
    else dialog.current?.querySelector('button:not(:disabled)')?.focus();
    return () => { document.body.style.overflow = previousOverflow; previous?.focus?.(); };
  }, []);
  useEffect(() => {
    if (confirmDiscard) discardDialog.current?.focus();
    else if (discardFocus.current) { discardFocus.current.focus?.(); discardFocus.current = null; }
  }, [confirmDiscard]);
  useEffect(() => {
    const key = event => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (busy) return;
        if (confirmDiscard) setConfirmDiscard(false);
        else requestClose();
      }
      if (event.key !== 'Tab') return;
      const target = confirmDiscard ? discardDialog.current : dialog.current;
      const controls = [...(target?.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || [])].filter(element => element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); target?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === target || !target?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !target?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [busy, confirmDiscard, requestClose]);
  const run = async fn => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const update = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const save = e => {
    e.preventDefault();
    run(async () => {
      const body = { ...form, coverImage: form.coverImage || null, fields: form.fields.map(f => ({ ...f, options: (f.options || []).map(s => s.trim()).filter(Boolean) })) };
      const { project: updated } = await api(create ? '/projects' : `/projects/${project.id}`, { method: create ? 'POST' : 'PATCH', body });
      savedForm.current = JSON.stringify(form);
      await onSaved(updated); onClose();
    });
  };
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && requestClose()}><section className="settings-modal" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="project-settings-title"><header><div><span className="eyebrow">PROJECT ROOM</span><h2 id="project-settings-title">{create ? 'สร้างห้องโปรเจกต์' : 'ตั้งค่าโปรเจกต์'}</h2></div><button className="icon-button" disabled={busy} onClick={requestClose} aria-label="ปิด"><X size={20} /></button></header>
    <div className="settings-content"><form onSubmit={save}>
      <label>ชื่อโปรเจกต์<input ref={nameInput} required disabled={!owner || busy} maxLength={100} value={form.name} onChange={e => update('name', e.target.value)} placeholder="เช่น Regagar / Q4 campaign" /></label>
      <div className="project-cover-setting"><span className="project-setting-label">รูปประกอบโปรเจกต์</span><div className={`cover-preview ${form.coverImage ? 'has-image' : ''}`} style={{ backgroundColor: `${form.color}15` }}>{form.coverImage ? <img src={form.coverImage} alt="ตัวอย่างรูปโปรเจกต์" referrerPolicy="no-referrer" /> : <><ImagePlus size={30} /><span>ใส่ภาพให้จำห้องนี้ได้ง่ายขึ้น</span></>}</div>{owner && <><div className="cover-buttons"><label className={`secondary upload-cover ${busy ? 'disabled' : ''}`}><ImagePlus size={15} />อัปโหลดรูป<input aria-label="อัปโหลดรูปโปรเจกต์" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) run(async () => update('coverImage', await prepareImage(file))); e.target.value = ''; }} /></label>{form.coverImage && <button type="button" disabled={busy} className="text-button" onClick={() => update('coverImage', null)}>นำรูปออก</button>}</div><label className="cover-url-label">หรือวางลิงก์รูปภาพ HTTPS<input type="url" aria-label="ลิงก์รูปโปรเจกต์" disabled={busy} placeholder="https://…" value={form.coverImage?.startsWith('data:') ? '' : form.coverImage || ''} onChange={e => update('coverImage', e.target.value || null)} /></label></>}</div>
      <label>รายละเอียด<textarea disabled={!owner || busy} value={form.description} maxLength={2000} onChange={e => update('description', e.target.value)} placeholder="พื้นที่สำหรับวางแผนและทำงานร่วมกัน" rows={2} /></label>
      <div className="color-picker"><span>สีโปรเจกต์</span>{['#0e8778', '#7965d5', '#df8552', '#448cca', '#df6684', '#434b5d'].map(color => <button type="button" disabled={!owner || busy} key={color} onClick={() => update('color', color)} style={{ background: color }} aria-label={`เลือกสี ${color}`} className={form.color === color ? 'selected' : ''}>{form.color === color && <Check size={15} />}</button>)}</div>
      <div className="settings-section"><h3><Settings2 size={16} /> ตัวเลือกข้อมูลของห้องนี้</h3><p>เลือกหลายแท็กต่อหนึ่งงานได้ และเพิ่มชื่อที่ทีมใช้เองได้</p><OptionCatalog label="Type Content" kind="contentType" values={form.contentTypeOptions} disabled={!owner || busy} onChange={v => update('contentTypeOptions', v)} /><OptionCatalog label="Channel" kind="channel" values={form.channelOptions} disabled={!owner || busy} onChange={v => update('channelOptions', v)} /></div>
      <div className="settings-section"><h3><Settings2 size={16} /> คอลัมน์เพิ่มเติม</h3><p>เพิ่มหัวข้อข้อมูลอื่นให้เหมาะกับงานของทีม</p>{form.fields.map((f, i) => <div key={f.id} className="custom-field-setting"><input aria-label="ชื่อคอลัมน์" disabled={!owner || busy} maxLength={60} value={f.name} onChange={e => update('fields', form.fields.map((x, ix) => ix === i ? { ...x, name: e.target.value } : x))} /><select disabled={!owner || busy} aria-label="ประเภทคอลัมน์" value={f.type} onChange={e => update('fields', form.fields.map((x, ix) => ix === i ? { ...x, type: e.target.value } : x))}><option value="text">ข้อความ</option><option value="select">ตัวเลือก</option></select>{owner && <button type="button" disabled={busy} className="icon-button" aria-label={`ลบ ${f.name}`} onClick={() => update('fields', form.fields.filter(x => x.id !== f.id))}><X size={16} /></button>}{f.type === 'select' && <input className="field-options" aria-label={`ตัวเลือกของ ${f.name}`} disabled={!owner || busy} placeholder="ตัวเลือก คั่นด้วย ," value={(f.options || []).join(', ')} onChange={e => update('fields', form.fields.map((x, ix) => ix === i ? { ...x, options: e.target.value.split(',').map(s => s.trim()) } : x))} />}</div>)}{owner && <div className="add-field-row"><input aria-label="ชื่อคอลัมน์ใหม่" placeholder="เช่น Ref. / Prototype / Mockup" value={fieldName} disabled={busy} maxLength={60} onChange={e => setFieldName(e.target.value)} /><button type="button" className="secondary" disabled={busy || !fieldName.trim() || form.fields.length >= 12} onClick={() => { update('fields', [...form.fields, { id: crypto.randomUUID(), name: fieldName.trim(), type: 'text', options: [] }]); setFieldName(''); }}><Plus size={15} />เพิ่ม</button></div>}</div>
      {owner && <button disabled={busy} className="primary">{busy && <Loader2 className="spin" size={16} />}{create ? 'สร้างโปรเจกต์' : 'บันทึกการตั้งค่า'}<ArrowRight size={16} /></button>}
    </form>
    {!create && <div className="settings-section"><h3><Users size={16} /> สมาชิกและสิทธิ์</h3><p>สมาชิกในห้องนี้มองเห็นงานร่วมกันได้ กำหนดสิทธิ์แก้ไขหรือดูอย่างเดียวได้</p><div className="member-list">{current?.members?.map(member => <div className="member-row" key={member.userId}><span className="avatar" style={{ background: member.user.avatarColor }}>{initials(member.user.name)}</span><div><b>{member.user.name}</b><small>{member.user.email}</small></div><span className="member-role">{member.role === 'owner' ? 'เจ้าของ' : member.role === 'editor' ? 'แก้ไขได้' : 'ดูอย่างเดียว'}</span>{owner && member.role !== 'owner' && <><select aria-label={`สิทธิ์ของ ${member.user.name}`} value={member.role} disabled={busy} onChange={e => run(async () => { const { project: updated } = await api(`/projects/${project.id}/members`, { method: 'POST', body: { email: member.user.email, role: e.target.value } }); setCurrent(updated); await onSaved(updated); })}><option value="editor">แก้ไขได้</option><option value="viewer">ดูอย่างเดียว</option></select><button className="icon-button" aria-label={`นำ ${member.user.name} ออกจากโปรเจกต์`} disabled={busy} onClick={() => run(async () => { const { project: updated } = await api(`/projects/${project.id}/members/${member.userId}`, { method: 'DELETE' }); setCurrent(updated); await onSaved(updated); })}><X size={15} /></button></>}</div>)}</div>{owner && <form className="invite-form" onSubmit={e => { e.preventDefault(); run(async () => { const { project: updated } = await api(`/projects/${project.id}/members`, { method: 'POST', body: invite }); setCurrent(updated); setInvite({ ...invite, email: '' }); await onSaved(updated); }); }}><label>เพิ่มสมาชิกด้วยอีเมล<input type="email" required disabled={busy} value={invite.email} onChange={e => setInvite({ ...invite, email: e.target.value })} placeholder="อีเมลของสมาชิกที่สมัครและยืนยันแล้ว" /></label><div><select aria-label="สิทธิ์สมาชิกใหม่" disabled={busy} value={invite.role} onChange={e => setInvite({ ...invite, role: e.target.value })}><option value="editor">แก้ไขงานได้</option><option value="viewer">ดูอย่างเดียว</option></select><button className="secondary" disabled={busy}><Plus size={16} />เพิ่มสมาชิก</button></div></form>}</div>}
    {!create && owner && <div className="delete-project">{!confirmDelete ? <button className="text-danger" onClick={() => setConfirmDelete(true)}>ลบโปรเจกต์นี้</button> : <><p>ลบโปรเจกต์และงานทั้งหมดถาวร?</p><button disabled={busy} className="danger-button" onClick={() => run(async () => { await api(`/projects/${project.id}`, { method: 'DELETE' }); await onDeleted(); onClose(); })}>ยืนยันการลบ</button><button className="secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>ยกเลิก</button></>}</div>}
    {error && <div className="form-error" role="alert">{error}</div>}</div>
    {confirmDiscard && <div className="project-settings-discard-backdrop"><section className="project-settings-discard" ref={discardDialog} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="project-discard-title" aria-describedby="project-discard-description"><h3 id="project-discard-title">มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก</h3><p id="project-discard-description">หากปิดตอนนี้ ชื่อ รูปภาพ และการตั้งค่าที่แก้ไขจะไม่ถูกบันทึก</p><footer><button type="button" className="secondary" onClick={() => setConfirmDiscard(false)}>แก้ไขต่อ</button><button type="button" className="danger-button" onClick={onClose}>ทิ้งการเปลี่ยนแปลง</button></footer></section></div>}
  </section></div>;
}
