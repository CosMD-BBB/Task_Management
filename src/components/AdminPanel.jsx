import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, CirclePause, FolderKanban, Loader2, Mail, Pencil, Search, Shield, ShieldCheck, Sparkles, Trash2, UserCheck, UserRound, Users, X } from 'lucide-react';
import { api } from '../api';
import './accounts.css';

const initials = (name = '') => name.split(' ').map(word => word[0]).join('').slice(0, 2).toUpperCase();

export function AdminPanel({ user, onClose, onChanged }) {
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState(null);
  const [editName, setEditName] = useState('');
  const [transferId, setTransferId] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const dialog = useRef(null);
  const confirmationRef = useRef(null);
  const refresh = async () => {
    const result = await api('/admin/users');
    setUsers(result.users || []); setProjects(result.projects || []);
  };
  useEffect(() => { refresh().catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; dialog.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; previous?.focus?.(); };
  }, []);
  useEffect(() => {
    const key = e => {
      if (e.key === 'Escape' && !busy) { e.stopPropagation(); if (action) setAction(null); else onClose(); }
      if (e.key !== 'Tab') return;
      const target = action ? confirmationRef.current : dialog.current;
      const controls = [...(target?.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || [])].filter(element => element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === target)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !target?.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [action, busy, onClose]);
  useEffect(() => { if (action) confirmationRef.current?.focus(); }, [action]);
  const openAction = (type, member) => { setAction({ type, member }); setEditName(member.name); setTransferId(''); setConfirmation(''); setError(''); setNotice(''); };
  const activeCount = users.filter(member => !member.disabled && member.emailVerified).length;
  const pendingCount = users.filter(member => !member.disabled && !member.emailVerified).length;
  const suspendedCount = users.filter(member => member.disabled).length;
  const filtered = users.filter(member => `${member.name} ${member.email}`.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || (filter === 'suspended' ? member.disabled : filter === 'pending' ? !member.disabled && !member.emailVerified : !member.disabled && member.emailVerified)));
  const transferCandidates = users.filter(member => member.id !== action?.member.id && !member.disabled && member.emailVerified);
  const ownedProjects = action ? projects.filter(project => project.ownerId === action.member.id) : [];
  const ownedCount = action ? (action.member.ownedProjectCount ?? ownedProjects.length) : 0;
  const submitAction = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const member = action.member;
      if (action.type === 'delete') {
        if (confirmation !== member.email) throw new Error('กรุณาพิมพ์อีเมลของสมาชิกให้ตรงเพื่อยืนยันการลบ');
        if (ownedCount > 0 && !transferId) throw new Error('กรุณาเลือกผู้รับโอนโปรเจกต์ก่อนลบบัญชี');
        await api(`/admin/users/${member.id}`, { method: 'DELETE', body: transferId ? { transferToUserId: transferId } : {} });
        setNotice(`ลบบัญชี ${member.name} แล้ว${ownedCount ? ' และโอนโปรเจกต์ให้ผู้รับผิดชอบใหม่แล้ว' : ''}`);
      } else {
        const body = action.type === 'edit' ? { name: editName.trim() } : { disabled: !member.disabled };
        await api(`/admin/users/${member.id}`, { method: 'PATCH', body });
        setNotice(action.type === 'edit' ? `บันทึกชื่อของ ${member.name} แล้ว` : member.disabled ? member.emailVerified ? `${member.name} กลับมาใช้งานได้แล้ว` : `ยกเลิกการระงับ ${member.name} แล้ว บัญชีนี้ยังรอยืนยันอีเมล` : `ระงับบัญชี ${member.name} แล้ว`);
      }
      await refresh(); setAction(null); await onChanged?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <div className="modal-backdrop room-admin-backdrop" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}><section className="room-admin-panel" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="room-admin-title">
    <header className="room-admin-header"><div className="room-admin-heading"><span className="room-admin-heading-icon"><ShieldCheck size={24} /></span><div><span className="eyebrow">TEAM ADMINISTRATION</span><h2 id="room-admin-title">จัดการทีมและผู้ใช้งาน</h2><p>ดูแลบัญชีสมาชิกได้จากหน้านี้</p></div></div><button className="icon-button" onClick={onClose} disabled={busy} aria-label="ปิดหน้าผู้ดูแลระบบ"><X size={21} /></button></header>
    <div className="room-admin-body">
      {user.demoScopeId && <div className="room-admin-demo"><Sparkles size={19} /><div><b>ทดลองจัดการเฉพาะทีมตัวอย่าง</b><p>ลองระงับ แก้ไขชื่อ หรือลบสมาชิกในห้องทดลองของคุณได้ ข้อมูลนี้เป็นข้อมูลตัวอย่าง</p></div></div>}
      <div className="room-admin-stats"><div><Users size={21} /><strong>{users.length}</strong><span>สมาชิกทั้งหมด</span></div><div><UserCheck size={21} /><strong>{activeCount}</strong><span>ใช้งานได้</span></div><div><Mail size={21} /><strong>{pendingCount}</strong><span>รอยืนยันอีเมล</span></div><div><CirclePause size={21} /><strong>{suspendedCount}</strong><span>ถูกระงับ</span></div><div><FolderKanban size={21} /><strong>{projects.length}</strong><span>โปรเจกต์</span></div></div>
      <div className="room-admin-guide"><Shield size={18} /><p><b>เมื่อสมาชิกลาออก</b> เลือก “ระงับบัญชี” เพื่อหยุดการเข้าสู่ระบบทันทีและเก็บงานไว้ หากต้องการลบบัญชีถาวร ให้เลือกผู้รับโอนโปรเจกต์ก่อน คุณสามารถจัดการสิทธิ์ในแต่ละห้องได้จากการตั้งค่าโปรเจกต์</p></div>
      <div className="room-admin-toolbar"><label className="room-admin-search"><Search size={17} /><input aria-label="ค้นหาสมาชิกด้วยชื่อหรืออีเมล" placeholder="ค้นหาชื่อหรืออีเมล..." value={search} onChange={e => setSearch(e.target.value)} /></label><select aria-label="กรองสถานะสมาชิก" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">สมาชิกทุกสถานะ</option><option value="active">ใช้งานได้</option><option value="pending">รอยืนยันอีเมล</option><option value="suspended">ถูกระงับ</option></select></div>
      {notice && <div className="account-success" role="status"><CheckCircle2 size={17} /><span>{notice}</span></div>}{error && !action && <div className="form-error" role="alert">{error}</div>}
      {loading ? <div className="room-admin-empty"><Loader2 size={26} className="spin" /><span>กำลังโหลดสมาชิก...</span></div> : <div className="room-admin-users">
        <div className="room-admin-table-head"><span>สมาชิก</span><span>สถานะ / สิทธิ์</span><span>โปรเจกต์</span><span>จัดการ</span></div>
        {filtered.length ? filtered.map(member => {
          const self = member.id === user.id;
          return <article className={`room-admin-user ${member.disabled ? 'is-suspended' : ''}`} key={member.id}>
            <div className="room-admin-user-identity"><span className="avatar" style={{ background: member.avatarColor }}>{initials(member.name)}</span><div><b>{member.name}{self && <span className="room-admin-self">คุณ</span>}</b><small>{member.email}</small></div></div>
            <div className="room-admin-user-state"><span className={`room-admin-status ${member.disabled ? 'status-disabled' : member.emailVerified ? 'status-active' : 'status-pending'}`}>{member.disabled ? <CirclePause size={12} /> : member.emailVerified ? <UserCheck size={12} /> : <Mail size={12} />}{member.disabled ? 'ถูกระงับ' : member.emailVerified ? 'ใช้งานได้' : 'รอยืนยันอีเมล'}</span><span className="room-admin-role">{member.globalRole === 'superadmin' ? <><ShieldCheck size={12} />ผู้ดูแลระบบ</> : <><UserRound size={12} />สมาชิก</>}</span>{(member.emailVerified || member.disabled) && <span className={`room-admin-email-status ${member.emailVerified ? '' : 'is-pending'}`}>{member.emailVerified ? 'ยืนยันอีเมลแล้ว' : 'รอยืนยันอีเมล'}</span>}</div>
            <div className="room-admin-user-projects"><b>{member.projectCount || 0}<span className="room-admin-mobile-label"> โปรเจกต์</span></b><small>เจ้าของ {member.ownedProjectCount || 0}</small></div>
            <div className="room-admin-user-actions"><button className="icon-button" aria-label={`แก้ไขชื่อ ${member.name}`} onClick={() => openAction('edit', member)} disabled={busy}><Pencil size={15} /></button><button className={`room-admin-state-button ${member.disabled ? 'can-reactivate' : ''}`} disabled={self || busy} title={self ? 'บัญชีผู้ดูแลที่กำลังใช้งานจะระงับตัวเองไม่ได้' : undefined} onClick={() => openAction('state', member)}>{member.disabled ? <UserCheck size={14} /> : <CirclePause size={14} />}{member.disabled ? 'เปิดใช้งาน' : 'ระงับบัญชี'}</button><button className="icon-button room-admin-delete" disabled={self || busy} aria-label={`ลบบัญชี ${member.name}`} title={self ? 'ลบบัญชีที่กำลังใช้งานไม่ได้' : 'ลบบัญชีถาวร'} onClick={() => openAction('delete', member)}><Trash2 size={15} /></button></div>
          </article>;
        }) : <div className="room-admin-empty"><Users size={30} /><b>ไม่พบสมาชิกที่ตรงกับการค้นหา</b><span>ลองใช้ชื่อ อีเมล หรือเปลี่ยนสถานะที่กรอง</span></div>}
      </div>}
      <p className="room-admin-footnote"><ShieldCheck size={14} />บัญชีผู้ดูแลระบบใช้รหัสผ่านส่วนตัวและการยืนยันอีเมล คุณจะระงับหรือลบบัญชีที่กำลังใช้งานอยู่ไม่ได้</p>
    </div>
    {action && <div className="room-admin-confirm-backdrop" onMouseDown={event => event.target === event.currentTarget && !busy && setAction(null)}><section className="room-admin-confirm" ref={confirmationRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="room-admin-confirm-title"><header><h3 id="room-admin-confirm-title">{action.type === 'edit' ? 'แก้ไขชื่อสมาชิก' : action.type === 'delete' ? 'ลบบัญชีสมาชิกถาวร' : action.member.disabled ? 'เปิดใช้งานบัญชีอีกครั้ง' : 'ระงับบัญชีสมาชิก'}</h3><button className="icon-button" disabled={busy} onClick={() => setAction(null)} aria-label="ปิดการยืนยัน"><X size={19} /></button></header><form onSubmit={submitAction}>
      <div className="room-admin-confirm-person"><span className="avatar" style={{ background: action.member.avatarColor }}>{initials(action.member.name)}</span><div><b>{action.member.name}</b><small>{action.member.email}</small></div></div>
      {action.type === 'edit' ? <label>ชื่อที่แสดง<input required maxLength={80} value={editName} onChange={e => setEditName(e.target.value)} /></label> : action.type === 'delete' ? <>
        <div className="room-admin-delete-warning"><AlertTriangle size={18} /><p>บัญชีนี้จะถูกลบถาวรและเข้าสู่ระบบไม่ได้อีก การดำเนินการนี้ย้อนกลับไม่ได้ งานในโปรเจกต์ยังคงอยู่โดยนำผู้ใช้นี้ออกจากผู้รับผิดชอบ</p></div>
        {ownedCount > 0 && <div className="room-admin-transfer"><b>โอน {ownedCount} โปรเจกต์ให้ผู้รับผิดชอบใหม่</b>{ownedProjects.length > 0 && <ul>{ownedProjects.map(project => <li key={project.id}><FolderKanban size={14} />{project.name}<ChevronRight size={13} /></li>)}</ul>}<label>ผู้รับโอนโปรเจกต์<select required value={transferId} onChange={e => setTransferId(e.target.value)}><option value="">เลือกสมาชิก...</option>{transferCandidates.map(member => <option key={member.id} value={member.id}>{member.name} ({member.email})</option>)}</select></label>{!transferCandidates.length && <p className="form-error">ยังไม่มีสมาชิกที่ใช้งานได้และยืนยันอีเมลแล้ว กรุณาเพิ่มผู้รับโอนก่อนลบบัญชีนี้</p>}<p>ผู้รับโอนต้องเป็นสมาชิกที่ใช้งานได้และยืนยันอีเมลแล้ว</p></div>}
        <label>พิมพ์อีเมลของสมาชิกเพื่อยืนยัน<input required type="email" autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)} placeholder={action.member.email} /></label>
      </> : <p className="room-admin-confirm-description">{action.member.disabled ? action.member.emailVerified ? 'สมาชิกจะกลับมาเข้าสู่ระบบและทำงานตามสิทธิ์เดิมได้อีกครั้ง' : 'บัญชีนี้จะไม่ถูกระงับแล้ว สมาชิกยังต้องยืนยันอีเมลก่อนเริ่มใช้งานพื้นที่ทำงาน' : 'สมาชิกจะถูกออกจากระบบและเข้าสู่ระบบไม่ได้ทันที ข้อมูลและงานเดิมยังเก็บอยู่ คุณสามารถเปิดใช้งานบัญชีนี้ได้ภายหลัง'}</p>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <footer><button type="button" className="secondary" disabled={busy} onClick={() => setAction(null)}>ยกเลิก</button><button className={action.type === 'delete' ? 'danger-button' : 'primary'} disabled={busy || (action.type === 'delete' && (confirmation !== action.member.email || (ownedCount > 0 && !transferId))) || (action.type === 'edit' && !editName.trim())}>{busy && <Loader2 size={15} className="spin" />}{action.type === 'edit' ? 'บันทึกชื่อ' : action.type === 'delete' ? 'ยืนยันลบบัญชี' : action.member.disabled ? 'เปิดใช้งานบัญชี' : 'ยืนยันระงับบัญชี'}</button></footer>
    </form></section></div>}
  </section></div>;
}
