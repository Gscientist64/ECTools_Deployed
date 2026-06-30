import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { fmtDate, fmtDateTime } from './utils';
import {
  Search, ClipboardList, Minus, Plus, Send, CheckCircle,
  Download, PackageCheck, ChevronDown, ShoppingCart, X,
  Clock, AlertCircle, Inbox,
} from 'lucide-react';
import { useToast } from './toasts';

// ─── tiny shared primitives ───────────────────────────────────────────────────

function StatusBadge({ status }) {
  const map = {
    Approved:  'bg-emerald-100 text-emerald-700 ring-emerald-200',
    Rejected:  'bg-rose-100    text-rose-700    ring-rose-200',
    Pending:   'bg-amber-100   text-amber-700   ring-amber-200',
    Delivered: 'bg-blue-100    text-blue-700    ring-blue-200',
  };
  const cls = map[status] ?? 'bg-neutral-100 text-neutral-600 ring-neutral-200';
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ring-1 ${cls}`}>
      {status === 'Approved'  && <CheckCircle className="h-3 w-3" />}
      {status === 'Rejected'  && <AlertCircle className="h-3 w-3" />}
      {status === 'Pending'   && <Clock className="h-3 w-3" />}
      {status}
    </span>
  );
}

function Stepper({ value, onChange }) {
  const n = parseInt(value || 0, 10);
  return (
    <div className="flex items-center gap-0 rounded-xl border border-neutral-200 bg-white overflow-hidden w-fit">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, n - 1))}
        className="px-2.5 py-1.5 text-neutral-500 hover:bg-neutral-100 transition-colors disabled:opacity-40"
        disabled={n === 0}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <input
        inputMode="numeric"
        value={value === '' ? '' : n}
        onChange={(e) => {
          const d = e.target.value.replace(/[^\d]/g, '');
          onChange(d === '' ? '' : Math.max(0, parseInt(d, 10)));
        }}
        className="w-10 text-center text-sm font-semibold text-neutral-900 bg-transparent outline-none py-1.5"
        placeholder="0"
      />
      <button
        type="button"
        onClick={() => onChange(n + 1)}
        className="px-2.5 py-1.5 text-neutral-500 hover:bg-neutral-100 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Delivery confirmation dialog ─────────────────────────────────────────────

function DeliveryDialog({ open, lines, onConfirm, onClose }) {
  const [witnessedBy, setWitnessedBy] = useState('');
  const [basicUnit, setBasicUnit] = useState('unit');
  const [actualQtys, setActualQtys] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const { push } = useToast();

  // Pre-fill actual qtys from approved lines whenever dialog opens
  useEffect(() => {
    if (open && lines?.length) {
      const init = {};
      lines.forEach(ln => { init[ln.id] = ln.quantity; });
      setActualQtys(init);
      setWitnessedBy('');
      setBasicUnit('unit');
    }
  }, [open, lines]);

  if (!open) return null;

  const setQty = (id, val) => {
    const n = Math.max(0, parseInt(val) || 0);
    setActualQtys(q => ({ ...q, [id]: n }));
  };

  const handle = async () => {
    setSubmitting(true);
    try {
      await onConfirm(witnessedBy, basicUnit, actualQtys);
      push('Delivery confirmed — stock updated', 'success');
      onClose();
    } catch (err) {
      push(err.message || 'Failed to confirm delivery', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-neutral-200 overflow-hidden">
        {/* Header */}
        <div className="bg-emerald-600 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <PackageCheck className="h-5 w-5" />
            <span className="font-semibold">Confirm Delivery Receipt</span>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Per-item actual quantities */}
          <div>
            <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">
              Actual Quantities Received
            </p>
            <p className="text-xs text-neutral-400 mb-3">
              Enter the quantity that physically arrived. If an item arrived short or was damaged, update the number below.
            </p>
            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
              {(lines || []).map(ln => (
                <div key={ln.id} className="flex items-center justify-between gap-3 bg-neutral-50 rounded-xl px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-neutral-900 truncate block">{ln.tool_name}</span>
                    <span className="text-xs text-neutral-400">Approved: {ln.quantity}</span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button type="button" onClick={() => setQty(ln.id, (actualQtys[ln.id] || 0) - 1)}
                      className="h-7 w-7 rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-100 flex items-center justify-center text-sm">−</button>
                    <input
                      type="number" min="0"
                      value={actualQtys[ln.id] ?? ln.quantity}
                      onChange={e => setQty(ln.id, e.target.value)}
                      className={`w-14 text-center text-sm font-semibold rounded-lg border px-1 py-1 outline-none ${
                        (actualQtys[ln.id] ?? ln.quantity) < ln.quantity
                          ? 'border-amber-400 bg-amber-50 text-amber-700'
                          : 'border-neutral-200 bg-white text-neutral-900'
                      }`}
                    />
                    <button type="button" onClick={() => setQty(ln.id, (actualQtys[ln.id] || 0) + 1)}
                      className="h-7 w-7 rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-100 flex items-center justify-center text-sm">+</button>
                  </div>
                </div>
              ))}
            </div>
            {(lines || []).some(ln => (actualQtys[ln.id] ?? ln.quantity) < ln.quantity) && (
              <p className="text-xs text-amber-600 mt-2 bg-amber-50 rounded-lg px-3 py-2">
                Some quantities are below the approved amount. The difference will be noted on the delivery record.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Basic Unit</label>
            <select
              value={basicUnit}
              onChange={(e) => setBasicUnit(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            >
              {['unit', 'register', 'booklet', 'pack'].map(u => (
                <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
              Witnessed By <span className="text-neutral-400 font-normal normal-case">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="Full name of witness"
              value={witnessedBy}
              onChange={(e) => setWitnessedBy(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handle}
              disabled={submitting}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 text-sm transition-colors disabled:opacity-60"
            >
              <CheckCircle className="h-4 w-4" />
              {submitting ? 'Confirming…' : 'Confirm Receipt'}
            </button>
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-4 rounded-xl border border-neutral-200 text-neutral-600 hover:bg-neutral-50 text-sm font-medium transition-colors disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function RequestScreen() {
  const { push } = useToast();
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [qty, setQty] = useState({});
  const [search, setSearch] = useState('');
  const [openCat, setOpenCat] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [myReqs, setMyReqs] = useState([]);
  const [openReqId, setOpenReqId] = useState(null);
  const [dialog, setDialog] = useState({ open: false, requestId: null, lines: [] });

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    try {
      const [cat, reqs] = await Promise.all([
        api.catalog().catch(() => []),
        loadReqs(),
      ]);
      const filtered = (Array.isArray(cat) ? cat : []).filter(
        c => !['Office Supplies', 'Cleaning', 'Furniture'].includes(c?.category ?? c?.name ?? '')
      );
      setCatalog(filtered);
      setMyReqs(Array.isArray(reqs) ? reqs : []);
      if (filtered.length > 0) setOpenCat(filtered[0].id ?? filtered[0].name ?? 0);
    } finally {
      setLoading(false);
    }
  }

  async function loadReqs() {
    try {
      const [reqs, deliveries] = await Promise.all([
        api.myRequests(),
        api.getMyDeliveries().catch(() => []),
      ]);
      const dmap = new Map((deliveries || []).map(d => [d.requested_tool_id, d]));
      return reqs.map(r => ({
        ...r,
        lines: (r.lines || r.requested_tools || []).map(ln => ({
          ...ln,
          isDelivered: dmap.get(ln.id)?.is_delivered || false,
          deliveryId: dmap.get(ln.id)?.delivery_id,
          canConfirm: dmap.has(ln.id) ? !dmap.get(ln.id).is_delivered : true,
        })),
      }));
    } catch { return []; }
  }

  const setToolQty = (id, val) => setQty(q => ({ ...q, [id]: val }));

  const items = useMemo(() => {
    const out = [];
    for (const cat of catalog) {
      for (const t of (cat.tools || [])) {
        const v = qty[t.id];
        if (v && Number(v) > 0) out.push({ tool_id: t.id, tool_name: t.name, quantity: Number(v) });
      }
    }
    return out;
  }, [qty, catalog]);

  // filtered catalog for search
  const displayCatalog = useMemo(() => {
    if (!search.trim()) return catalog;
    const q = search.toLowerCase();
    return catalog
      .map(cat => ({ ...cat, tools: (cat.tools || []).filter(t => t.name?.toLowerCase().includes(q)) }))
      .filter(cat => cat.tools.length > 0);
  }, [catalog, search]);

  async function submit() {
    if (!items.length) return push('Add at least one tool quantity', 'error');
    setSubmitting(true);
    try {
      const res = await api.createRequest(items.map(({ tool_id, quantity }) => ({ tool_id, quantity })));
      setMyReqs(cur => [{
        id: res?.request_id ?? Math.random().toString(36).slice(2),
        status: 'Pending',
        date_requested: new Date().toISOString(),
        lines: items.map(({ tool_id, tool_name, quantity }) => ({
          id: Math.random().toString(36).slice(2),
          tool_id, tool_name, quantity, status: 'Pending', isDelivered: false,
        })),
      }, ...cur]);
      push('Request submitted successfully', 'success');
      setQty({});
      loadReqs().then(setMyReqs);
    } catch (e) {
      push(e.message || 'Failed to submit request', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDelivery(requestId, witnessedBy, basicUnit, actualQtys) {
    await api.confirmRequestDelivery(requestId, witnessedBy, basicUnit, actualQtys);
    const fresh = await loadReqs();
    setMyReqs(fresh);
    if (window.confirm('Delivery confirmed! Download the delivery note now?')) {
      await downloadRequestNote(requestId);
    }
  }

  async function downloadRequestNote(requestId) {
    try {
      const blob = await api.downloadRequestDeliveryNote(requestId);
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: `delivery_note_req_${requestId}.pdf` }).click();
      URL.revokeObjectURL(url);
      push('Delivery note downloaded', 'success');
    } catch { push('Failed to download delivery note', 'error'); }
  }

  const catKey = c => c.id ?? c.name ?? c.category;
  const catName = c => (c.category ?? c.name ?? '').trim();

  // selected qty per category
  const selCount = c => (c.tools || []).reduce((s, t) => s + (Number(qty[t.id]) > 0 ? 1 : 0), 0);

  return (
    <div className="space-y-6 pb-8">
      <DeliveryDialog
        open={dialog.open}
        lines={dialog.lines}
        onConfirm={(w, u, qtys) => confirmDelivery(dialog.requestId, w, u, qtys)}
        onClose={() => setDialog({ open: false, requestId: null, lines: [] })}
      />

      {/* ── Page header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-emerald-600 text-white grid place-items-center shadow-lg shadow-emerald-200">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-neutral-900">Tool Requests</h1>
            <p className="text-sm text-neutral-500">Select tools, set quantities, and submit a request.</p>
          </div>
        </div>
      </div>

      {/* ── Main grid ── */}
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">

        {/* LEFT — Catalog */}
        <div className="space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search tools…"
              className="w-full rounded-xl border border-neutral-200 bg-white pl-10 pr-4 py-2.5 text-sm text-neutral-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition shadow-sm"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Categories */}
          {loading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => (
                <div key={i} className="h-14 rounded-2xl bg-neutral-100 animate-pulse" />
              ))}
            </div>
          ) : displayCatalog.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-neutral-400">
              <Inbox className="h-10 w-10" />
              <p className="text-sm">{search ? 'No tools match your search.' : 'No categories found.'}</p>
            </div>
          ) : (
            displayCatalog.map((cat, idx) => {
              const key = catKey(cat);
              const name = catName(cat);
              const tools = cat.tools || [];
              const open = openCat === key;
              const sel = selCount(cat);

              return (
                <div key={key}
                  className={`rounded-2xl border overflow-hidden transition-shadow ${
                    open ? 'border-emerald-300 shadow-md shadow-emerald-50' : 'border-neutral-200 shadow-sm'
                  } bg-white`}
                >
                  {/* Category header */}
                  <button
                    type="button"
                    onClick={() => setOpenCat(open ? null : key)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-neutral-50 transition-colors text-left"
                  >
                    {/* color accent */}
                    <div className={`w-1 h-8 rounded-full flex-shrink-0 ${open ? 'bg-emerald-500' : 'bg-neutral-200'}`} />
                    <div className="flex-1 min-w-0">
                      <div className={`font-semibold text-sm ${open ? 'text-emerald-700' : 'text-neutral-800'}`}>{name}</div>
                      <div className="text-xs text-neutral-400">{tools.length} tool{tools.length !== 1 ? 's' : ''}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {sel > 0 && (
                        <span className="text-[11px] font-bold bg-emerald-500 text-white rounded-full px-2 py-0.5 leading-tight">
                          {sel} selected
                        </span>
                      )}
                      <ChevronDown className={`h-4 w-4 text-neutral-400 transition-transform ${open ? 'rotate-180 text-emerald-500' : ''}`} />
                    </div>
                  </button>

                  {/* Tools grid */}
                  <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                    <div className="overflow-hidden">
                      <div className="border-t border-neutral-100 px-4 py-3">
                        {tools.length === 0 ? (
                          <p className="text-sm text-neutral-400 py-2">No tools in this category.</p>
                        ) : (
                          <ul className="grid gap-2 sm:grid-cols-2">
                            {tools.map(t => {
                              const v = qty[t.id] ?? '';
                              const active = Number(v) > 0;
                              return (
                                <li key={t.id ?? t.name}
                                  className={`rounded-xl border p-3 transition-colors ${
                                    active
                                      ? 'border-emerald-300 bg-emerald-50'
                                      : 'border-neutral-200 bg-neutral-50/60 hover:border-neutral-300 hover:bg-white'
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-2 mb-2.5">
                                    <div className="min-w-0">
                                      <div className={`text-sm font-semibold leading-tight truncate ${active ? 'text-emerald-800' : 'text-neutral-800'}`}>
                                        {t.name}
                                      </div>
                                      {t.description && (
                                        <div className="text-[11px] text-neutral-400 mt-0.5 line-clamp-1">{t.description}</div>
                                      )}
                                    </div>
                                    {active && (
                                      <CheckCircle className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                                    )}
                                  </div>
                                  <Stepper value={v} onChange={val => setToolQty(t.id, val)} />
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* RIGHT — Cart */}
        <div className="lg:sticky lg:top-4 h-max">
          <div className={`rounded-2xl border overflow-hidden shadow-lg transition-all ${
            items.length > 0 ? 'border-emerald-300 shadow-emerald-100' : 'border-neutral-200'
          } bg-white`}>
            {/* Cart header */}
            <div className={`px-4 py-3.5 flex items-center justify-between border-b ${
              items.length > 0 ? 'bg-emerald-600 border-emerald-500' : 'bg-neutral-50 border-neutral-200'
            }`}>
              <div className="flex items-center gap-2">
                <ShoppingCart className={`h-4 w-4 ${items.length > 0 ? 'text-white' : 'text-neutral-500'}`} />
                <span className={`font-semibold text-sm ${items.length > 0 ? 'text-white' : 'text-neutral-700'}`}>
                  Request Cart
                </span>
              </div>
              {items.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold bg-white/20 text-white rounded-full px-2 py-0.5">
                    {items.length} item{items.length !== 1 ? 's' : ''}
                  </span>
                  <button
                    onClick={() => setQty({})}
                    className="text-white/70 hover:text-white transition-colors"
                    title="Clear cart"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Cart body */}
            <div className="p-4">
              {items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-neutral-400">
                  <ShoppingCart className="h-8 w-8 opacity-40" />
                  <p className="text-sm text-center">Your cart is empty.<br />Set a quantity on any tool to add it.</p>
                </div>
              ) : (
                <ul className="space-y-1.5 max-h-[36vh] overflow-auto pr-1 mb-4">
                  {items.map(it => (
                    <li key={it.tool_id} className="flex items-center justify-between gap-2 rounded-xl bg-neutral-50 border border-neutral-100 px-3 py-2">
                      <span className="text-sm text-neutral-800 font-medium truncate">{it.tool_name}</span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-0.5">
                          ×{it.quantity}
                        </span>
                        <button
                          onClick={() => setToolQty(it.tool_id, 0)}
                          className="text-neutral-300 hover:text-rose-500 transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <button
                onClick={submit}
                disabled={submitting || items.length === 0}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold py-2.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="h-4 w-4" />
                {submitting ? 'Submitting…' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── My Recent Requests ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-neutral-900">My Recent Requests</h2>
          {myReqs.length > 0 && (
            <span className="text-xs bg-neutral-100 text-neutral-600 font-semibold rounded-full px-2 py-0.5">
              {myReqs.length}
            </span>
          )}
        </div>

        {myReqs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 rounded-2xl border border-dashed border-neutral-200 text-neutral-400">
            <Inbox className="h-8 w-8 opacity-40" />
            <p className="text-sm">No requests submitted yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {myReqs.map(r => {
              const open = openReqId === r.id;
              const lines = r.lines || r.requested_tools || [];
              return (
                <div key={r.id}
                  className={`rounded-2xl border overflow-hidden transition-shadow ${
                    open ? 'border-neutral-300 shadow-md' : 'border-neutral-200 shadow-sm'
                  } bg-white`}
                >
                  {/* Request row header */}
                  <button
                    type="button"
                    onClick={() => setOpenReqId(open ? null : r.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 transition-colors text-left"
                  >
                    <ChevronDown className={`h-4 w-4 text-neutral-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`} />
                    <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-neutral-800">Request #{r.id}</span>
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="text-[11px] text-neutral-400 flex-shrink-0">
                      {fmtDate(r.date_requested)}
                    </div>
                  </button>

                  {/* Request body */}
                  <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                    <div className="overflow-hidden">
                      <div className="border-t border-neutral-100 px-4 py-3 space-y-3">
                        {/* Line items — read-only status display */}
                        <ul className="grid gap-2 sm:grid-cols-2">
                          {lines.map(ln => (
                            <li key={ln.id}
                              className={`rounded-xl border px-3 py-2.5 ${
                                ln.isDelivered
                                  ? 'border-emerald-200 bg-emerald-50'
                                  : 'border-neutral-200 bg-neutral-50'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="text-sm font-medium text-neutral-900 truncate">{ln.tool_name}</span>
                                <span className="text-xs font-bold text-neutral-600 flex-shrink-0">×{ln.quantity}</span>
                              </div>
                              <StatusBadge status={ln.isDelivered ? 'Delivered' : ln.status} />
                            </li>
                          ))}
                        </ul>

                        {/* Per-request actions */}
                        {(() => {
                          const approvedLines = lines.filter(ln => ln.status === 'Approved');
                          const allDelivered = approvedLines.length > 0 && approvedLines.every(ln => ln.isDelivered);
                          const noneDelivered = approvedLines.every(ln => !ln.isDelivered);
                          const showConfirm = r.status === 'Approved' && approvedLines.length > 0 && !allDelivered;
                          const showDownload = allDelivered;
                          return (showConfirm || showDownload) ? (
                            <div className="flex items-center gap-2 pt-1">
                              {showConfirm && (
                                <button
                                  onClick={() => setDialog({ open: true, requestId: r.id, lines: approvedLines })}
                                  className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
                                >
                                  <CheckCircle className="h-4 w-4" />
                                  Confirm Receipt of All Items
                                </button>
                              )}
                              {showDownload && (
                                <button
                                  onClick={() => downloadRequestNote(r.id)}
                                  className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-700 transition-colors"
                                >
                                  <Download className="h-4 w-4" />
                                  Download Delivery Note
                                </button>
                              )}
                            </div>
                          ) : null;
                        })()}

                        {/* metadata */}
                        {(r.status === 'Approved' && r.date_approved) && (
                          <p className="text-[11px] text-neutral-400">
                            Approved {fmtDateTime(r.date_approved)}
                          </p>
                        )}
                        {(r.status === 'Rejected' && r.date_rejected) && (
                          <p className="text-[11px] text-rose-500">
                            Rejected {fmtDateTime(r.date_rejected)}
                            {r.rejection_reason ? ` — ${r.rejection_reason}` : ''}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
