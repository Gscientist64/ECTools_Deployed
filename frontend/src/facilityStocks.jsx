import React, { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import { useToast } from './toasts';
import {
  Building2, Package, Loader2, RefreshCw, Search,
  ChevronLeft, ArrowRightLeft, TrendingDown, AlertTriangle,
} from 'lucide-react';

// ─── Facility summary card (list view) ───────────────────────────────────────

function FacilityCard({ facility, totalStock, toolsWithStock, onClick }) {
  return (
    <button
      onClick={onClick}
      className="bg-white border border-neutral-200 rounded-2xl p-4 text-left hover:shadow-md hover:-translate-y-0.5 transition group w-full"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="h-9 w-9 rounded-xl bg-emerald-600 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition">
          <Building2 className="h-4 w-4 text-white" />
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
          totalStock > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 text-neutral-500'
        }`}>
          {toolsWithStock} tool{toolsWithStock !== 1 ? 's' : ''}
        </span>
      </div>
      <p className="text-sm font-bold text-neutral-900 leading-tight mb-1">{facility}</p>
      <p className="text-2xl font-extrabold text-emerald-600">{totalStock}</p>
      <p className="text-[11px] text-neutral-400 mt-0.5">total items in stock</p>
    </button>
  );
}

// ─── Tool stock card (detail view) ───────────────────────────────────────────

function ToolStockCard({ item }) {
  const qty = item.quantity ?? 0;
  const received = item.qty_received ?? 0;
  const used = received - qty; // derived so Used + Balance = Received always
  const isLow = qty > 0 && qty < 10;
  const isOut = qty <= 0 && received > 0;

  return (
    <div className={`rounded-2xl border p-4 flex flex-col gap-2 ${
      isOut ? 'bg-rose-50 border-rose-200' :
      isLow ? 'bg-amber-50 border-amber-200' :
      'bg-emerald-50 border-emerald-200'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-neutral-900 leading-tight">{item.tool_name}</span>
        {isLow && (
          <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-700 uppercase tracking-wide">Low</span>
        )}
      </div>
      <div className={`text-3xl font-extrabold ${isOut ? 'text-rose-600' : isLow ? 'text-amber-600' : qty > 0 ? 'text-emerald-600' : 'text-neutral-300'}`}>
        {qty}
      </div>
      <div className="text-[11px] text-neutral-400 space-y-0.5">
        <div>Received: <span className="font-semibold text-neutral-600">{received}</span></div>
        <div>Used: <span className="font-semibold text-neutral-600">{used > 0 ? used : 0}</span></div>
      </div>
    </div>
  );
}

// ─── Detail view for one facility ────────────────────────────────────────────

function FacilityDetail({ facilityName, onBack }) {
  const { push } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('stocked'); // 'all' | 'stocked'

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.adminFacilityInventory(facilityName);
      setData(d);
    } catch (e) {
      push(e.message || 'Failed to load facility stock', 'error');
    } finally {
      setLoading(false);
    }
  }, [facilityName, push]);

  useEffect(() => { load(); }, [load]);

  const tools = (data?.tools || []);
  const filtered = tools
    .filter(t => filter === 'all' || (t.qty_received > 0 || t.quantity > 0))
    .filter(t => !search || t.tool_name.toLowerCase().includes(search.toLowerCase()));

  const totalQty = tools.reduce((s, t) => s + (t.quantity ?? 0), 0);
  const withStock = tools.filter(t => (t.quantity ?? 0) > 0).length;
  const outOfStock = tools.filter(t => (t.qty_received ?? 0) > 0 && (t.quantity ?? 0) <= 0).length;

  return (
    <div className="space-y-5 pb-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="h-9 w-9 rounded-xl border border-neutral-200 flex items-center justify-center hover:bg-neutral-100 transition flex-shrink-0"
          >
            <ChevronLeft className="h-4 w-4 text-neutral-600" />
          </button>
          <div className="h-11 w-11 rounded-2xl bg-emerald-600 text-white grid place-items-center shadow-lg shadow-emerald-200 flex-shrink-0">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-neutral-900">{facilityName}</h1>
            <p className="text-sm text-neutral-500">Stock inventory view</p>
          </div>
        </div>
        <button onClick={load} className="p-2 hover:bg-neutral-100 rounded-xl text-neutral-500 mt-1 flex-shrink-0">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Summary badges */}
      {!loading && data && (
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
            <Package className="h-4 w-4 text-emerald-600" />
            <span className="text-xs font-semibold text-emerald-700">{totalQty} total items</span>
          </div>
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
            <span className="text-xs font-semibold text-blue-700">{withStock} tool type{withStock !== 1 ? 's' : ''} in stock</span>
          </div>
          {outOfStock > 0 && (
            <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-rose-500" />
              <span className="text-xs font-semibold text-rose-700">{outOfStock} out of stock</span>
            </div>
          )}
        </div>
      )}

      {/* Search + filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tools…"
            className="w-full pl-8 pr-3 py-2 text-sm border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-200"
          />
        </div>
        <div className="flex rounded-xl border border-neutral-200 overflow-hidden">
          {[['stocked', 'In Stock Only'], ['all', 'All Tools']].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={`px-3 py-2 text-xs font-semibold transition ${filter === v ? 'bg-emerald-600 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Tool cards grid */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-neutral-400">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading stock…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-neutral-400">
            <Package className="h-10 w-10 text-neutral-200 mx-auto mb-3" />
            {search ? 'No tools match your search' : filter === 'stocked' ? 'No stock recorded yet for this facility' : 'No tools found'}
          </div>
        ) : (
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filtered.map(t => <ToolStockCard key={t.tool_id} item={t} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function FacilityStocksScreen() {
  const { push } = useToast();
  const [facilities, setFacilities] = useState([]);
  const [stockSummary, setStockSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [facData, dashData] = await Promise.all([
        api.adminFacilities(),
        api.adminDashboard(),
      ]);
      const facList = Array.isArray(facData) ? facData : facData.facilities || [];
      setFacilities(facList);
      // Build a quick summary map from dashboard facility_stocks
      const map = {};
      (dashData?.facility_stocks || []).forEach(f => {
        map[f.facility] = { total: f.total ?? 0 };
      });
      setStockSummary(map);
    } catch (e) {
      push(e.message || 'Failed to load facilities', 'error');
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => { load(); }, [load]);

  if (selected) {
    return <FacilityDetail facilityName={selected} onBack={() => setSelected(null)} />;
  }

  const filteredFacilities = facilities.filter(f => {
    const name = typeof f === 'string' ? f : f.name || f.facility || '';
    return !search || name.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="space-y-5 pb-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-indigo-600 text-white grid place-items-center shadow-lg shadow-indigo-200">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-neutral-900">Facility Stocks</h1>
            <p className="text-sm text-neutral-500">Click any facility to view its full tool inventory</p>
          </div>
        </div>
        <button onClick={load} className="p-2 hover:bg-neutral-100 rounded-xl text-neutral-500 mt-1">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search facilities…"
          className="w-full pl-8 pr-3 py-2 text-sm border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
      </div>

      {/* Facility cards grid */}
      {loading ? (
        <div className="flex items-center justify-center py-24 text-neutral-400">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading facilities…
        </div>
      ) : filteredFacilities.length === 0 ? (
        <div className="py-16 text-center text-sm text-neutral-400">
          <Building2 className="h-10 w-10 text-neutral-200 mx-auto mb-3" />
          {search ? 'No facilities match your search' : 'No facilities found'}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filteredFacilities.map((f, i) => {
            const name = typeof f === 'string' ? f : f.name || f.facility || '';
            const summary = stockSummary[name] || {};
            const total = summary.total ?? 0;
            return (
              <FacilityCard
                key={i}
                facility={name}
                totalStock={total}
                toolsWithStock={summary.tool_count ?? (total > 0 ? '—' : 0)}
                onClick={() => setSelected(name)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
