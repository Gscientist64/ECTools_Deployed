// frontend/src/admin.jsx
import React, { useEffect, useState } from 'react';
import { api } from './api';
import { useToast } from './toasts';
import { fmtDate, fmtDateTime } from './utils';
import {
  Check, X, Pencil, Trash2, RefreshCcw, Shield, ChevronDown,
  AlertTriangle, PackageCheck, Clock, CheckCircle, AlertCircle,
  Download, Building2, User, Calendar, Inbox, Search,
  MessageSquare, Send, Square, CheckSquare, Layers, Bell, Sliders,
} from 'lucide-react';

// ─── primitives ───────────────────────────────────────────────────────────────

function Btn({ variant = 'solid', color = 'emerald', size = 'sm', className = '', children, ...p }) {
  const sz = { sm: 'px-3 py-1.5 text-xs rounded-lg', md: 'px-4 py-2 text-sm rounded-xl' }[size];
  const ring = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-black/30';
  const pal = {
    emerald: {
      solid: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm',
      ghost: 'border border-emerald-300 text-emerald-700 hover:bg-emerald-50',
      subtle: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200',
    },
    rose: {
      solid: 'bg-rose-600 hover:bg-rose-700 text-white shadow-sm',
      ghost: 'border border-rose-300 text-rose-700 hover:bg-rose-50',
      subtle: 'bg-rose-100 text-rose-700 hover:bg-rose-200',
    },
    neutral: {
      solid: 'bg-neutral-800 hover:bg-neutral-900 text-white shadow-sm',
      ghost: 'border border-neutral-300 text-neutral-700 hover:bg-neutral-100',
      subtle: 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200',
    },
    amber: {
      solid: 'bg-amber-500 hover:bg-amber-600 text-white shadow-sm',
      ghost: 'border border-amber-300 text-amber-700 hover:bg-amber-50',
      subtle: 'bg-amber-100 text-amber-800 hover:bg-amber-200',
    },
    blue: {
      solid: 'bg-sky-600 hover:bg-sky-700 text-white shadow-sm',
      ghost: 'border border-sky-300 text-sky-700 hover:bg-sky-50',
      subtle: 'bg-sky-100 text-sky-700 hover:bg-sky-200',
    },
  };
  return (
    <button className={`inline-flex items-center gap-1.5 font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${sz} ${pal[color][variant]} ${ring} ${className}`} {...p}>
      {children}
    </button>
  );
}

function StatusBadge({ status }) {
  const map = {
    Approved:  'bg-emerald-100 text-emerald-700 ring-emerald-200',
    Rejected:  'bg-rose-100    text-rose-700    ring-rose-200',
    Pending:   'bg-amber-100   text-amber-800   ring-amber-200',
    Delivered: 'bg-blue-100    text-blue-700    ring-blue-200',
  };
  const cls = map[status] ?? 'bg-neutral-100 text-neutral-600 ring-neutral-200';
  const icons = { Approved: CheckCircle, Rejected: AlertCircle, Pending: Clock, Delivered: PackageCheck };
  const Icon = icons[status] ?? Clock;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ring-1 ${cls}`}>
      <Icon className="h-3 w-3" />{status}
    </span>
  );
}

function daysSince(iso) {
  if (!iso) return '—';
  const d = Math.floor((Date.now() - new Date(iso)) / 86400000);
  return d === 0 ? 'Today' : d === 1 ? '1 day ago' : `${d} days ago`;
}

// ─── Rejection modal ──────────────────────────────────────────────────────────

function RejectModal({ id, onClose, onDone }) {
  const { push } = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await api.adminRejectRequestWithReason(id, reason);
      push('Request rejected', 'success');
      onDone();
    } catch (e) {
      push(e.message || 'Failed to reject', 'error');
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-neutral-200 overflow-hidden">
        <div className="bg-rose-600 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white font-semibold">
            <AlertCircle className="h-5 w-5" />Reject Request #{id}
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-neutral-600">Provide a reason so the requester understands why it was rejected.</p>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Enter rejection reason…"
            autoFocus
            className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm min-h-[100px] resize-none outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
          />
          <div className="flex gap-2 justify-end">
            <Btn variant="ghost" color="neutral" size="md" onClick={onClose} disabled={busy}>Cancel</Btn>
            <Btn color="rose" size="md" onClick={confirm} disabled={busy}>
              {busy ? 'Rejecting…' : 'Confirm Reject'}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Pending confirmations tab ────────────────────────────────────────────────

function PendingConfirmationsTab({ items, loading }) {
  const [search, setSearch] = useState('');
  const filtered = items.filter(it =>
    !search ||
    it.tool_name?.toLowerCase().includes(search.toLowerCase()) ||
    it.facility?.toLowerCase().includes(search.toLowerCase()) ||
    it.requested_by?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="space-y-2">
        {[1,2,3].map(i => <div key={i} className="h-20 rounded-2xl bg-neutral-100 animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400 pointer-events-none" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by tool, facility, or name…"
          className="w-full rounded-xl border border-neutral-200 bg-white pl-10 pr-4 py-2.5 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 shadow-sm"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-neutral-400">
          <PackageCheck className="h-10 w-10 opacity-40" />
          <p className="text-sm">{search ? 'No matches.' : 'All deliveries have been confirmed — great work!'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(it => (
            <div key={it.requested_tool_id}
              className="rounded-2xl border border-amber-200 bg-amber-50/40 px-4 py-3 flex flex-wrap items-center gap-3"
            >
              {/* tool + qty */}
              <div className="flex-1 min-w-48">
                <div className="text-sm font-semibold text-neutral-900">{it.tool_name}</div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  Qty: <span className="font-medium text-neutral-700">{it.quantity}</span>
                </div>
              </div>

              {/* facility */}
              <div className="flex items-center gap-1.5 text-xs text-neutral-600 min-w-36">
                <Building2 className="h-3.5 w-3.5 text-neutral-400 flex-shrink-0" />
                <span className="truncate">{it.facility || '—'}</span>
              </div>

              {/* requester */}
              <div className="flex items-center gap-1.5 text-xs text-neutral-600 min-w-28">
                <User className="h-3.5 w-3.5 text-neutral-400 flex-shrink-0" />
                <span className="truncate">{it.requested_by || '—'}</span>
              </div>

              {/* time */}
              <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                <Calendar className="h-3.5 w-3.5 text-neutral-400 flex-shrink-0" />
                <span>Approved {daysSince(it.approval_date)}</span>
              </div>

              {/* badge */}
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 ring-1 ring-amber-200">
                <Clock className="h-3 w-3" /> Awaiting confirmation
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Comments panel ───────────────────────────────────────────────────────────

function CommentsPanel({ requestId }) {
  const { push } = useToast();
  const [comments, setComments] = useState([]);
  const [text, setText]         = useState('');
  const [sending, setSending]   = useState(false);
  const [open, setOpen]         = useState(false);

  const load = async () => {
    try {
      const data = await api.getRequestComments(requestId);
      setComments(Array.isArray(data) ? data : []);
    } catch {}
  };

  useEffect(() => { if (open) load(); }, [open, requestId]);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await api.addRequestComment(requestId, text.trim());
      setText('');
      load();
    } catch (e) {
      push(e.message || 'Failed to send comment', 'error');
    } finally { setSending(false); }
  };

  return (
    <div className="mt-3 border-t border-neutral-100 pt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-700 font-medium"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        {open ? 'Hide' : 'Show'} Comments
        {comments.length > 0 && !open && (
          <span className="ml-1 h-4 w-4 flex items-center justify-center rounded-full bg-sky-500 text-white text-[10px] font-bold">
            {comments.length}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          {comments.length === 0 ? (
            <p className="text-xs text-neutral-400">No comments yet. Add one below.</p>
          ) : (
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {comments.map(c => {
                const isAdmin = ['admin','administrator','superadmin','hq_admin'].includes((c.author_role||'').toLowerCase());
                return (
                  <div key={c.id} className={`rounded-xl px-3 py-2 text-xs ${isAdmin ? 'bg-emerald-50 border border-emerald-100' : 'bg-sky-50 border border-sky-100'}`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="font-semibold text-neutral-800">{c.author}</span>
                      {isAdmin && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 rounded-full">Admin</span>}
                      <span className="text-neutral-400 ml-auto">{fmtDateTime(c.created_at)}</span>
                    </div>
                    <p className="text-neutral-700">{c.message}</p>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder="Add a comment…"
              className="flex-1 text-xs border border-neutral-200 rounded-xl px-3 py-2 outline-none focus:border-emerald-400"
            />
            <button
              onClick={send} disabled={sending || !text.trim()}
              className="flex items-center gap-1 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-xl disabled:opacity-50 transition"
            >
              <Send className="h-3 w-3" />{sending ? '…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Low Stock Tab ─────────────────────────────────────────────────────────────

function LowStockTab() {
  const { push } = useToast();
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [threshold, setThreshold] = useState('');
  const [editing, setEditing]   = useState(null); // tool id being edited
  const [editVal, setEditVal]   = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getLowStock(threshold !== '' ? Number(threshold) : undefined);
      setItems(Array.isArray(data) ? data : []);
    } catch (e) { push(e.message || 'Failed to load', 'error'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const saveThreshold = async (tool) => {
    try {
      await api.setToolThreshold(tool.id, editVal === '' ? null : Number(editVal));
      push('Threshold updated', 'success');
      setEditing(null);
      load();
    } catch (e) { push(e.message || 'Failed', 'error'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-neutral-600">Custom threshold:</label>
          <input
            type="number" min="0" placeholder="e.g. 10"
            className="w-24 text-sm border border-neutral-200 rounded-xl px-3 py-1.5 outline-none"
            value={threshold}
            onChange={e => setThreshold(e.target.value)}
          />
          <Btn color="neutral" variant="ghost" onClick={load}>Apply</Btn>
        </div>
        <p className="text-xs text-neutral-500 ml-auto">
          Showing {items.length} tool{items.length !== 1 ? 's' : ''} at or below threshold (or zero stock).
        </p>
      </div>

      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 rounded-2xl bg-neutral-100 animate-pulse" />)}</div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-neutral-400">
          <Layers className="h-8 w-8 opacity-40" />
          <p className="text-sm">No low-stock items — all tools are well stocked.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(t => (
            <div key={t.id} className={`rounded-2xl border px-4 py-3 flex items-center gap-4 ${t.quantity === 0 ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50/40'}`}>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-neutral-900">{t.name}</div>
                <div className="text-xs text-neutral-500">{t.category || 'Uncategorized'}</div>
              </div>
              <div className="text-center">
                <div className={`text-xl font-bold ${t.quantity === 0 ? 'text-rose-600' : 'text-amber-700'}`}>{t.quantity}</div>
                <div className="text-[10px] text-neutral-500">in stock</div>
              </div>
              <div className="text-center min-w-[80px]">
                {editing === t.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="number" min="0"
                      value={editVal}
                      onChange={e => setEditVal(e.target.value)}
                      className="w-16 text-xs border border-neutral-300 rounded-lg px-2 py-1 outline-none"
                    />
                    <button onClick={() => saveThreshold(t)} className="text-emerald-600 hover:text-emerald-800">
                      <Check className="h-4 w-4" />
                    </button>
                    <button onClick={() => setEditing(null)} className="text-neutral-400 hover:text-neutral-600">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditing(t.id); setEditVal(t.low_stock_threshold ?? ''); }}
                    className="text-[10px] text-sky-600 hover:text-sky-800 flex items-center gap-1"
                  >
                    <Sliders className="h-3 w-3" />
                    {t.low_stock_threshold != null ? `Alert at ${t.low_stock_threshold}` : 'Set alert'}
                  </button>
                )}
              </div>
              {t.quantity === 0 && (
                <span className="text-[11px] font-bold bg-rose-600 text-white px-2 py-0.5 rounded-full flex-shrink-0">OUT</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Requests tab ─────────────────────────────────────────────────────────────

function RequestsTab({ onNeedRefresh }) {
  const { push } = useToast();
  const [status, setStatus]   = useState('Pending');
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId]   = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft]     = useState({});
  const [rejectId, setRejectId] = useState(null);
  const [search, setSearch]   = useState('');
  const [selected, setSelected] = useState(new Set());
  const [showBatchReject, setShowBatchReject] = useState(false);
  const [batchReason, setBatchReason]         = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.adminRequests(status || undefined);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      push(e.message || 'Failed to load requests', 'error');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [status]);

  const name   = r => r?.user?.name || r?.user?.username || r?.requested_by || r?.requester_name || r?.username || r?.email || '—';
  const fac    = r => r?.user?.facility || r?.facility || r?.facility_name || '—';
  const actor  = r => r?.approved_by?.name || r?.approved_by_name || r?.approvedBy || '';

  const filtered = rows.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return name(r).toLowerCase().includes(q) || fac(r).toLowerCase().includes(q) || String(r.id).includes(q);
  });

  const approve = async (id) => {
    try { await api.adminApproveRequest(id); push('Request approved', 'success'); await load(); onNeedRefresh(); }
    catch (e) { push(e.message || 'Cannot approve — check stock and edit quantities first', 'error'); }
  };

  const del = async (id) => {
    if (!confirm('Delete this pending request?')) return;
    try { await api.adminDeleteRequest(id); push('Deleted', 'success'); await load(); }
    catch (e) { push(e.message || 'Failed to delete', 'error'); }
  };

  const beginEdit = (r) => {
    setEditing(r.id);
    const d = {};
    (r.lines || r.requested_tools || r.items || []).forEach(ln => { d[ln.id] = ln.quantity; });
    setDraft(d);
  };
  const cancelEdit = () => { setEditing(null); setDraft({}); };
  const saveEdit = async (r) => {
    try {
      const lines = (r.lines || r.requested_tools || r.items || []).map(ln => ({
        id: ln.id, quantity: Number(draft[ln.id] ?? ln.quantity),
      }));
      await api.adminEditRequest(r.id, lines);
      push('Request updated', 'success');
      setEditing(null); setDraft({});
      await load();
    } catch (e) { push(e.message || 'Failed to update', 'error'); }
  };

  const toggleSelect = (id) => setSelected(s => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const pendingFiltered = filtered.filter(r => (r.status||'').toLowerCase() === 'pending');
  const allPendingSelected = pendingFiltered.length > 0 && pendingFiltered.every(r => selected.has(r.id));
  const toggleAll = () => {
    if (allPendingSelected) setSelected(new Set());
    else setSelected(new Set(pendingFiltered.map(r => r.id)));
  };

  const batchApprove = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      const res = await api.batchApproveRequests(ids);
      push(`Approved ${res.approved?.length ?? ids.length} request(s)${res.skipped?.length ? `, skipped ${res.skipped.length}` : ''}`, 'success');
      setSelected(new Set());
      await load();
      onNeedRefresh();
    } catch (e) { push(e.message || 'Batch approve failed', 'error'); }
  };

  const batchReject = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      const res = await api.batchRejectRequests(ids, batchReason);
      push(`Rejected ${res.rejected?.length ?? ids.length} request(s)`, 'success');
      setSelected(new Set());
      setBatchReason('');
      setShowBatchReject(false);
      await load();
      onNeedRefresh();
    } catch (e) { push(e.message || 'Batch reject failed', 'error'); }
  };

  const STATUS_TABS = [
    { label: 'Pending', value: 'Pending' },
    { label: 'Approved', value: 'Approved' },
    { label: 'Rejected', value: 'Rejected' },
    { label: 'All', value: '' },
  ];

  return (
    <div className="space-y-4">
      {/* Status pills */}
      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map(t => (
          <button key={t.value}
            onClick={() => setStatus(t.value)}
            className={`px-3.5 py-1.5 rounded-xl text-sm font-medium transition ${
              status === t.value
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50'
            }`}
          >
            {t.label}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="pl-8 pr-3 py-1.5 rounded-xl border border-neutral-200 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 bg-white w-48"
          />
        </div>
      </div>

      {/* Batch toolbar */}
      {status === 'Pending' && pendingFiltered.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={toggleAll} className="flex items-center gap-1.5 text-xs text-neutral-600 hover:text-neutral-900 font-medium">
            {allPendingSelected
              ? <CheckSquare className="h-4 w-4 text-emerald-600" />
              : <Square className="h-4 w-4 text-neutral-400" />}
            {allPendingSelected ? 'Deselect all' : 'Select all pending'}
          </button>
          {selected.size > 0 && (
            <>
              <span className="text-xs text-neutral-500">{selected.size} selected</span>
              <Btn color="emerald" onClick={batchApprove}>
                <Check className="h-3.5 w-3.5" />Approve all
              </Btn>
              <Btn color="rose" onClick={() => setShowBatchReject(true)}>
                <X className="h-3.5 w-3.5" />Reject all
              </Btn>
              <button onClick={() => setSelected(new Set())} className="text-xs text-neutral-400 hover:text-neutral-600 underline">Clear</button>
            </>
          )}
        </div>
      )}

      {/* Batch reject reason dialog */}
      {showBatchReject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4">
            <div className="font-bold text-neutral-900">Reject {selected.size} request{selected.size !== 1 ? 's' : ''}?</div>
            <textarea
              value={batchReason}
              onChange={e => setBatchReason(e.target.value)}
              placeholder="Reason (optional)"
              className="w-full text-sm border border-neutral-200 rounded-xl px-3 py-2 resize-none min-h-[80px] outline-none"
            />
            <div className="flex gap-2 justify-end">
              <Btn variant="ghost" color="neutral" onClick={() => setShowBatchReject(false)}>Cancel</Btn>
              <Btn color="rose" onClick={batchReject}>Confirm Reject</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Cards */}
      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-24 rounded-2xl bg-neutral-100 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-neutral-400">
          <Inbox className="h-10 w-10 opacity-40" />
          <p className="text-sm">{search ? 'No matches found.' : `No ${status.toLowerCase() || ''} requests.`}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(r => {
            const lines = r.lines || r.requested_tools || r.items || [];
            const anyOver = lines.some(ln => (ln.quantity || 0) > (ln.in_stock || 0));
            const open = openId === r.id;
            const isEditing = editing === r.id;

            return (
              <div key={r.id}
                className={`rounded-2xl border overflow-hidden transition-shadow ${open ? 'shadow-md border-neutral-300' : 'shadow-sm border-neutral-200'} bg-white`}
              >
                {/* Card header */}
                <div className="px-4 py-3 flex flex-wrap items-center gap-3">
                  {/* batch checkbox */}
                  {r.status === 'Pending' && (
                    <button
                      onClick={e => { e.stopPropagation(); toggleSelect(r.id); }}
                      className="flex-shrink-0"
                    >
                      {selected.has(r.id)
                        ? <CheckSquare className="h-4 w-4 text-emerald-600" />
                        : <Square className="h-4 w-4 text-neutral-300 hover:text-neutral-500" />}
                    </button>
                  )}
                  {/* expand toggle + id */}
                  <button onClick={() => setOpenId(open ? null : r.id)}
                    className="flex items-center gap-2 text-left group"
                  >
                    <div className="h-8 w-8 rounded-xl bg-neutral-100 group-hover:bg-neutral-200 grid place-items-center transition flex-shrink-0">
                      <ChevronDown className={`h-4 w-4 text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-neutral-900">#{r.id}</div>
                      <div className="text-[11px] text-neutral-400">
                        {fmtDate(r.date_requested)}
                      </div>
                    </div>
                  </button>

                  <StatusBadge status={r.status} />

                  {/* requester */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="h-7 w-7 rounded-full bg-emerald-100 grid place-items-center flex-shrink-0">
                      <User className="h-3.5 w-3.5 text-emerald-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-neutral-900 truncate">{name(r)}</div>
                      <div className="text-[11px] text-neutral-500 truncate flex items-center gap-1">
                        <Building2 className="h-3 w-3" />{fac(r)}
                      </div>
                    </div>
                  </div>

                  {/* summary */}
                  <div className="flex-1 min-w-0 text-xs text-neutral-500">
                    {lines.length} item{lines.length !== 1 ? 's' : ''}
                    {anyOver && (
                      <span className="inline-flex items-center gap-1 ml-2 text-rose-600 font-medium">
                        <AlertTriangle className="h-3.5 w-3.5" />exceeds stock
                      </span>
                    )}
                    {r.status === 'Approved' && r.date_approved && (
                      <span className="ml-2">· Approved {daysSince(r.date_approved)}{actor(r) ? ` by ${actor(r)}` : ''}</span>
                    )}
                    {r.status === 'Rejected' && r.date_rejected && (
                      <span className="ml-2 text-rose-500">· Rejected {daysSince(r.date_rejected)}</span>
                    )}
                  </div>

                  {/* actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
                    {isEditing ? (
                      <>
                        <Btn color="emerald" onClick={() => saveEdit(r)}><Check className="h-3.5 w-3.5" />Save</Btn>
                        <Btn variant="ghost" color="neutral" onClick={cancelEdit}>Cancel</Btn>
                      </>
                    ) : r.status === 'Pending' ? (
                      <>
                        <Btn color="emerald" onClick={() => approve(r.id)} disabled={anyOver}
                          title={anyOver ? 'Edit quantities first — some exceed stock' : 'Approve this request'}>
                          <Check className="h-3.5 w-3.5" />Approve
                        </Btn>
                        <Btn color="rose" onClick={() => setRejectId(r.id)}>
                          <X className="h-3.5 w-3.5" />Reject
                        </Btn>
                        <Btn variant="ghost" color="neutral" onClick={() => beginEdit(r)}>
                          <Pencil className="h-3.5 w-3.5" />Edit
                        </Btn>
                        <Btn variant="ghost" color="rose" onClick={() => del(r.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Btn>
                      </>
                    ) : null}
                  </div>
                </div>

                {/* Expandable line items */}
                <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                  <div className="overflow-hidden">
                    <div className="border-t border-neutral-100 px-4 py-3">
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {lines.map(ln => {
                          const over = (ln.quantity || 0) > (ln.in_stock || 0);
                          return (
                            <li key={ln.id}
                              className={`rounded-xl border px-3 py-2.5 ${over ? 'border-rose-200 bg-rose-50' : 'border-neutral-200 bg-neutral-50'}`}
                            >
                              <div className="flex items-center justify-between gap-2 mb-1.5">
                                <span className="text-sm font-medium text-neutral-900 truncate">{ln.tool_name}</span>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  {ln.is_delivered ? (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">Delivered ✓</span>
                                  ) : r.status === 'Approved' ? (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">Awaiting</span>
                                  ) : null}
                                  {ln.delivery_id && (
                                    <button
                                      onClick={async () => {
                                        try {
                                          const blob = await api.downloadDeliveryNote(ln.delivery_id);
                                          const url = URL.createObjectURL(blob);
                                          Object.assign(document.createElement('a'), {
                                            href: url, download: `delivery_note_${ln.delivery_id}.pdf`,
                                          }).click();
                                          URL.revokeObjectURL(url);
                                        } catch { push('Failed to download', 'error'); }
                                      }}
                                      className="flex items-center gap-1 text-[11px] text-sky-600 hover:text-sky-800 font-medium"
                                    >
                                      <Download className="h-3 w-3" />Note
                                    </button>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center justify-between gap-2">
                                <div className="text-xs text-neutral-500">
                                  Req: <span className="font-semibold text-neutral-700">{ln.quantity}</span>
                                  {' '}· Stock:{' '}
                                  <span className={`font-semibold ${over ? 'text-rose-600' : 'text-emerald-600'}`}>{ln.in_stock ?? 0}</span>
                                </div>
                                {isEditing ? (
                                  <input
                                    type="number" min="1"
                                    value={String(draft[ln.id] ?? ln.quantity)}
                                    onChange={e => setDraft(p => ({ ...p, [ln.id]: e.target.value.replace(/[^\d]/g, '') }))}
                                    className="w-20 rounded-lg border border-neutral-300 text-sm text-right px-2 py-1 outline-none focus:ring-2 focus:ring-emerald-200"
                                  />
                                ) : (
                                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${over ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                    {over ? 'Exceeds stock' : 'OK'}
                                  </span>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>

                      {r.status === 'Rejected' && r.rejection_reason && (
                        <div className="mt-3 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">
                          <span className="font-semibold">Reason:</span> {r.rejection_reason}
                        </div>
                      )}
                      <CommentsPanel requestId={r.id} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {rejectId && (
        <RejectModal
          id={rejectId}
          onClose={() => setRejectId(null)}
          onDone={() => { setRejectId(null); load(); onNeedRefresh(); }}
        />
      )}
    </div>
  );
}

// ─── Root screen ──────────────────────────────────────────────────────────────

export default function AdminScreen() {
  const { push } = useToast();
  const [mainTab, setMainTab] = useState('requests');
  const [pending, setPending] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(true);

  const loadPending = async () => {
    setPendingLoading(true);
    try {
      const data = await api.getPendingDeliveries().catch(() => []);
      setPending(Array.isArray(data) ? data : []);
    } catch { setPending([]); }
    finally { setPendingLoading(false); }
  };

  useEffect(() => { loadPending(); }, []);

  const TABS = [
    { id: 'requests',      label: 'Requests' },
    { id: 'confirmations', label: 'Pending Confirmations', count: pending.length },
    { id: 'lowstock',      label: 'Low Stock' },
  ];

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-emerald-600 text-white grid place-items-center shadow-lg shadow-emerald-200">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-neutral-900">Admin Panel</h1>
            <p className="text-sm text-neutral-500">Manage requests and track delivery confirmations.</p>
          </div>
        </div>
        <Btn variant="ghost" color="neutral" onClick={loadPending}>
          <RefreshCcw className="h-3.5 w-3.5" />Refresh
        </Btn>
      </div>

      {/* Main tabs */}
      <div className="flex gap-1 bg-neutral-100 rounded-2xl p-1 w-fit">
        {TABS.map(t => (
          <button key={t.id}
            onClick={() => setMainTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition ${
              mainTab === t.id
                ? 'bg-white text-neutral-900 shadow-sm'
                : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full leading-tight ${
                mainTab === t.id ? 'bg-amber-100 text-amber-700' : 'bg-neutral-200 text-neutral-600'
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {mainTab === 'requests' && (
        <RequestsTab onNeedRefresh={loadPending} />
      )}

      {mainTab === 'confirmations' && (
        <PendingConfirmationsTab items={pending} loading={pendingLoading} />
      )}

      {mainTab === 'lowstock' && <LowStockTab />}
    </div>
  );
}
