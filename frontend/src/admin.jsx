// frontend/src/admin.jsx
import React, { useEffect, useState } from 'react';
import { api } from './api';
import { useToast } from './toasts';
import {
  Check,
  X,
  Pencil,
  Trash2,
  RefreshCcw,
  Shield,
  ChevronDown,
  AlertTriangle,
  PackageCheck,
} from 'lucide-react';

/** Reusable, modern button */
function Button({ variant = 'solid', color = 'emerald', size = 'sm', className = '', children, ...props }) {
  const sizes = {
    sm: 'px-3 py-2 text-sm rounded-xl',
    md: 'px-4 py-2.5 text-sm rounded-xl',
  };
  const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-black/30';
  const palettes = {
    emerald: {
      solid: 'bg-gradient-to-r from-emerald-600 to-green-600 text-white hover:opacity-95 shadow-sm hover:shadow',
      ghost: 'border border-emerald-300/60 text-emerald-700 hover:bg-emerald-50',
      subtle: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200',
    },
    rose: {
      solid: 'bg-gradient-to-r from-rose-600 to-rose-500 text-white hover:opacity-95 shadow-sm hover:shadow',
      ghost: 'border border-rose-300/60 text-rose-700 hover:bg-rose-50',
      subtle: 'bg-rose-100 text-rose-700 hover:bg-rose-200',
    },
    neutral: {
      solid: 'bg-neutral-900 text-white hover:bg-neutral-800 shadow-sm hover:shadow',
      ghost: 'border border-neutral-300 text-neutral-800 hover:bg-neutral-100',
      subtle: 'bg-neutral-100 text-neutral-800 hover:bg-neutral-200',
    },
    amber: {
      solid: 'bg-gradient-to-r from-amber-600 to-amber-500 text-white hover:opacity-95 shadow-sm hover:shadow',
      ghost: 'border border-amber-300/60 text-amber-800 hover:bg-amber-50',
      subtle: 'bg-amber-100 text-amber-800 hover:bg-amber-200',
    },
    blue: {
      solid: 'bg-gradient-to-r from-sky-600 to-blue-600 text-white hover:opacity-95 shadow-sm hover:shadow',
      ghost: 'border border-sky-300/60 text-sky-800 hover:bg-sky-50',
      subtle: 'bg-sky-100 text-sky-800 hover:bg-sky-200',
    },
  };
  const base = `inline-flex items-center gap-1.5 transition ${sizes[size]} ${palettes[color][variant]} ${focusRing} ${className}`;
  return (
    <button className={base} {...props}>
      {children}
    </button>
  );
}

export default function AdminScreen() {
  const { push } = useToast();
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('Pending');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({});
  const [openId, setOpenId] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);

  // Rejection reason modal
  const [rejectModal, setRejectModal] = useState(null); // { id, reason: '' }
  const [rejecting, setRejecting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [data, pendingDeliveries] = await Promise.all([
        api.adminRequests(status || undefined),
        api.getPendingDeliveries().catch(() => []),
      ]);
      setRows(Array.isArray(data) ? data : []);
      setPendingCount(Array.isArray(pendingDeliveries) ? pendingDeliveries.length : 0);
    } catch (e) {
      push(e.message || 'Failed to load requests', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [status]);

  const beginEdit = (req) => {
    setEditing(req.id);
    const d = {};
    (req.lines || req.requested_tools || req.items || []).forEach(ln => { d[ln.id] = ln.quantity; });
    setDraft(d);
  };
  const cancelEdit = () => { setEditing(null); setDraft({}); };

  const saveEdit = async (req) => {
    try {
      const srcLines = req.lines || req.requested_tools || req.items || [];
      const lines = srcLines.map(ln => ({
        id: ln.id,
        quantity: Number(draft[ln.id] ?? ln.quantity),
      }));
      await api.adminEditRequest(req.id, lines);
      push('Request updated', 'success');
      setEditing(null);
      setDraft({});
      await load();
    } catch (e) {
      push(e.message || 'Failed to update', 'error');
    }
  };

  const approve = async (id) => {
    try {
      await api.adminApproveRequest(id);
      push('Approved', 'success');
      await load();
    } catch (e) {
      push(e.message || 'Failed to approve (check stock and edit quantities)', 'error');
    }
  };

  const openRejectModal = (id) => {
    setRejectModal({ id, reason: '' });
  };

  const confirmReject = async () => {
    if (!rejectModal) return;
    setRejecting(true);
    try {
      await api.adminRejectRequestWithReason(rejectModal.id, rejectModal.reason);
      push('Rejected', 'success');
      setRejectModal(null);
      await load();
    } catch (e) {
      push(e.message || 'Failed to reject', 'error');
    } finally {
      setRejecting(false);
    }
  };

  const del = async (id) => {
    if (!confirm('Delete this pending request?')) return;
    try { await api.adminDeleteRequest(id); push('Deleted', 'success'); await load(); }
    catch (e) { push(e.message || 'Failed to delete', 'error'); }
  };

  const toggleOpen = (id) => setOpenId(cur => cur === id ? null : id);

  const getRequesterName = (r) => (
    r?.user?.name || r?.user?.username || r?.requested_by || r?.requestedBy ||
    r?.requester || r?.requester_name || r?.user_name || r?.username || r?.email || '—'
  );

  const getFacilityName = (r) => (
    r?.user?.facility || r?.facility || r?.facility_name || r?.user_facility || r?.facilityName || '—'
  );

  const getActorName = (r) => (
    r?.approved_by?.name || r?.approved_by_name || r?.approvedBy ||
    r?.action_by || r?.action_by_name || ''
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-emerald-600 via-green-600 to-emerald-700 text-white grid place-items-center shadow">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-neutral-900">Admin Panel</h1>
            <p className="text-sm text-neutral-600">Manage requests and tools. Stock-aware approvals.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option>Pending</option>
            <option>Approved</option>
            <option>Rejected</option>
            <option value="">All</option>
          </select>
          <div className="flex items-center gap-2">
            {pendingCount > 0 && (
              <span className="bg-amber-100 text-amber-700 px-2 py-1 rounded-full text-xs flex items-center gap-1">
                <PackageCheck className="h-3 w-3" />
                {pendingCount} pending {pendingCount === 1 ? 'confirmation' : 'confirmations'}
              </span>
            )}
            <Button variant="ghost" color="blue" onClick={load}>
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Table (collapsible rows) */}
      <div className="rounded-3xl border border-emerald-200/60 bg-gradient-to-br from-emerald-50 via-white to-emerald-50 overflow-hidden">
        <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-3 text-xs font-semibold text-emerald-900/80 border-b border-emerald-200/70 bg-emerald-100/40">
          <div className="col-span-2">Request</div>
          <div className="col-span-4">User</div>
          <div className="col-span-4">Summary</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-neutral-600">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-neutral-600">No requests.</div>
        ) : (
          rows.map((r) => {
            const isEditing = editing === r.id;
            const lines = r.lines || r.requested_tools || r.items || [];
            const anyInsufficient = lines.some(ln => (ln.quantity || 0) > (ln.in_stock || 0));

            return (
              <div key={r.id} className="border-t border-emerald-200/70">
                {/* Row header */}
                <div className="px-4 py-4 grid md:grid-cols-12 gap-3 items-center">
                  <div className="md:col-span-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleOpen(r.id)}
                        className="rounded-lg border border-emerald-300/60 bg-white px-2 py-1 hover:bg-emerald-50"
                        aria-expanded={openId === r.id}
                      >
                        <ChevronDown className={`h-4 w-4 transition-transform ${openId === r.id ? 'rotate-180' : ''}`} />
                      </button>
                      <div>
                        <div className="text-sm font-semibold">#{r.id}</div>
                        <div className={`text-[11px] mt-1 inline-flex px-2 py-0.5 rounded-full ${
                          r.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' :
                          r.status === 'Rejected' ? 'bg-rose-100 text-rose-700' :
                          'bg-amber-100 text-amber-800'
                        }`}>{r.status}</div>
                      </div>
                    </div>
                    <div className="text-[11px] text-neutral-600 mt-2 space-y-0.5">
                      {r.date_requested && <div>Requested: {new Date(r.date_requested).toLocaleString()}</div>}
                      {r.status === 'Approved' && r.date_approved && (
                        <div>Approved: {new Date(r.date_approved).toLocaleString()}{getActorName(r) ? ` • by ${getActorName(r)}` : ''}</div>
                      )}
                      {r.status === 'Rejected' && r.date_rejected && (
                        <div>Rejected: {new Date(r.date_rejected).toLocaleString()}{getActorName(r) ? ` • by ${getActorName(r)}` : ''}</div>
                      )}
                    </div>
                  </div>

                  <div className="md:col-span-4">
                    <div className="text-sm font-medium">{getRequesterName(r)}</div>
                    <div className="text-xs text-neutral-600">{getFacilityName(r)}</div>
                  </div>

                  <div className="md:col-span-4">
                    <div className="text-xs text-neutral-700">
                      {lines.length} item{lines.length === 1 ? '' : 's'}
                      {anyInsufficient && (
                        <span className="inline-flex items-center gap-1 ml-2 text-rose-700">
                          <AlertTriangle className="h-3.5 w-3.5" /> exceeds stock
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="md:col-span-2 md:text-right flex md:block gap-2">
                    {isEditing ? (
                      <>
                        <Button onClick={() => saveEdit(r)} color="emerald">
                          <Check className="h-4 w-4" /> Save
                        </Button>
                        <Button variant="ghost" color="neutral" onClick={cancelEdit} className="mt-0 md:mt-2">Cancel</Button>
                      </>
                    ) : (
                      <>
                        {r.status === 'Pending' && (
                          <>
                            <Button color="emerald" onClick={() => approve(r.id)} disabled={anyInsufficient}
                              title={anyInsufficient ? 'Edit quantities to not exceed stock' : 'Approve request'}>
                              <Check className="h-4 w-4" /> Approve
                            </Button>
                            <Button color="rose" onClick={() => openRejectModal(r.id)} className="mt-0 md:mt-2">
                              <X className="h-4 w-4" /> Reject
                            </Button>
                            <Button variant="ghost" color="neutral" onClick={() => beginEdit(r)} className="mt-0 md:mt-2">
                              <Pencil className="h-4 w-4" /> Edit
                            </Button>
                            <Button variant="ghost" color="rose" onClick={() => del(r.id)} className="mt-0 md:mt-2">
                              <Trash2 className="h-4 w-4" /> Delete
                            </Button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Collapsible detail */}
                <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${openId === r.id ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                  <div className="overflow-hidden">
                    <div className="px-4 pb-4">
                      <ul className="space-y-2">
                        {lines.map((ln) => {
                          const over = (ln.quantity || 0) > (ln.in_stock || 0);
                          return (
                            <li key={ln.id} className="flex items-center justify-between rounded-xl bg-white border border-neutral-200 px-3 py-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between">
                                  <div className="text-sm font-medium text-neutral-900 truncate">{ln.tool_name}</div>
                                  <div className="flex items-center gap-2">
                                    {ln.is_delivered ? (
                                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700">Delivered ✓</span>
                                    ) : r.status === 'Approved' && !ln.delivery_id ? (
                                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Awaiting Confirmation</span>
                                    ) : r.status === 'Approved' && ln.delivery_id ? (
                                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Note Ready</span>
                                    ) : null}
                                    {ln.delivery_id && (
                                      <button
                                        onClick={async () => {
                                          try {
                                            const blob = await api.downloadDeliveryNote(ln.delivery_id);
                                            const url = window.URL.createObjectURL(blob);
                                            const a = document.createElement('a');
                                            a.href = url;
                                            a.download = `delivery_note_${ln.delivery_id}.pdf`;
                                            a.click();
                                            window.URL.revokeObjectURL(url);
                                            push('Delivery note downloaded', 'success');
                                          } catch (error) {
                                            push('Failed to download delivery note', 'error');
                                          }
                                        }}
                                        className="text-blue-600 hover:text-blue-800 text-xs underline ml-1"
                                      >
                                        📄 Download Note
                                      </button>
                                    )}
                                  </div>
                                </div>
                                <div className="text-[11px] text-neutral-600 mt-1">
                                  Requested: <span className="font-semibold">{ln.quantity}</span> • In stock:{' '}
                                  <span className={`font-semibold ${over ? 'text-rose-700' : 'text-emerald-700'}`}>{ln.in_stock ?? 0}</span>
                                </div>
                              </div>
                              {editing === r.id ? (
                                <input type="number" min="1" value={String(draft[ln.id] ?? ln.quantity)}
                                  onChange={(e) => setDraft(p => ({ ...p, [ln.id]: e.target.value.replace(/[^\d]/g, '') }))}
                                  className="w-20 rounded-lg border border-neutral-300 text-sm text-right px-2 py-1 focus:outline-none focus:ring-2 focus:ring-black/10"
                                />
                              ) : (
                                <div className={`text-[11px] px-2 py-0.5 rounded-full ${over ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                  {over ? 'Exceeds stock' : 'OK'}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Rejection Reason Modal */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl border border-neutral-200 p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-semibold mb-1">Reject Request #{rejectModal.id}</h2>
            <p className="text-sm text-neutral-500 mb-4">Please provide a reason for rejecting this request.</p>
            <textarea
              value={rejectModal.reason}
              onChange={(e) => setRejectModal(r => ({ ...r, reason: e.target.value }))}
              placeholder="Enter rejection reason..."
              className="w-full border border-neutral-300 rounded-xl px-3 py-2.5 text-sm min-h-[100px] focus:outline-none focus:ring-2 focus:ring-rose-300 resize-none"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" color="neutral" onClick={() => setRejectModal(null)} disabled={rejecting}>Cancel</Button>
              <Button color="rose" onClick={confirmReject} disabled={rejecting}>
                {rejecting ? 'Rejecting...' : 'Confirm Reject'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}