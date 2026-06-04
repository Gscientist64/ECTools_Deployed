// frontend/src/requests.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { ChevronDown, ClipboardList, Minus, Plus, Send, CheckCircle, Download, PackageCheck } from 'lucide-react';
import { useToast } from './toasts';
import { Button, Input } from './ui';

// Delivery Confirmation Dialog Component
function DeliveryConfirmationDialog({ open, toolName, quantity, onConfirm, onClose }) {
  const [witnessedBy, setWitnessedBy] = useState('');
  const [basicUnit, setBasicUnit] = useState('unit');
  const [submitting, setSubmitting] = useState(false);
  const { push } = useToast();

  if (!open) return null;

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm(witnessedBy, basicUnit);
      push(`Delivery confirmed for ${quantity} x ${toolName}`, 'success');
      onClose();
    } catch (error) {
      push(error.message || 'Failed to confirm delivery', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6 border border-emerald-200 dark:border-emerald-800">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-emerald-100 dark:bg-emerald-900 rounded-xl">
            <PackageCheck className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Confirm Delivery
          </h3>
        </div>
        
        <p className="text-neutral-600 dark:text-neutral-400 mb-4">
          Have you received <strong className="text-emerald-600">{quantity} x {toolName}</strong>?
        </p>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
              Basic Unit
            </label>
            <select
              value={basicUnit}
              onChange={(e) => setBasicUnit(e.target.value)}
              className="w-full rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-2 text-sm"
            >
              <option value="unit">Unit</option>
              <option value="register">Register</option>
              <option value="booklet">Booklet</option>
              <option value="pack">Pack</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
              Witnessed By (Optional)
            </label>
            <Input
              type="text"
              placeholder="Full name of witness"
              value={witnessedBy}
              onChange={(e) => setWitnessedBy(e.target.value)}
            />
          </div>
        </div>
        
        <div className="flex gap-3 mt-6">
          <Button onClick={handleConfirm} disabled={submitting} className="flex-1">
            <CheckCircle className="h-4 w-4" />
            {submitting ? 'Confirming...' : 'Confirm Delivery'}
          </Button>
          <Button variant="ghost" color="neutral" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function RequestScreen() {
  const { push } = useToast();
  const [data, setData] = useState([]);           // catalog (categories -> tools)
  const [openKey, setOpenKey] = useState(null);   // single open category
  const [loading, setLoading] = useState(true);
  const [qty, setQty] = useState({});             // {toolId: number}
  const [submitting, setSubmitting] = useState(false);
  const [myReqs, setMyReqs] = useState([]);
  const [openReqId, setOpenReqId] = useState(null); // collapsible "My Requests"
  
  // Delivery confirmation state
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    requestedToolId: null,
    toolName: '',
    quantity: 0
  });

  // load catalog + my requests
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [catalog, reqs] = await Promise.all([
        api.catalog().catch(() => []),
        loadRequestsWithDeliveryStatus(),
      ]);
      setData(Array.isArray(catalog) ? catalog : []);
      setMyReqs(Array.isArray(reqs) ? reqs : []);
    } finally {
      setLoading(false);
    }
  };

  const loadRequestsWithDeliveryStatus = async () => {
    try {
      const reqs = await api.myRequests();
      const deliveries = await api.getMyDeliveries().catch(() => []);
      
      // Merge delivery info into requests
      const deliveryMap = new Map();
      deliveries.forEach(d => {
        deliveryMap.set(d.requested_tool_id, d);
      });
      
      return reqs.map(req => ({
        ...req,
        lines: (req.lines || req.requested_tools || []).map(line => ({
          ...line,
          isDelivered: deliveryMap.get(line.id)?.is_delivered || false,
          deliveryId: deliveryMap.get(line.id)?.delivery_id,
          canConfirm: deliveryMap.get(line.id) ? !deliveryMap.get(line.id).is_delivered : true
        }))
      }));
    } catch {
      return [];
    }
  };

  // robust key/label (in case backend fields differ)
  const getRowKey = (item, index) =>
    item?.id ?? item?.category_id ?? item?.categoryId ?? item?.name ?? item?.category ?? index;

  const getCategoryLabel = (item) => {
    const raw =
      item?.category ??
      item?.name ??
      item?.category_name ??
      item?.title ??
      '';
    return typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
  };

  const toggle = (rowKey) => setOpenKey((cur) => (cur === rowKey ? null : rowKey));

  // Update quantity (numbers only)
  const setToolQty = (toolId, val) => {
    const n = String(val).replace(/[^\d]/g, ''); // keep digits only
    const num = n === '' ? '' : Math.max(0, parseInt(n, 10));
    setQty((q) => ({ ...q, [toolId]: num }));
  };

  const inc = (toolId) => setQty((q) => ({ ...q, [toolId]: (parseInt(q[toolId] || 0, 10) + 1) }));
  const dec = (toolId) => setQty((q) => ({ ...q, [toolId]: Math.max(0, parseInt(q[toolId] || 0, 10) - 1) }));

  // Build request items from qty map
  const items = useMemo(() => {
    const out = [];
    for (const cat of data) {
      const tools = Array.isArray(cat?.tools) ? cat.tools : [];
      for (const t of tools) {
        const v = qty[t.id];
        if (v && Number(v) > 0) out.push({ tool_id: t.id, tool_name: t.name, quantity: Number(v) });
      }
    }
    return out;
  }, [qty, data]);

  // Submit combined request
  const submit = async () => {
    if (items.length === 0) return push('Please add at least one tool quantity', 'error');
    setSubmitting(true);
    try {
      const res = await api.createRequest(items.map(({ tool_id, quantity }) => ({ tool_id, quantity })));
      const newId = res?.request_id;

      // Optimistic add
      const optimistic = {
        id: newId ?? Math.random().toString(36).slice(2),
        status: 'Pending',
        date_requested: new Date().toISOString(),
        lines: items.map(({ tool_id, tool_name, quantity }) => ({
          id: Math.random().toString(36).slice(2),
          tool_id,
          tool_name,
          quantity,
          status: 'Pending',
          isDelivered: false,
        })),
      };
      setMyReqs((cur) => [optimistic, ...cur]);

      push('Request submitted successfully', 'success');
      setQty({});

      // Background refresh
      const fresh = await loadRequestsWithDeliveryStatus();
      setMyReqs(fresh);
    } catch (e) {
      push(e.message || 'Failed to submit request', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle delivery confirmation
  const handleConfirmDelivery = async (requestedToolId, witnessedBy, basicUnit) => {
    await api.confirmDelivery(requestedToolId, witnessedBy, basicUnit);
    
    // Refresh to show updated status
    const fresh = await loadRequestsWithDeliveryStatus();
    setMyReqs(fresh);
    
    // Ask if user wants to download delivery note
    const delivery = fresh.flatMap(r => r.lines || []).find(l => l.id === requestedToolId);
    if (delivery?.deliveryId) {
      const shouldDownload = window.confirm('Delivery confirmed! Would you like to download the delivery note now?');
      if (shouldDownload) {
        await downloadDeliveryNote(delivery.deliveryId);
      }
    }
  };

  // Download delivery note
  const downloadDeliveryNote = async (deliveryId) => {
    try {
      const blob = await api.downloadDeliveryNote(deliveryId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `delivery_note_${deliveryId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      push('Delivery note downloaded', 'success');
    } catch (error) {
      push('Failed to download delivery note', 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Delivery Confirmation Dialog */}
      <DeliveryConfirmationDialog
        open={confirmDialog.open}
        toolName={confirmDialog.toolName}
        quantity={confirmDialog.quantity}
        onConfirm={(witnessedBy, basicUnit) => 
          handleConfirmDelivery(confirmDialog.requestedToolId, witnessedBy, basicUnit)
        }
        onClose={() => setConfirmDialog({ open: false, requestedToolId: null, toolName: '', quantity: 0 })}
      />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-emerald-600 via-green-600 to-emerald-700 text-white grid place-items-center shadow">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-neutral-900">New Request</h1>
            <p className="text-sm text-neutral-600">Pick tools by category, enter quantities, and submit one combined request.</p>
          </div>
        </div>
      </div>

      {/* Two-column layout on large screens */}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* LEFT: Catalog accordion */}
        <div className="space-y-4">
          {loading ? (
            <div className="rounded-2xl p-6 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
              Loading…
            </div>
          ) : data.length === 0 ? (
            <div className="rounded-2xl p-6 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-center">
              No categories yet.
            </div>
          ) : (
            data.map((item, index) => {
              const rowKey = getRowKey(item, index);
              const catName = getCategoryLabel(item) || 'Category';
              const tools = Array.isArray(item?.tools) ? item.tools : [];
              const open = openKey === rowKey;

              return (
                <div
                  key={rowKey}
                  className="rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm"
                >
                  {/* Row header */}
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenKey(open ? null : rowKey)}
                    className="w-full flex items-center px-4 py-4 hover:bg-emerald-50/60 dark:hover:bg-emerald-900/20 transition"
                  >
                    <div className="flex-1 min-w-0 text-left">
                      <div className="font-semibold text-emerald-700 dark:text-emerald-300 truncate">
                        {catName}
                      </div>
                    </div>

                    <div className="ml-3 flex items-center gap-3 shrink-0">
                      <div className="text-xs font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                        {tools.length} tool{tools.length === 1 ? '' : 's'}
                      </div>
                      <ChevronDown
                        className={`h-5 w-5 transition-transform ${open ? 'rotate-180' : ''} text-emerald-700`}
                      />
                    </div>
                  </button>

                  {/* Tools panel */}
                  <div
                    className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                      open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="px-4 pb-4">
                        {tools.length === 0 ? (
                          <div className="text-sm text-neutral-500">No tools in this category yet.</div>
                        ) : (
                          <ul className="grid gap-3 sm:grid-cols-2">
                            {tools.map((t) => {
                              const v = qty[t.id] ?? '';
                              return (
                                <li
                                  key={t.id ?? t.name}
                                  className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 bg-neutral-50/60 dark:bg-neutral-950/40"
                                >
                                  <div className="font-medium text-neutral-900 dark:text-neutral-100">{t.name}</div>
                                  {t.description ? (
                                    <div className="text-xs text-neutral-600 dark:text-neutral-400 mt-1 line-clamp-2">
                                      {t.description}
                                    </div>
                                  ) : null}

                                  {/* qty controls */}
                                  <div className="mt-3 flex items-center gap-2">
                                    <button type="button" onClick={() => dec(t.id)} className="rounded-lg border border-neutral-300 px-2 py-1 hover:bg-neutral-100">
                                      <Minus className="h-4 w-4" />
                                    </button>
                                    <Input
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={v}
                                      onChange={(e) => setToolQty(t.id, e.target.value)}
                                      className="w-20 text-center"
                                      placeholder="0"
                                    />
                                    <button type="button" onClick={() => inc(t.id)} className="rounded-lg border border-neutral-300 px-2 py-1 hover:bg-neutral-100">
                                      <Plus className="h-4 w-4" />
                                    </button>
                                  </div>
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

        {/* RIGHT: New Request summary card */}
        <div className="h-max rounded-3xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-white to-emerald-50 p-5 shadow-xl">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-emerald-900">New Request</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
              {items.length} item{items.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="mt-3 max-h-[40vh] overflow-auto pr-1">
            {items.length === 0 ? (
              <div className="text-sm text-neutral-600">No tools selected yet. Add quantities from the left.</div>
            ) : (
              <ul className="space-y-2">
                {items.map((it) => (
                  <li key={it.tool_id} className="flex items-center justify-between rounded-xl bg-white border border-neutral-200 px-3 py-2">
                    <div className="text-sm font-medium text-neutral-900 truncate">{it.tool_name}</div>
                    <div className="text-xs font-semibold text-emerald-700">x{it.quantity}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Button
            className="mt-4 w-full"
            onClick={submit}
            disabled={submitting || items.length === 0}
          >
            <Send className="h-4 w-4" />
            {submitting ? 'Submitting…' : 'Submit Request'}
          </Button>
        </div>
      </div>

      {/* My recent requests with delivery confirmation */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-neutral-900">My Recent Requests</h3>
        {myReqs.length === 0 ? (
          <div className="rounded-2xl p-4 bg-white border border-neutral-200 text-sm text-neutral-600">
            You haven't submitted any requests yet.
          </div>
        ) : (
          <div className="grid gap-3">
            {myReqs.map((r) => {
              const open = openReqId === r.id;
              const lines = r.lines || r.requested_tools || [];
              
              return (
                <div key={r.id} className="rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-white to-emerald-50">
                  {/* Header */}
                  <button
                    type="button"
                    onClick={() => setOpenReqId(open ? null : r.id)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-emerald-50/70 transition"
                    aria-expanded={open}
                  >
                    <div className="flex items-center gap-3">
                      <ChevronDown className={`h-5 w-5 text-emerald-700 transition-transform ${open ? 'rotate-180' : ''}`} />
                      <div className="font-medium">Request #{r.id}</div>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                        r.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' :
                        r.status === 'Rejected' ? 'bg-rose-100 text-rose-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {r.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-neutral-600">
                      {r.date_requested ? new Date(r.date_requested).toLocaleString() : ''}
                    </div>
                  </button>

                  {/* Body */}
                  <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                    <div className="overflow-hidden">
                      <div className="px-4 pb-4">
                        <ul className="grid gap-2 sm:grid-cols-2">
                          {lines.map((ln) => (
                            <li key={ln.id} className="rounded-xl border border-neutral-200 bg-white px-3 py-2">
                              <div className="flex items-center justify-between">
                                <div className="text-sm text-neutral-900">{ln.tool_name}</div>
                                <div className="text-xs font-medium text-neutral-700">x{ln.quantity}</div>
                              </div>
                              <div className="flex items-center justify-between mt-2">
                                <div className="text-[11px] text-neutral-500">Line status: {ln.status}</div>
                                
                                {/* Delivery actions for approved items */}
                                {r.status === 'Approved' && ln.status === 'Approved' && (
                                  <div className="flex items-center gap-2">
                                    {!ln.isDelivered && ln.canConfirm !== false && (
                                      <Button
                                        size="sm"
                                        color="emerald"
                                        onClick={() => setConfirmDialog({
                                          open: true,
                                          requestedToolId: ln.id,
                                          toolName: ln.tool_name,
                                          quantity: ln.quantity
                                        })}
                                      >
                                        <CheckCircle className="h-3 w-3" />
                                        Confirm
                                      </Button>
                                    )}
                                    {ln.isDelivered && ln.deliveryId && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        color="blue"
                                        onClick={() => downloadDeliveryNote(ln.deliveryId)}
                                      >
                                        <Download className="h-3 w-3" />
                                        Note
                                      </Button>
                                    )}
                                    {ln.isDelivered && (
                                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                                        Delivered ✓
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                        
                        {/* approval metadata */}
                        <div className="text-[11px] text-neutral-600 mt-3">
                          {r.status === 'Approved' && r.date_approved && (
                            <>Approved: {new Date(r.date_approved).toLocaleString()}{r.approved_by?.name ? ` • by ${r.approved_by.name}` : ''}</>
                          )}
                          {r.status === 'Rejected' && r.date_rejected && (
                            <>Rejected: {new Date(r.date_rejected).toLocaleString()}{r.approved_by?.name ? ` • by ${r.approved_by.name}` : ''}</>
                          )}
                        </div>
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