import React, { useEffect, useState, useCallback } from 'react';
import { api } from './api';
import { useToast } from './toasts';
import { fmtDateTime } from './utils';
import {
  ShieldCheck, RefreshCcw, ChevronLeft, ChevronRight, Search,
  CheckCircle, XCircle, MessageSquare, Package, User, Settings,
  AlertTriangle,
} from 'lucide-react';

const ACTION_ICONS = {
  approve_request:       CheckCircle,
  reject_request:        XCircle,
  batch_approve_request: CheckCircle,
  batch_reject_request:  XCircle,
  add_comment:           MessageSquare,
  set_threshold:         Settings,
  deliver:               Package,
};

const ACTION_COLORS = {
  approve_request:       'text-emerald-600',
  batch_approve_request: 'text-emerald-600',
  reject_request:        'text-rose-600',
  batch_reject_request:  'text-rose-600',
  add_comment:           'text-sky-600',
  set_threshold:         'text-amber-600',
  deliver:               'text-blue-600',
};

function ActionLabel({ action }) {
  const Icon  = ACTION_ICONS[action] ?? AlertTriangle;
  const color = ACTION_COLORS[action] ?? 'text-neutral-500';
  const label = action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${color}`}>
      <Icon className="h-3.5 w-3.5 flex-shrink-0" />{label}
    </span>
  );
}

function RolePill({ role }) {
  if (!role) return null;
  const isAdmin = ['admin', 'administrator', 'superadmin', 'hq_admin'].includes((role || '').toLowerCase());
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${isAdmin ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 text-neutral-600'}`}>
      {role}
    </span>
  );
}

const PER_PAGE = 50;

export default function AuditLogScreen() {
  const { push } = useToast();
  const [items, setItems]   = useState([]);
  const [total, setTotal]   = useState(0);
  const [page,  setPage]    = useState(1);
  const [search, setSearch] = useState('');
  const [entity, setEntity] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params = { page: p, per_page: PER_PAGE };
      if (search) params.action = search;
      if (entity) params.entity_type = entity;
      const d = await api.getAuditLog(params);
      setItems(d.items || []);
      setTotal(d.total || 0);
      setPage(p);
    } catch (e) {
      push(e.message || 'Failed to load audit log', 'error');
    } finally {
      setLoading(false);
    }
  }, [search, entity]);

  useEffect(() => { load(1); }, [search, entity]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" /> Audit Log
          </h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            Complete record of all system actions — {total.toLocaleString()} entries
          </p>
        </div>
        <button
          onClick={() => load(page)}
          className="p-2 rounded-xl border border-neutral-200 text-neutral-500 hover:text-neutral-700 transition"
        >
          <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
          <input
            className="w-full pl-8 pr-3 py-2 text-sm border border-neutral-200 rounded-xl focus:outline-none"
            placeholder="Filter by action…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="text-sm border border-neutral-200 rounded-xl px-3 py-2"
          value={entity}
          onChange={e => setEntity(e.target.value)}
        >
          <option value="">All entities</option>
          <option value="request">Request</option>
          <option value="tool">Tool</option>
          <option value="user">User</option>
          <option value="delivery">Delivery</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16 text-neutral-400">
            <RefreshCcw className="h-5 w-5 animate-spin mr-2" /> Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center">
            <ShieldCheck className="h-8 w-8 text-neutral-300 mx-auto mb-3" />
            <p className="text-sm text-neutral-500">No audit events found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-100 text-xs text-neutral-500 font-semibold">
                  <th className="px-4 py-3 text-left">When</th>
                  <th className="px-4 py-3 text-left">Actor</th>
                  <th className="px-4 py-3 text-left">Action</th>
                  <th className="px-4 py-3 text-left">Entity</th>
                  <th className="px-4 py-3 text-left">Details</th>
                  <th className="px-4 py-3 text-left">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {items.map(item => (
                  <tr key={item.id} className="hover:bg-neutral-50 transition-colors">
                    <td className="px-4 py-3 text-[11px] text-neutral-400 whitespace-nowrap">
                      {fmtDateTime(item.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <div className="h-6 w-6 rounded-full bg-neutral-100 grid place-items-center flex-shrink-0">
                          <User className="h-3 w-3 text-neutral-500" />
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-neutral-800 leading-none">
                            {item.actor || 'System'}
                          </div>
                          <div className="flex items-center gap-1 mt-0.5">
                            {item.actor_facility && (
                              <span className="text-[10px] text-neutral-400">{item.actor_facility}</span>
                            )}
                            <RolePill role={item.actor_role} />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <ActionLabel action={item.action} />
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-600 whitespace-nowrap">
                      {item.entity_type
                        ? <span>{item.entity_type} <span className="font-semibold">#{item.entity_id}</span></span>
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-[11px] text-neutral-500 max-w-[200px]">
                      {item.details
                        ? Object.entries(item.details).map(([k, v]) => (
                          <span key={k} className="mr-2">
                            <span className="font-medium text-neutral-600">{k}:</span> {String(v)}
                          </span>
                        ))
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-[10px] text-neutral-400 font-mono whitespace-nowrap">
                      {item.ip_address || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-100">
            <span className="text-xs text-neutral-500">
              Page {page} of {totalPages} · {total} entries
            </span>
            <div className="flex gap-1">
              <button
                disabled={page === 1}
                onClick={() => load(page - 1)}
                className="p-1.5 rounded-lg border border-neutral-200 disabled:opacity-40 hover:bg-neutral-50 transition"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                disabled={page === totalPages}
                onClick={() => load(page + 1)}
                className="p-1.5 rounded-lg border border-neutral-200 disabled:opacity-40 hover:bg-neutral-50 transition"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
