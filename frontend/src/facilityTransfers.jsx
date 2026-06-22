import React, { useEffect, useState, useCallback } from 'react';
import { api } from './api';
import { useToast } from './toasts';
import {
  ArrowRightLeft, ArrowRight, ArrowLeft, Plus, X, RefreshCcw,
  Check, Clock, AlertCircle, CheckCircle, XCircle, Search,
} from 'lucide-react';

// ─── helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const map = {
    pending:   { cls: 'bg-amber-100  text-amber-800  ring-amber-200',  Icon: Clock },
    accepted:  { cls: 'bg-emerald-100 text-emerald-700 ring-emerald-200', Icon: CheckCircle },
    rejected:  { cls: 'bg-rose-100   text-rose-700   ring-rose-200',   Icon: XCircle },
    cancelled: { cls: 'bg-neutral-100 text-neutral-600 ring-neutral-200', Icon: AlertCircle },
  };
  const { cls, Icon } = map[status] ?? map.cancelled;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ring-1 ${cls}`}>
      <Icon className="h-3 w-3" />{status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function ago(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ─── Initiate transfer modal ──────────────────────────────────────────────────

function InitiateModal({ tools, onClose, onDone }) {
  const { push } = useToast();
  const [form, setForm] = useState({ tool_id: '', quantity: 1, to_facility: '', notes: '' });
  const [facilities, setFacilities] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.adminFacilities().then(d => setFacilities(Array.isArray(d) ? d : d.facilities || [])).catch(() => {});
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.tool_id || !form.to_facility || !form.quantity) {
      push('Fill in all required fields', 'error'); return;
    }
    setBusy(true);
    try {
      await api.initiateTransfer({
        tool_id:     parseInt(form.tool_id),
        quantity:    parseInt(form.quantity),
        to_facility: form.to_facility,
        notes:       form.notes,
      });
      push('Transfer initiated successfully', 'success');
      onDone();
    } catch (e) {
      push(e.message || 'Failed to initiate transfer', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md z-10">
        <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-neutral-900">
            <ArrowRightLeft className="h-4 w-4 text-emerald-600" />
            Initiate Transfer
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-neutral-600 mb-1">Tool *</label>
            <select
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm"
              value={form.tool_id}
              onChange={e => set('tool_id', e.target.value)}
            >
              <option value="">Select tool…</option>
              {tools.map(t => (
                <option key={t.id} value={t.id}>{t.name} (stock: {t.quantity ?? '?'})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-neutral-600 mb-1">Quantity *</label>
            <input
              type="number" min="1"
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm"
              value={form.quantity}
              onChange={e => set('quantity', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-neutral-600 mb-1">To Facility *</label>
            <select
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm"
              value={form.to_facility}
              onChange={e => set('to_facility', e.target.value)}
            >
              <option value="">Select facility…</option>
              {(Array.isArray(facilities) ? facilities : []).map(f => {
                const name = typeof f === 'string' ? f : f.name || f.facility || f;
                return <option key={name} value={name}>{name}</option>;
              })}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-neutral-600 mb-1">Notes (optional)</label>
            <textarea
              rows={2}
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm resize-none"
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
            />
          </div>
        </div>
        <div className="px-5 pb-5 flex justify-end gap-2">
          <button onClick={onClose} className="text-sm text-neutral-500 hover:text-neutral-700 px-4 py-2 border border-neutral-200 rounded-xl">Cancel</button>
          <button
            onClick={submit}
            disabled={busy}
            className="text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl disabled:opacity-50 transition"
          >
            {busy ? 'Sending…' : 'Send Transfer'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Transfer card ────────────────────────────────────────────────────────────

function TransferCard({ t, mode, onAccept, onReject, onCancel }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold text-neutral-900">{t.tool_name}</span>
            <StatusBadge status={t.status} />
          </div>
          <div className="flex items-center gap-1 text-xs text-neutral-500 mb-1">
            <span className="font-medium text-neutral-700">{t.from_facility}</span>
            <ArrowRight className="h-3 w-3" />
            <span className="font-medium text-neutral-700">{t.to_facility}</span>
          </div>
          <div className="text-xs text-neutral-500">
            Qty: <span className="font-semibold text-neutral-800">{t.quantity}</span>
            {t.notes && <> · {t.notes}</>}
          </div>
          <div className="text-[10px] text-neutral-400 mt-1">
            By {t.initiated_by} · {ago(t.created_at)}
            {t.responded_by && ` · Responded by ${t.responded_by}`}
          </div>
        </div>

        {/* Action buttons */}
        {mode === 'incoming' && t.status === 'pending' && (
          <div className="flex gap-1.5 flex-shrink-0">
            <button
              onClick={() => onAccept(t.id)}
              className="flex items-center gap-1 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-xl transition"
            >
              <Check className="h-3 w-3" /> Accept
            </button>
            <button
              onClick={() => onReject(t.id)}
              className="flex items-center gap-1 text-xs font-semibold bg-rose-100 hover:bg-rose-200 text-rose-700 px-2.5 py-1.5 rounded-xl transition"
            >
              <X className="h-3 w-3" /> Reject
            </button>
          </div>
        )}
        {mode === 'outgoing' && t.status === 'pending' && (
          <button
            onClick={() => onCancel(t.id)}
            className="flex items-center gap-1 text-xs font-semibold text-neutral-500 hover:text-rose-600 border border-neutral-200 hover:border-rose-300 px-2.5 py-1.5 rounded-xl transition flex-shrink-0"
          >
            <X className="h-3 w-3" /> Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'incoming', label: 'Incoming', Icon: ArrowLeft },
  { id: 'outgoing', label: 'Outgoing', Icon: ArrowRight },
];

export default function FacilityTransfersScreen() {
  const { push } = useToast();
  const [tab, setTab]           = useState('incoming');
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [tools, setTools]       = useState([]);
  const [search, setSearch]     = useState('');
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [inc, out, tls] = await Promise.all([
        api.incomingTransfers(),
        api.outgoingTransfers(),
        api.tools(),
      ]);
      setIncoming(Array.isArray(inc) ? inc : []);
      setOutgoing(Array.isArray(out) ? out : []);
      setTools(Array.isArray(tls) ? tls : tls?.tools || []);
    } catch (e) {
      push(e.message || 'Failed to load transfers', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const accept = async (id) => {
    try {
      await api.acceptTransfer(id);
      push('Transfer accepted — stock updated', 'success');
      load();
    } catch (e) { push(e.message || 'Failed to accept', 'error'); }
  };

  const reject = async (id) => {
    try {
      await api.rejectTransfer(id);
      push('Transfer rejected', 'info');
      load();
    } catch (e) { push(e.message || 'Failed to reject', 'error'); }
  };

  const cancel = async (id) => {
    try {
      await api.cancelTransfer(id);
      push('Transfer cancelled', 'info');
      load();
    } catch (e) { push(e.message || 'Failed to cancel', 'error'); }
  };

  const list = (tab === 'incoming' ? incoming : outgoing).filter(t =>
    !search || t.tool_name?.toLowerCase().includes(search.toLowerCase()) ||
    t.from_facility?.toLowerCase().includes(search.toLowerCase()) ||
    t.to_facility?.toLowerCase().includes(search.toLowerCase())
  );

  const pendingIn = incoming.filter(t => t.status === 'pending').length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-emerald-600" />
            Facility Transfers
          </h1>
          <p className="text-sm text-neutral-500 mt-0.5">Send tools to or receive tools from another facility</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="p-2 rounded-xl border border-neutral-200 text-neutral-500 hover:text-neutral-700 transition"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl transition"
          >
            <Plus className="h-4 w-4" /> New Transfer
          </button>
        </div>
      </div>

      {/* Tabs + Search */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex bg-neutral-100 rounded-2xl p-1 gap-1">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-sm font-semibold transition ${
                tab === id ? 'bg-white shadow text-neutral-900' : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {id === 'incoming' && pendingIn > 0 && (
                <span className="ml-1 h-4 w-4 flex items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-bold">
                  {pendingIn}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
          <input
            className="w-full pl-8 pr-3 py-2 text-sm border border-neutral-200 rounded-xl focus:outline-none"
            placeholder="Search tool or facility…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12 text-neutral-400">
          <RefreshCcw className="h-5 w-5 animate-spin mr-2" /> Loading…
        </div>
      ) : list.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm py-16 text-center">
          <ArrowRightLeft className="h-8 w-8 text-neutral-300 mx-auto mb-3" />
          <p className="text-sm text-neutral-500">
            {search ? 'No transfers match your search' : `No ${tab} transfers`}
          </p>
          {tab === 'outgoing' && !search && (
            <button
              onClick={() => setShowModal(true)}
              className="mt-3 text-xs text-emerald-600 hover:underline"
            >
              Initiate your first transfer →
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {list.map(t => (
            <TransferCard
              key={t.id}
              t={t}
              mode={tab}
              onAccept={accept}
              onReject={reject}
              onCancel={cancel}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <InitiateModal
          tools={tools}
          onClose={() => setShowModal(false)}
          onDone={() => { setShowModal(false); load(); }}
        />
      )}
    </div>
  );
}
