import React, { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import { useToast } from './toasts';
import { fmtDate } from './utils';
import {
  LayoutGrid, Users, Package, ClipboardList, Warehouse, RefreshCw,
  Clock, CheckCircle, AlertTriangle, TrendingUp, ArrowRight,
  Loader2, ChevronRight, Bell,
} from 'lucide-react';

function StatCard({ icon: Icon, label, value, colorBg, urgent, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`bg-white rounded-2xl border shadow-sm p-5 text-left w-full transition group
        ${onClick ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer' : 'cursor-default'}
        ${urgent ? 'border-rose-200 bg-rose-50' : 'border-neutral-200'}`}
    >
      <div className="flex items-start justify-between">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${colorBg}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        {onClick && <ChevronRight className="h-4 w-4 text-neutral-300 group-hover:text-neutral-500 transition mt-1" />}
      </div>
      <p className={`text-3xl font-extrabold mt-3 ${urgent ? 'text-rose-700' : 'text-neutral-900'}`}>{value ?? 0}</p>
      <p className="text-xs text-neutral-500 font-medium mt-0.5">{label}</p>
    </button>
  );
}

export default function AdminDashboard({ onNavigate }) {
  const { push } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.adminDashboard();
      setData(d);
    } catch (e) {
      push(e.message || 'Failed to load dashboard', 'error');
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-neutral-400">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading dashboard…
      </div>
    );
  }

  if (!data) return null;

  const s = data.summary || {};
  const recentPending = data.recent_pending || [];
  const facilityStocks = data.facility_stocks || [];
  const deptSummary = data.department_summary || [];
  const maxStock = Math.max(...facilityStocks.map(f => f.total), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-emerald-600 text-white grid place-items-center shadow-lg shadow-emerald-200">
            <LayoutGrid className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-neutral-900">Admin Dashboard</h1>
            <p className="text-sm text-neutral-500">Overview across all facilities</p>
          </div>
        </div>
        <button onClick={load} className="p-2 hover:bg-neutral-100 rounded-xl text-neutral-500 transition" title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Action banners */}
      {(s.pending_requests > 0 || s.approved_awaiting > 0 || s.low_stock_count > 0) && (
        <div className="space-y-2">
          {s.pending_requests > 0 && (
            <div onClick={() => onNavigate?.('admin')}
              className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 cursor-pointer hover:bg-amber-100 transition">
              <Bell className="h-5 w-5 text-amber-500 flex-shrink-0" />
              <p className="text-sm font-medium text-amber-800 flex-1">
                <strong>{s.pending_requests}</strong> request{s.pending_requests !== 1 ? 's' : ''} waiting for your approval
              </p>
              <ArrowRight className="h-4 w-4 text-amber-400 flex-shrink-0" />
            </div>
          )}
          {s.approved_awaiting > 0 && (
            <div onClick={() => onNavigate?.('admin')}
              className="flex items-center gap-3 bg-sky-50 border border-sky-200 rounded-2xl px-4 py-3 cursor-pointer hover:bg-sky-100 transition">
              <Clock className="h-5 w-5 text-sky-500 flex-shrink-0" />
              <p className="text-sm font-medium text-sky-800 flex-1">
                <strong>{s.approved_awaiting}</strong> approved request{s.approved_awaiting !== 1 ? 's' : ''} awaiting delivery confirmation from facilities
              </p>
              <ArrowRight className="h-4 w-4 text-sky-400 flex-shrink-0" />
            </div>
          )}
          {s.low_stock_count > 0 && (
            <div onClick={() => onNavigate?.('admin')}
              className="flex items-center gap-3 bg-rose-50 border border-rose-200 rounded-2xl px-4 py-3 cursor-pointer hover:bg-rose-100 transition">
              <AlertTriangle className="h-5 w-5 text-rose-500 flex-shrink-0" />
              <p className="text-sm font-medium text-rose-800 flex-1">
                <strong>{s.low_stock_count}</strong> facility stock record{s.low_stock_count !== 1 ? 's' : ''} at zero — review Low Stock
              </p>
              <ArrowRight className="h-4 w-4 text-rose-400 flex-shrink-0" />
            </div>
          )}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={ClipboardList} label="Pending Requests"        value={s.pending_requests}  colorBg="bg-amber-500"  urgent={s.pending_requests > 0} onClick={s.pending_requests > 0 ? () => onNavigate?.('admin') : null} />
        <StatCard icon={Clock}         label="Awaiting Confirmation"    value={s.approved_awaiting} colorBg="bg-sky-500"    onClick={s.approved_awaiting > 0 ? () => onNavigate?.('admin') : null} />
        <StatCard icon={Package}       label="Total Tool Types"         value={s.total_tools}       colorBg="bg-emerald-600" onClick={() => onNavigate?.('tools')} />
        <StatCard icon={Users}         label="Total Users"              value={s.total_users}       colorBg="bg-violet-500" onClick={() => onNavigate?.('staff')} />
        <StatCard icon={Warehouse}     label="Active Facilities"        value={s.total_facilities}  colorBg="bg-indigo-500" />
        <StatCard icon={TrendingUp}    label="Total Stock (all sites)"  value={s.total_stock_items} colorBg="bg-teal-500"   onClick={() => onNavigate?.('analysis')} />
        <StatCard icon={AlertTriangle} label="Out-of-Stock Records"     value={s.low_stock_count}   colorBg="bg-rose-500"  urgent={s.low_stock_count > 0} onClick={s.low_stock_count > 0 ? () => onNavigate?.('admin') : null} />
      </div>

      {/* Two-column section */}
      <div className="grid gap-5 lg:grid-cols-2">

        {/* Recent pending requests */}
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
            <h2 className="font-bold text-sm text-neutral-900 flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" /> Pending Requests
            </h2>
            {onNavigate && (
              <button onClick={() => onNavigate('admin')} className="text-xs text-emerald-600 hover:underline flex items-center gap-1">
                Approve / Reject <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>
          {recentPending.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-neutral-400">
              <CheckCircle className="h-8 w-8 text-emerald-200 mx-auto mb-2" />
              All caught up — no pending requests!
            </div>
          ) : (
            <div className="divide-y divide-neutral-50">
              {recentPending.map(r => (
                <div key={r.id} className="flex items-center justify-between px-5 py-3 hover:bg-neutral-50 transition">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold text-neutral-900">Request #{r.id}</span>
                    <span className="text-xs text-neutral-400 ml-2">{r.item_count} item{r.item_count !== 1 ? 's' : ''}</span>
                    <p className="text-xs text-neutral-400 truncate">{r.requester} · {r.facility}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    <span className="text-[11px] text-neutral-400">
                      {fmtDate(r.date_requested)}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ring-1 bg-amber-100 text-amber-700 ring-amber-200">
                      <Clock className="h-3 w-3" /> Pending
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Facility stock bar chart */}
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
            <h2 className="font-bold text-sm text-neutral-900 flex items-center gap-2">
              <Warehouse className="h-4 w-4 text-indigo-500" /> Stock by Facility
            </h2>
            {onNavigate && (
              <button onClick={() => onNavigate('analysis')} className="text-xs text-emerald-600 hover:underline flex items-center gap-1">
                Full Analysis <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>
          {facilityStocks.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-neutral-400">No stock data yet</div>
          ) : (
            <div className="px-5 py-4 space-y-3">
              {facilityStocks.slice(0, 10).map((f, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium text-neutral-700 truncate max-w-[65%]">{f.facility || 'Unknown'}</span>
                    <span className="font-bold text-neutral-900">{f.total}</span>
                  </div>
                  <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{ width: `${Math.max(2, Math.round((f.total / maxStock) * 100))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Department distribution */}
      {deptSummary.length > 0 && (
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-5">
          <h2 className="text-sm font-bold text-neutral-700 uppercase tracking-wider mb-4">
            Distributions by Department
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {deptSummary.map((d, i) => (
              <div key={i} className="bg-neutral-50 rounded-xl px-3 py-3 text-center">
                <p className="text-2xl font-extrabold text-neutral-900">{d.total}</p>
                <p className="text-xs text-neutral-500 capitalize mt-0.5">{d.department || 'Unknown'}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
