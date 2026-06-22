import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Bell, X, CheckCircle, Package, Download, AlertCircle,
  Clock, ChevronRight,
} from 'lucide-react';
import { api } from './api';
import { useToast } from './toasts';
import { useAuth } from './auth';

// ─── read-state helpers (localStorage for non-integer ids) ───────────────────

const READ_KEY = 'ecews_notif_read';

function getReadSet() {
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) || '[]')); }
  catch { return new Set(); }
}

function markLocalRead(id) {
  const s = getReadSet();
  s.add(String(id));
  try { localStorage.setItem(READ_KEY, JSON.stringify([...s])); } catch {}
}

function isLocalRead(id) {
  return getReadSet().has(String(id));
}

// ─── single notification row ──────────────────────────────────────────────────

function NotifRow({ n, onDismiss, onDownload, isAdmin }) {
  const [exp, setExp] = useState(false);

  const cfg = {
    request_approved:  { Icon: CheckCircle, ring: 'ring-emerald-200', dot: 'bg-emerald-500', iconCls: 'text-emerald-600', bg: 'bg-emerald-50' },
    request_rejected:  { Icon: AlertCircle, ring: 'ring-rose-200',    dot: 'bg-rose-500',    iconCls: 'text-rose-600',    bg: 'bg-rose-50'    },
    delivery_confirmed:{ Icon: Package,     ring: 'ring-blue-200',    dot: 'bg-blue-500',    iconCls: 'text-blue-600',    bg: 'bg-blue-50'    },
  }[n.type] ?? { Icon: Bell, ring: 'ring-neutral-200', dot: 'bg-neutral-400', iconCls: 'text-neutral-500', bg: 'bg-neutral-50' };

  const { Icon, ring, dot, iconCls, bg } = cfg;

  const ago = (ts) => {
    if (!ts) return '';
    const sec = Math.floor((Date.now() - new Date(ts)) / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
  };

  return (
    <div className={`relative border-b border-neutral-100 last:border-0 ${!n.is_read ? bg : ''}`}>
      <div
        className="px-4 py-3 flex items-start gap-3 cursor-pointer hover:bg-neutral-50 transition-colors"
        onClick={() => setExp(e => !e)}
      >
        {/* unread dot */}
        {!n.is_read && (
          <span className={`absolute top-3.5 left-1.5 h-2 w-2 rounded-full ${dot} flex-shrink-0`} />
        )}

        <div className={`flex-shrink-0 h-8 w-8 rounded-xl ring-1 ${ring} grid place-items-center`}>
          <Icon className={`h-4 w-4 ${iconCls}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <span className={`text-xs font-bold truncate ${!n.is_read ? 'text-neutral-900' : 'text-neutral-600'}`}>
              {n.title}
            </span>
            <span className="text-[10px] text-neutral-400 flex-shrink-0">{ago(n.timestamp)}</span>
          </div>
          <p className="text-xs text-neutral-600 line-clamp-2">{n.message}</p>
        </div>

        <button
          onClick={e => { e.stopPropagation(); onDismiss(n.id); }}
          className="flex-shrink-0 text-neutral-300 hover:text-neutral-500 transition-colors mt-0.5"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* expanded details */}
      {exp && (
        <div className="px-4 pb-3 pl-14">
          {n.type === 'request_rejected' && n.reason && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700 mb-2">
              <span className="font-semibold">Reason: </span>{n.reason}
            </div>
          )}
          {n.type === 'delivery_confirmed' && isAdmin && n.delivery_id && (
            <button
              onClick={() => onDownload(n.delivery_id)}
              className="flex items-center gap-1.5 text-xs font-medium text-sky-700 hover:text-sky-900 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />Download note
            </button>
          )}
          {n.request_id && (
            <div className="text-[10px] text-neutral-400">Request #{n.request_id}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function DeliveryNotifier() {
  const { push } = useToast();
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState([]);
  const esRef = useRef(null);

  const isAdmin = me && ['admin', 'administrator', 'superadmin', 'hq_admin', 'hq admin']
    .includes((me.role || me.roles || '').toLowerCase());

  // merge server `is_read` with localStorage for string ids
  const hydrate = useCallback((list) => {
    return list.map(n => ({
      ...n,
      is_read: typeof n.id === 'number'
        ? n.is_read
        : (n.is_read || isLocalRead(n.id)),
    }));
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.getRecentNotifications();
      setNotifs(hydrate(Array.isArray(data) ? data : []));
    } catch {}
  }, [hydrate]);

  useEffect(() => { load(); }, [load]);

  // SSE connection for ALL users
  useEffect(() => {
    if (!me) return;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }

    let retryMs = 3000;
    let timer = null;

    const connect = () => {
      try {
        const es = new EventSource('/api/notifications/stream', { withCredentials: true });
        esRef.current = es;

        es.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.type === 'heartbeat' || data.type === 'connected') return;

            // Show a toast popup immediately
            const toastMsg = {
              request_approved:  () => push(data.message || 'Your request has been approved!', 'success', 6000),
              request_rejected:  () => push(data.message || 'Your request was rejected.', 'error', 8000),
              delivery_confirmed:() => push(data.message || 'A delivery was confirmed.', 'info', 5000),
            }[data.type];
            if (toastMsg) toastMsg();

            // Prepend to notification list
            setNotifs(cur => hydrate([{ ...data, is_read: false }, ...cur]));
            retryMs = 3000;
          } catch {}
        };

        es.onerror = () => {
          es.close();
          esRef.current = null;
          timer = setTimeout(connect, retryMs);
          retryMs = Math.min(retryMs * 2, 60000);
        };
      } catch {}
    };

    connect();
    return () => {
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      if (timer) clearTimeout(timer);
    };
  }, [me?.id]);

  const unread = notifs.filter(n => !n.is_read).length;

  const dismiss = async (id) => {
    markLocalRead(id);
    setNotifs(cur => cur.map(n => n.id === id ? { ...n, is_read: true } : n));
    if (typeof id === 'number') {
      try { await api.markNotificationRead(id); } catch {}
    }
  };

  const dismissAll = async () => {
    const deliveryIds = notifs.filter(n => typeof n.id === 'number' && !n.is_read).map(n => n.id);
    notifs.filter(n => typeof n.id !== 'number').forEach(n => markLocalRead(n.id));
    setNotifs(cur => cur.map(n => ({ ...n, is_read: true })));
    if (deliveryIds.length) {
      try { await api.markAllNotificationsRead(); } catch {}
    }
  };

  const download = async (deliveryId) => {
    try {
      const blob = await api.downloadDeliveryNote(deliveryId);
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), {
        href: url, download: `delivery_note_${deliveryId}.pdf`,
      }).click();
      URL.revokeObjectURL(url);
    } catch { push('Failed to download note', 'error'); }
  };

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-xl bg-white/80 hover:bg-white border border-neutral-200 shadow-sm transition"
        title="Notifications"
      >
        <Bell className="h-5 w-5 text-neutral-600" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-96 bg-white rounded-2xl shadow-2xl border border-neutral-200 z-50 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between bg-neutral-50">
              <div>
                <div className="text-sm font-bold text-neutral-900">Notifications</div>
                <div className="text-xs text-neutral-500">
                  {unread > 0 ? `${unread} unread` : 'All caught up'}
                </div>
              </div>
              <div className="flex gap-2">
                {unread > 0 && (
                  <button
                    onClick={dismissAll}
                    className="text-xs text-neutral-500 hover:text-neutral-700 underline"
                  >
                    Mark all read
                  </button>
                )}
                <button onClick={load} className="text-xs text-neutral-400 hover:text-neutral-600">
                  Refresh
                </button>
              </div>
            </div>

            {/* List */}
            <div className="max-h-[420px] overflow-y-auto">
              {notifs.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-neutral-400">
                  <Bell className="h-8 w-8 opacity-30" />
                  <p className="text-sm">No notifications yet</p>
                  <p className="text-xs text-neutral-300">
                    {isAdmin ? 'Delivery confirmations appear here.' : 'Request updates appear here.'}
                  </p>
                </div>
              ) : (
                notifs.map(n => (
                  <NotifRow
                    key={n.id}
                    n={n}
                    onDismiss={dismiss}
                    onDownload={download}
                    isAdmin={isAdmin}
                  />
                ))
              )}
            </div>

            {/* Footer */}
            {notifs.length > 0 && (
              <div className="px-4 py-2 border-t border-neutral-100 text-center">
                <p className="text-[10px] text-neutral-400">Last 7 days · Real-time updates active</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
