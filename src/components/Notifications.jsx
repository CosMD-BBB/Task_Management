import React, { useState } from 'react';
import { ArrowUpRight, Bell, CheckCheck, Inbox, Loader2, X } from 'lucide-react';
import './accounts.css';

export function NotificationPanel({ notifications = [], onRead, onReadAll, onOpenTask, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const unread = notifications.filter(n => !n.readAt).length;
  const run = async (callback) => { setError(''); setBusy(true); try { await callback(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  return <aside className="room-notification-panel" aria-labelledby="room-notification-title" role="dialog">
    <header><div><Bell size={17} /><h3 id="room-notification-title">การแจ้งเตือน</h3>{unread > 0 && <span className="room-notification-count">{unread}</span>}</div><button className="icon-button" onClick={onClose} aria-label="ปิดการแจ้งเตือน"><X size={18} /></button></header>
    <div className="room-notification-toolbar"><span>{unread ? `ยังไม่ได้อ่าน ${unread} รายการ` : 'อ่านครบแล้ว'}</span><button disabled={!unread || busy} onClick={() => run(onReadAll)}>{busy ? <Loader2 size={14} className="spin" /> : <CheckCheck size={14} />}อ่านทั้งหมด</button></div>
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="room-notification-list">{notifications.length ? notifications.map(notification => <article key={notification.id} className={`room-notification ${notification.readAt ? 'is-read' : 'is-unread'}`}>
      <span className="room-notification-icon"><Bell size={16} /></span><div className="room-notification-content"><b>{notification.title}</b><p>{notification.body}</p><time dateTime={notification.createdAt}>{new Date(notification.createdAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' })}</time><div className="room-notification-actions">{notification.taskId && <button disabled={busy} onClick={() => run(async () => { if (!notification.readAt) await onRead(notification); await onOpenTask(notification); })}>เปิดงาน<ArrowUpRight size={14} /></button>}{!notification.readAt && <button disabled={busy} onClick={() => run(() => onRead(notification))}><CheckCheck size={14} />อ่านแล้ว</button>}</div></div>{!notification.readAt && <span className="room-notification-unread-dot" aria-label="ยังไม่ได้อ่าน" />}
    </article>) : <div className="room-notification-empty"><Inbox size={30} /><b>ยังไม่มีการแจ้งเตือน</b><p>เมื่อมีคนมอบหมายงานให้คุณ<br />การแจ้งเตือนจะปรากฏที่นี่</p></div>}</div>
  </aside>;
}
