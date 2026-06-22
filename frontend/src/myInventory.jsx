import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from './api';
import { useToast } from './toasts';
import {
  Package, ArrowRightLeft, ClipboardList, Loader2, RefreshCw, Search,
  TrendingDown, ChevronDown, X, Check, AlertTriangle, Plus, Minus,
  History, BarChart2, ChevronRight, ChevronLeft, Calendar,
} from 'lucide-react';

const DEPARTMENTS = [
  { value: 'pharmacy',  label: 'Pharmacy'  },
  { value: 'lab',       label: 'Lab'       },
  { value: 'triage',    label: 'Triage'    },
  { value: 'community', label: 'Community' },
  { value: 'm&e',       label: 'M&E'       },
  { value: 'others',    label: 'Others'    },
];

// ─── Tool picker with search ──────────────────────────────────────────────────

function ToolPicker({ value, onChange, toolsList, loading, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const filtered = (toolsList || []).filter(t =>
    !value || t.name.toLowerCase().includes(value.toLowerCase())
  );

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder || 'Search for a tool…'}
          className="w-full border border-neutral-200 rounded-xl px-4 py-3 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400"
          autoComplete="off"
        />
        {loading
          ? <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-neutral-400" />
          : <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400 pointer-events-none" />
        }
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-52 overflow-y-auto bg-white border border-neutral-200 rounded-xl shadow-lg">
          {filtered.map(t => (
            <button key={t.id} type="button"
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-emerald-50 hover:text-emerald-800 border-b border-neutral-50 last:border-0 transition"
              onClick={() => { onChange(t.name); setOpen(false); }}
            >
              <span className="font-medium">{t.name}</span>
              {t.category && <span className="text-xs text-neutral-400 ml-2">{t.category}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Quantity stepper ─────────────────────────────────────────────────────────

function QtyInput({ value, onChange, min = 0 }) {
  const n = parseInt(value) || 0;
  return (
    <div className="flex items-center gap-0 rounded-xl border border-neutral-200 overflow-hidden w-fit bg-white">
      <button type="button" onClick={() => onChange(Math.max(min, n - 1))}
        disabled={n <= min}
        className="px-3 py-2.5 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 transition text-lg leading-none">−</button>
      <input
        type="number" inputMode="numeric" min={min}
        value={value === '' ? '' : n}
        onChange={e => { const v = e.target.value.replace(/[^\d]/g, ''); onChange(v === '' ? '' : Math.max(min, parseInt(v) || 0)); }}
        className="w-16 text-center text-base font-bold text-neutral-900 bg-transparent outline-none py-2"
      />
      <button type="button" onClick={() => onChange(n + 1)}
        className="px-3 py-2.5 text-neutral-500 hover:bg-neutral-100 transition text-lg leading-none">+</button>
    </div>
  );
}

// ─── Action modal ─────────────────────────────────────────────────────────────

function ActionModal({ mode, toolsList, toolsLoading, onClose, onDone }) {
  const { push } = useToast();
  const [toolName, setToolName] = useState('');
  const [qty, setQty] = useState(1);
  const [dept, setDept] = useState('');
  const [busy, setBusy] = useState(false);

  const findToolId = name =>
    (toolsList.find(t => t.name.toLowerCase() === name.toLowerCase()) || {}).id || null;

  const config = {
    usage: {
      title: 'Record Usage',
      icon: TrendingDown,
      iconBg: 'bg-rose-500',
      description: 'How many did your facility consume or use today?',
      qtyLabel: 'Quantity used',
      submitLabel: 'Record Usage',
      submitColor: 'bg-rose-600 hover:bg-rose-700',
    },
    distribute: {
      title: 'Distribute to Department',
      icon: ArrowRightLeft,
      iconBg: 'bg-blue-500',
      description: 'Send tools from your store to a department.',
      qtyLabel: 'Quantity to distribute',
      submitLabel: 'Record Distribution',
      submitColor: 'bg-blue-600 hover:bg-blue-700',
    },
    count: {
      title: 'Physical Count',
      icon: ClipboardList,
      iconBg: 'bg-violet-500',
      description: 'Count what is physically on your shelf. This is for record-keeping only — it does not change your stock.',
      qtyLabel: 'Actual quantity on shelf',
      submitLabel: 'Submit Count',
      submitColor: 'bg-violet-600 hover:bg-violet-700',
    },
  };

  const c = config[mode];
  const Icon = c.icon;

  const submit = async () => {
    if (!toolName.trim()) { push('Please select a tool', 'error'); return; }
    const toolId = findToolId(toolName.trim());
    if (!toolId) { push('Tool not found — please pick from the list', 'error'); return; }
    const q = parseInt(qty);
    if (isNaN(q) || q < 0) { push('Enter a valid quantity', 'error'); return; }
    if (mode === 'distribute' && !dept) { push('Please select a department', 'error'); return; }

    setBusy(true);
    try {
      if (mode === 'usage') {
        await api.recordUtilization({ tool_id: toolId, quantity_used: q });
        push(`${q} × ${toolName} recorded as used`, 'success');
      } else if (mode === 'distribute') {
        await api.distributeToDepartment({ tool_id: toolId, department: dept, basic_unit: 'unit', quantity: q });
        push(`${q} × ${toolName} distributed to ${DEPARTMENTS.find(d => d.value === dept)?.label}`, 'success');
      } else if (mode === 'count') {
        await api.recordPhysicalCount({ tool_id: toolId, physical_quantity: q });
        push('Physical count saved', 'success');
      }
      onDone();
    } catch (e) {
      push(e.message || 'Something went wrong', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className={`px-5 py-4 flex items-center justify-between text-white ${c.iconBg}`}>
          <div className="flex items-center gap-2.5">
            <Icon className="h-5 w-5" />
            <span className="font-bold text-base">{c.title}</span>
          </div>
          <button onClick={onClose} className="opacity-70 hover:opacity-100 transition"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-neutral-500">{c.description}</p>

          {/* Tool */}
          <div>
            <label className="block text-xs font-bold text-neutral-600 uppercase tracking-wide mb-1.5">Tool *</label>
            <ToolPicker value={toolName} onChange={setToolName} toolsList={toolsList} loading={toolsLoading} />
          </div>

          {/* Department (distribute only) */}
          {mode === 'distribute' && (
            <div>
              <label className="block text-xs font-bold text-neutral-600 uppercase tracking-wide mb-1.5">Department *</label>
              <div className="grid grid-cols-3 gap-2">
                {DEPARTMENTS.map(d => (
                  <button key={d.value} type="button"
                    onClick={() => setDept(d.value)}
                    className={`py-2 rounded-xl text-sm font-semibold border transition ${
                      dept === d.value
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-neutral-700 border-neutral-200 hover:border-blue-300 hover:text-blue-700'
                    }`}
                  >{d.label}</button>
                ))}
              </div>
            </div>
          )}

          {/* Quantity */}
          <div>
            <label className="block text-xs font-bold text-neutral-600 uppercase tracking-wide mb-1.5">{c.qtyLabel}</label>
            <QtyInput value={qty} onChange={setQty} min={0} />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-6 flex gap-3">
          <button type="button" onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-neutral-200 text-neutral-600 text-sm font-semibold hover:bg-neutral-50 transition">
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy}
            className={`flex-1 py-3 rounded-xl text-white text-sm font-bold transition disabled:opacity-50 ${c.submitColor}`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : c.submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Stock card ───────────────────────────────────────────────────────────────

function StockCard({ item }) {
  const qty = (item.qty_received ?? 0) - (item.qty_utilized ?? 0);
  const isOut = qty <= 0;
  const isLow = !isOut && qty < 10;

  return (
    <div className={`rounded-2xl border p-4 flex flex-col gap-2 ${
      isOut ? 'bg-rose-50 border-rose-200' :
      isLow ? 'bg-amber-50 border-amber-200' :
      'bg-white border-neutral-200'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-neutral-900 leading-tight">{item.tool_name}</span>
        {isOut && (
          <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-200 text-rose-700 uppercase tracking-wide">Out</span>
        )}
        {isLow && (
          <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-700 uppercase tracking-wide">Low</span>
        )}
      </div>
      <div className={`text-3xl font-extrabold ${isOut ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-emerald-600'}`}>
        {qty}
      </div>
      <div className="text-[11px] text-neutral-400 space-y-0.5">
        <div>Received: <span className="font-semibold text-neutral-600">{item.qty_received ?? 0}</span></div>
        <div>Used: <span className="font-semibold text-neutral-600">{item.qty_utilized ?? 0}</span></div>
      </div>
    </div>
  );
}

// ─── Trends section (collapsible) ────────────────────────────────────────────

function TrendsSection({ toolsList }) {
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [periodType, setPeriodType] = useState('month');
  const [year, setYear] = useState(new Date().getFullYear());
  const [expanded, setExpanded] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.myStockLongitudinal(periodType, year);
      setData(d);
      const exp = {};
      (d.tools || []).forEach(t => { if ((t.periods || []).length) exp[t.tool_id] = true; });
      setExpanded(exp);
    } catch (e) { push(e.message, 'error'); }
    finally { setLoading(false); }
  }, [push, periodType, year]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const periodOptions = periodType === 'week'
    ? Array.from({ length: 52 }, (_, i) => ({ value: i + 1, label: `Week ${i + 1}` }))
    : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => ({ value: i + 1, label: m }));

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-neutral-50 transition">
        <div className="flex items-center gap-2.5">
          <BarChart2 className="h-5 w-5 text-violet-500" />
          <span className="font-bold text-sm text-neutral-900">Stock Trends</span>
          <span className="text-xs text-neutral-400">— weekly or monthly history</span>
        </div>
        {open ? <ChevronDown className="h-4 w-4 text-neutral-400" /> : <ChevronRight className="h-4 w-4 text-neutral-400" />}
      </button>

      {open && (
        <div className="border-t border-neutral-100">
          {/* Controls */}
          <div className="px-5 py-3 flex flex-wrap items-center gap-3 bg-neutral-50">
            <div className="flex bg-white border border-neutral-200 rounded-xl overflow-hidden">
              {['week','month','quarter'].map(pt => (
                <button key={pt} onClick={() => setPeriodType(pt)}
                  className={`px-3 py-1.5 text-xs font-semibold transition ${periodType === pt ? 'bg-emerald-600 text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}>
                  {pt.charAt(0).toUpperCase() + pt.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setYear(y => y - 1)} className="p-1.5 hover:bg-neutral-200 rounded-lg"><ChevronLeft className="h-4 w-4" /></button>
              <span className="text-sm font-bold text-neutral-700 w-12 text-center">{year}</span>
              <button onClick={() => setYear(y => y + 1)} className="p-1.5 hover:bg-neutral-200 rounded-lg"><ChevronRight className="h-4 w-4" /></button>
            </div>
            <button onClick={load} className="p-1.5 hover:bg-neutral-200 rounded-lg text-neutral-500"><RefreshCw className="h-4 w-4" /></button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10 text-neutral-400"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>
          ) : !data || !data.tools?.length ? (
            <div className="py-10 text-center text-sm text-neutral-400">No trend data for this period.</div>
          ) : (
            <div className="divide-y divide-neutral-50">
              {data.tools.map(tool => {
                const isExp = expanded[tool.tool_id];
                const latest = (tool.periods || []).slice(-1)[0];
                return (
                  <div key={tool.tool_id}>
                    <button onClick={() => setExpanded(e => ({ ...e, [tool.tool_id]: !e[tool.tool_id] }))}
                      className="w-full flex items-center justify-between px-5 py-3 hover:bg-neutral-50 transition text-left">
                      <div className="flex items-center gap-2">
                        {isExp ? <ChevronDown className="h-3.5 w-3.5 text-neutral-400" /> : <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />}
                        <span className="text-sm font-semibold text-neutral-900">{tool.tool_name}</span>
                        <span className="text-xs text-neutral-400">{tool.category}</span>
                      </div>
                      {latest && (
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-emerald-600">+{latest.qty_supplied}</span>
                          <span className="text-rose-500">-{latest.qty_utilized}</span>
                          <span className={`font-bold px-2 py-0.5 rounded-lg ${
                            latest.closing_balance <= 0 ? 'bg-rose-50 text-rose-700' :
                            latest.closing_balance < 10 ? 'bg-amber-50 text-amber-700' :
                            'bg-emerald-50 text-emerald-700'
                          }`}>{latest.closing_balance}</span>
                        </div>
                      )}
                    </button>
                    {isExp && (tool.periods || []).length > 0 && (
                      <div className="overflow-x-auto border-t border-neutral-50">
                        <table className="w-full text-xs">
                          <thead className="bg-neutral-50">
                            <tr>
                              {['Period','Opening','In','Used','Closing'].map(h => (
                                <th key={h} className={`px-4 py-2 text-neutral-500 font-semibold uppercase ${h==='Period'?'text-left':'text-right'}`}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {tool.periods.map((p, i) => (
                              <tr key={i} className="border-t border-neutral-50 hover:bg-neutral-50">
                                <td className="px-4 py-2 font-medium text-neutral-700">{p.label}</td>
                                <td className="px-4 py-2 text-right">{p.opening_balance}</td>
                                <td className="px-4 py-2 text-right text-emerald-600 font-medium">{p.qty_supplied > 0 ? `+${p.qty_supplied}` : '—'}</td>
                                <td className="px-4 py-2 text-right text-rose-500 font-medium">{p.qty_utilized > 0 ? `-${p.qty_utilized}` : '—'}</td>
                                <td className="px-4 py-2 text-right">
                                  <span className={`font-bold px-2 py-0.5 rounded text-xs ${
                                    p.closing_balance <= 0 ? 'bg-rose-50 text-rose-700' :
                                    p.closing_balance < 10 ? 'bg-amber-50 text-amber-700' :
                                    'bg-emerald-50 text-emerald-700'
                                  }`}>{p.closing_balance}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── History section ──────────────────────────────────────────────────────────

function HistorySection() {
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState([]);
  const [dists, setDists] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, d] = await Promise.all([api.myUtilization(), api.myDistributions()]);
      setUsage(Array.isArray(u) ? u : []);
      setDists(Array.isArray(d) ? d : []);
    } catch (e) { push(e.message, 'error'); }
    finally { setLoading(false); }
  }, [push]);

  useEffect(() => { if (open) load(); }, [open, load]);

  // Merge and sort newest-first
  const feed = [
    ...(usage.map(u => ({ type: 'usage', date: u.date_used, tool: u.tool_name, qty: u.quantity_used, note: '' }))),
    ...(dists.map(d => ({ type: 'dist', date: d.created_at || d.date, tool: d.tool_name || '—', qty: d.quantity, note: d.department || '' }))),
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 30);

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-neutral-50 transition">
        <div className="flex items-center gap-2.5">
          <History className="h-5 w-5 text-slate-500" />
          <span className="font-bold text-sm text-neutral-900">Recent Activity</span>
          <span className="text-xs text-neutral-400">— usage & distributions</span>
        </div>
        {open ? <ChevronDown className="h-4 w-4 text-neutral-400" /> : <ChevronRight className="h-4 w-4 text-neutral-400" />}
      </button>

      {open && (
        <div className="border-t border-neutral-100">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-neutral-400"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>
          ) : feed.length === 0 ? (
            <div className="py-10 text-center text-sm text-neutral-400">No activity recorded yet.</div>
          ) : (
            <div className="divide-y divide-neutral-50">
              {feed.map((item, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3">
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    item.type === 'usage' ? 'bg-rose-100' : 'bg-blue-100'
                  }`}>
                    {item.type === 'usage'
                      ? <TrendingDown className="h-3.5 w-3.5 text-rose-600" />
                      : <ArrowRightLeft className="h-3.5 w-3.5 text-blue-600" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold text-neutral-900">{item.tool}</span>
                    <span className={`text-xs ml-2 font-bold ${item.type === 'usage' ? 'text-rose-600' : 'text-blue-600'}`}>
                      -{item.qty}
                    </span>
                    {item.note && <span className="text-xs text-neutral-400 ml-1">→ {item.note}</span>}
                    <p className="text-xs text-neutral-400">
                      {item.type === 'usage' ? 'Used' : 'Distributed'}
                    </p>
                  </div>
                  <span className="text-[11px] text-neutral-400 flex-shrink-0">
                    {item.date ? new Date(item.date).toLocaleDateString() : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function MyInventoryScreen() {
  const { push } = useToast();
  const [stock, setStock] = useState([]);
  const [stockLoading, setStockLoading] = useState(true);
  const [toolsList, setToolsList] = useState([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [modal, setModal] = useState(null); // 'usage' | 'distribute' | 'count' | null
  const [stockSearch, setStockSearch] = useState('');

  const loadStock = useCallback(async () => {
    setStockLoading(true);
    try { setStock(await api.myStock()); }
    catch (e) { push(e.message, 'error'); }
    finally { setStockLoading(false); }
  }, [push]);

  const loadTools = useCallback(async () => {
    setToolsLoading(true);
    try { const d = await api.tools(); setToolsList(Array.isArray(d) ? d : []); }
    catch {}
    finally { setToolsLoading(false); }
  }, []);

  useEffect(() => { loadStock(); loadTools(); }, [loadStock, loadTools]);

  const filteredStock = (stock || []).filter(s =>
    !stockSearch || (s.tool_name || '').toLowerCase().includes(stockSearch.toLowerCase())
  );

  const outOfStock = filteredStock.filter(s => (s.qty_received ?? 0) - (s.qty_utilized ?? 0) <= 0).length;
  const lowStock   = filteredStock.filter(s => { const q = (s.qty_received ?? 0) - (s.qty_utilized ?? 0); return q > 0 && q < 10; }).length;

  return (
    <div className="space-y-5 pb-8">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-emerald-600 text-white grid place-items-center shadow-lg shadow-emerald-200">
            <Package className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-neutral-900">My Inventory</h1>
            <p className="text-sm text-neutral-500">Track your facility's tools and record activity</p>
          </div>
        </div>
        <button onClick={loadStock} className="p-2 hover:bg-neutral-100 rounded-xl text-neutral-500 mt-1" title="Refresh stock">
          <RefreshCw className={`h-4 w-4 ${stockLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* ── Quick alerts ── */}
      {(outOfStock > 0 || lowStock > 0) && (
        <div className="flex flex-wrap gap-2">
          {outOfStock > 0 && (
            <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-rose-500 flex-shrink-0" />
              <span className="text-xs font-semibold text-rose-700">{outOfStock} tool{outOfStock > 1 ? 's' : ''} out of stock</span>
            </div>
          )}
          {lowStock > 0 && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
              <span className="text-xs font-semibold text-amber-700">{lowStock} tool{lowStock > 1 ? 's' : ''} running low</span>
            </div>
          )}
        </div>
      )}

      {/* ── 3 Action buttons ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { mode: 'usage',      label: 'Record Usage',       sub: 'We used or consumed tools',  Icon: TrendingDown,    bg: 'bg-rose-50',   border: 'border-rose-200',   icon: 'text-rose-600',   btn: 'bg-rose-600 hover:bg-rose-700' },
          { mode: 'distribute', label: 'Distribute',         sub: 'Send to a department',       Icon: ArrowRightLeft,  bg: 'bg-blue-50',   border: 'border-blue-200',   icon: 'text-blue-600',   btn: 'bg-blue-600 hover:bg-blue-700' },
          { mode: 'count',      label: 'Physical Count',     sub: 'Count what is on the shelf', Icon: ClipboardList,   bg: 'bg-violet-50', border: 'border-violet-200', icon: 'text-violet-600', btn: 'bg-violet-600 hover:bg-violet-700' },
        ].map(({ mode, label, sub, Icon, bg, border, icon, btn }) => (
          <button key={mode} onClick={() => setModal(mode)}
            className={`${bg} ${border} border rounded-2xl p-4 text-left hover:shadow-md hover:-translate-y-0.5 transition group flex flex-col gap-2`}>
            <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${btn.split(' ')[0]} group-hover:scale-105 transition`}>
              <Icon className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-neutral-900">{label}</p>
              <p className="text-xs text-neutral-500 mt-0.5 leading-tight">{sub}</p>
            </div>
          </button>
        ))}
      </div>

      {/* ── Current stock grid ── */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between gap-3">
          <h2 className="font-bold text-neutral-900 text-sm">Current Stock</h2>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
            <input
              type="text"
              value={stockSearch}
              onChange={e => setStockSearch(e.target.value)}
              placeholder="Search tools…"
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-neutral-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200"
            />
          </div>
        </div>

        {stockLoading ? (
          <div className="flex items-center justify-center py-12 text-neutral-400">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading stock…
          </div>
        ) : filteredStock.length === 0 ? (
          <div className="py-12 text-center text-sm text-neutral-400">
            <Package className="h-10 w-10 text-neutral-200 mx-auto mb-3" />
            {stockSearch ? 'No tools match your search' : 'No stock yet — stock updates automatically when you confirm a delivery'}
          </div>
        ) : (
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filteredStock.map(s => <StockCard key={s.tool_id} item={s} />)}
          </div>
        )}
      </div>

      {/* ── Collapsible: Trends ── */}
      <TrendsSection toolsList={toolsList} />

      {/* ── Collapsible: History ── */}
      <HistorySection />

      {/* ── Modal ── */}
      {modal && (
        <ActionModal
          mode={modal}
          toolsList={toolsList}
          toolsLoading={toolsLoading}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); loadStock(); }}
        />
      )}
    </div>
  );
}
