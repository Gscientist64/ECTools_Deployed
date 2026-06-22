import React, { useEffect, useState, useCallback } from 'react';
import { api } from './api';
import { useToast } from './toasts';
import {
  ClipboardList, Package, CheckCircle, Clock, Warehouse,
  ArrowRightLeft, AlertTriangle, RefreshCcw, TrendingUp,
} from 'lucide-react';

function StatCard({ icon: Icon, label, value, sub, color = 'emerald', pulse = false }) {
  const colors = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amber:   'bg-amber-50  text-amber-700  ring-amber-200',
    sky:     'bg-sky-50    text-sky-700    ring-sky-200',
    rose:    'bg-rose-50   text-rose-700   ring-rose-200',
    neutral: 'bg-neutral-50 text-neutral-700 ring-neutral-200',
  };
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-5 flex items-start gap-4">
      <div className={`h-11 w-11 rounded-xl ring-1 grid place-items-center flex-shrink-0 ${colors[color]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold text-neutral-900 flex items-center gap-2">
          {value}
          {pulse && value > 0 && (
            <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          )}
        </div>
        <div className="text-sm font-medium text-neutral-600">{label}</div>
        {sub && <div className="text-xs text-neutral-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function StatusChip({ status }) {
  const map = {
    Approved: 'bg-emerald-100 text-emerald-700',
    Rejected: 'bg-rose-100    text-rose-700',
    Pending:  'bg-amber-100   text-amber-800',
  };
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${map[status] ?? 'bg-neutral-100 text-neutral-600'}`}>
      {status}
    </span>
  );
}

export default function FacilityDashboard({ onNavigate }) {
  const { push } = useToast();
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.facilityDashboard();
      setData(d);
    } catch (e) {
      push(e.message || 'Failed to load dashboard', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-neutral-400">
        <RefreshCcw className="h-6 w-6 animate-spin mr-2" /> Loading dashboard…
      </div>
    );
  }

  if (!data) return null;

  const { stats, recent_requests, stock_summary, facility, user_name } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">
            Welcome back, {user_name}
          </h1>
          <p className="text-sm text-neutral-500 mt-0.5">{facility || 'No facility assigned'}</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-700 border border-neutral-200 rounded-xl px-3 py-1.5 transition"
        >
          <RefreshCcw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={ClipboardList}
          label="Total Requests"
          value={stats.total_requests}
          color="neutral"
        />
        <StatCard
          icon={Clock}
          label="Pending Requests"
          value={stats.pending_requests}
          color="amber"
          pulse
        />
        <StatCard
          icon={CheckCircle}
          label="Approved"
          value={stats.approved_requests}
          color="emerald"
        />
        <StatCard
          icon={Package}
          label="Awaiting Confirmation"
          value={stats.awaiting_confirm}
          sub="Items delivered, confirm receipt"
          color={stats.awaiting_confirm > 0 ? 'sky' : 'neutral'}
          pulse
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          icon={Warehouse}
          label="Stock Items"
          value={stats.stock_items}
          sub="Tools tracked at this facility"
          color="sky"
        />
        <StatCard
          icon={AlertTriangle}
          label="Out of Stock"
          value={stats.out_of_stock}
          color={stats.out_of_stock > 0 ? 'rose' : 'emerald'}
        />
        <StatCard
          icon={ArrowRightLeft}
          label="Incoming Transfers"
          value={stats.incoming_transfers}
          sub="Pending your acceptance"
          color={stats.incoming_transfers > 0 ? 'amber' : 'neutral'}
          pulse
        />
      </div>

      {/* Quick actions */}
      {(stats.awaiting_confirm > 0 || stats.incoming_transfers > 0 || stats.pending_requests > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <div className="text-sm font-semibold text-amber-800 mb-3 flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" /> Action needed
          </div>
          <div className="flex flex-wrap gap-2">
            {stats.awaiting_confirm > 0 && (
              <button
                onClick={() => onNavigate('requests')}
                className="text-xs font-medium bg-white border border-amber-300 text-amber-800 px-3 py-1.5 rounded-xl hover:bg-amber-100 transition"
              >
                Confirm {stats.awaiting_confirm} pending delivery{stats.awaiting_confirm !== 1 ? 'ies' : 'y'}
              </button>
            )}
            {stats.incoming_transfers > 0 && (
              <button
                onClick={() => onNavigate('transfers')}
                className="text-xs font-medium bg-white border border-amber-300 text-amber-800 px-3 py-1.5 rounded-xl hover:bg-amber-100 transition"
              >
                Accept {stats.incoming_transfers} incoming transfer{stats.incoming_transfers !== 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent requests */}
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm">
          <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
            <span className="text-sm font-bold text-neutral-900">Recent Requests</span>
            <button
              onClick={() => onNavigate('requests')}
              className="text-xs text-emerald-600 hover:text-emerald-800 font-medium"
            >
              View all →
            </button>
          </div>
          {recent_requests.length === 0 ? (
            <div className="py-10 text-center text-sm text-neutral-400">No requests yet</div>
          ) : (
            <div className="divide-y divide-neutral-100">
              {recent_requests.map(r => (
                <div key={r.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-neutral-800">#{r.id}</div>
                    <div className="text-[11px] text-neutral-500 truncate">{r.tools || `${r.item_count} item${r.item_count !== 1 ? 's' : ''}`}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] text-neutral-400">
                      {r.date_requested ? new Date(r.date_requested).toLocaleDateString() : ''}
                    </span>
                    <StatusChip status={r.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Stock summary */}
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm">
          <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
            <span className="text-sm font-bold text-neutral-900">Facility Stock</span>
            <button
              onClick={() => onNavigate('myinventory')}
              className="text-xs text-emerald-600 hover:text-emerald-800 font-medium"
            >
              View all →
            </button>
          </div>
          {stock_summary.length === 0 ? (
            <div className="py-10 text-center text-sm text-neutral-400">No stock recorded yet</div>
          ) : (
            <div className="divide-y divide-neutral-100 max-h-64 overflow-y-auto">
              {stock_summary.map(s => (
                <div key={s.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="text-xs font-medium text-neutral-800 truncate">{s.tool_name}</div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {s.quantity === 0 && (
                      <span className="text-[10px] font-semibold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">Out</span>
                    )}
                    <span className={`text-sm font-bold ${s.quantity === 0 ? 'text-rose-600' : 'text-neutral-900'}`}>
                      {s.quantity}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Trend placeholder */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-5">
        <div className="flex items-center gap-2 text-sm font-bold text-neutral-900 mb-2">
          <TrendingUp className="h-4 w-4 text-emerald-600" /> Request Activity
        </div>
        <div className="text-xs text-neutral-500">
          You have made <span className="font-semibold text-neutral-800">{stats.total_requests}</span> requests in total,
          with <span className="font-semibold text-emerald-700">{stats.approved_requests}</span> approved
          and <span className="font-semibold text-amber-700">{stats.pending_requests}</span> still pending.
          {stats.awaiting_confirm > 0 && (
            <> You have <span className="font-semibold text-sky-700">{stats.awaiting_confirm}</span> delivered item{stats.awaiting_confirm !== 1 ? 's' : ''} waiting for your confirmation.</>
          )}
        </div>
      </div>
    </div>
  );
}
