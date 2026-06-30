import React, { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import { useToast } from './toasts';
import { useAuth } from './auth';
import { fmtDate } from './utils';
import { Package, Plus, Trash2, X, ChevronDown, ChevronRight, Search } from 'lucide-react';

export default function StockReceiptsScreen() {
  const { me } = useAuth();
  const { push } = useToast();

  const [receipts, setReceipts] = useState([]);
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [toolSearch, setToolSearch] = useState('');
  const [receiptSearch, setReceiptSearch] = useState('');

  // Form state
  const [suppliedFrom, setSuppliedFrom] = useState('');
  const [suppliedBy, setSuppliedBy] = useState('');
  const [dateSupplied, setDateSupplied] = useState('');
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([]); // [{ tool_id, tool_name, serial_number, quantity_received }]

  // Row being added
  const [selectedToolId, setSelectedToolId] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [qtyReceived, setQtyReceived] = useState('');

  const fetchReceipts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.listStockReceipts();
      setReceipts(Array.isArray(data) ? data : []);
    } catch (err) {
      push(`Failed to load receipts: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [push]);

  const fetchTools = useCallback(async () => {
    try {
      const data = await api.tools();
      setTools(Array.isArray(data) ? data : []);
    } catch (err) {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchReceipts();
    fetchTools();
  }, [fetchReceipts, fetchTools]);

  const resetForm = () => {
    setSuppliedFrom('');
    setSuppliedBy('');
    setDateSupplied('');
    setReceivedDate(new Date().toISOString().slice(0, 10));
    setNotes('');
    setLines([]);
    setSelectedToolId('');
    setSerialNumber('');
    setQtyReceived('');
    setToolSearch('');
  };

  const addLine = () => {
    const tid = parseInt(selectedToolId, 10);
    if (!tid) {
      push('Please select a tool', 'error');
      return;
    }
    const qty = parseInt(qtyReceived, 10);
    if (!qty || qty <= 0) {
      push('Please enter a valid quantity', 'error');
      return;
    }
    const tool = tools.find(t => t.id === tid);
    // Prevent duplicate tool in same receipt
    if (lines.some(l => l.tool_id === tid)) {
      push('This tool is already in the receipt lines', 'error');
      return;
    }
    setLines([...lines, {
      tool_id: tid,
      tool_name: tool?.name || `Tool #${tid}`,
      category: tool?.category || 'Uncategorized',
      serial_number: tool?.category || 'Uncategorized', // keep for backend compat
      quantity_received: qty,
    }]);
    setSelectedToolId('');
    setSerialNumber('');
    setQtyReceived('');
    setToolSearch('');
  };

  const removeLine = (idx) => {
    setLines(lines.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    if (!suppliedFrom.trim()) {
      push('"Supplied From" is required', 'error');
      return;
    }
    if (!suppliedBy.trim()) {
      push('"Supplied By" is required', 'error');
      return;
    }
    if (lines.length === 0) {
      push('Add at least one tool line', 'error');
      return;
    }

    try {
      setSubmitting(true);
      await api.createStockReceipt({
        supplied_from: suppliedFrom.trim(),
        supplied_by: suppliedBy.trim(),
        date_supplied: dateSupplied || undefined,
        received_date: receivedDate || undefined,
        received_by: me?.id,
        notes: notes.trim(),
        lines: lines.map(l => ({
          tool_id: l.tool_id,
          serial_number: l.serial_number,
          quantity_received: l.quantity_received,
        })),
      });
      push('Stock receipt created', 'success');
      resetForm();
      setShowForm(false);
      fetchReceipts();
    } catch (err) {
      push(`Error: ${err.message}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this receipt? Tool quantities will be reverted.')) return;
    try {
      await api.deleteStockReceipt(id);
      push('Receipt deleted', 'success');
      fetchReceipts();
    } catch (err) {
      push(`Error: ${err.message}`, 'error');
    }
  };

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const filteredTools = tools.filter(t =>
    !toolSearch || t.name.toLowerCase().includes(toolSearch.toLowerCase())
  );

  const filteredReceipts = receipts.filter(r => {
    if (!receiptSearch) return true;
    const s = receiptSearch.toLowerCase();
    return (
      String(r.id).includes(s) ||
      (r.supplied_from || '').toLowerCase().includes(s) ||
      (r.supplied_by || '').toLowerCase().includes(s) ||
      (r.received_by_name || '').toLowerCase().includes(s)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Package className="h-6 w-6 text-emerald-600" />
          <h2 className="text-xl font-semibold">Delivery Receipts</h2>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(!showForm); }}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm hover:bg-emerald-700 transition"
        >
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? 'Cancel' : 'New Receipt'}
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-6 space-y-4">
          <h3 className="font-semibold text-lg">New Stock Receipt</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Date Supplied</label>
              <input type="date" value={dateSupplied} onChange={e => setDateSupplied(e.target.value)}
                className="w-full border border-neutral-300 dark:border-neutral-700 rounded-xl px-3 py-2 bg-white dark:bg-neutral-800" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Received Date</label>
              <input type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)}
                className="w-full border border-neutral-300 dark:border-neutral-700 rounded-xl px-3 py-2 bg-white dark:bg-neutral-800" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Supplied From *</label>
              <select value={suppliedFrom} onChange={e => setSuppliedFrom(e.target.value)}
                className="w-full border border-neutral-300 dark:border-neutral-700 rounded-xl px-3 py-2 bg-white dark:bg-neutral-800">
                <option value="">Select source...</option>
                <option value="HQ">HQ</option>
                <option value="State Office (Lagos)">State Office (Lagos)</option>
                <option value="State Office (Akwa Ibom)">State Office (Akwa Ibom)</option>
                <option value="State Office (CRS)">State Office (CRS)</option>
                <option value="NASCP">NASCP</option>
                <option value="IP">IP</option>
                <option value="Others">Others</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Supplied By *</label>
              <input type="text" value={suppliedBy} onChange={e => setSuppliedBy(e.target.value)}
                placeholder="Person who supplied"
                className="w-full border border-neutral-300 dark:border-neutral-700 rounded-xl px-3 py-2 bg-white dark:bg-neutral-800" />
            </div>
          </div>

          {/* Lines table */}
          <div className="border-t pt-4">
            <h4 className="font-medium mb-2">Tools Received</h4>

            {/* Add line row */}
            <div className="flex flex-wrap gap-2 mb-3 items-end">
              <div className="relative">
                <label className="block text-xs mb-1">Tool</label>
                <input type="text" value={toolSearch} onChange={e => setToolSearch(e.target.value)}
                  placeholder="Search tool..."
                  className="w-48 border border-neutral-300 dark:border-neutral-700 rounded-xl px-3 py-2 bg-white dark:bg-neutral-800 text-sm" />
                {toolSearch && filteredTools.length > 0 && (
                  <div className="absolute z-10 bg-white dark:bg-neutral-800 border rounded-xl mt-1 max-h-40 overflow-y-auto shadow-lg w-64">
                    {filteredTools.slice(0, 20).map(t => (
                      <button key={t.id} type="button"
                        onClick={() => { setSelectedToolId(String(t.id)); setToolSearch(t.name); }}
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700">
                        {t.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs mb-1">Category</label>
                <input type="text" 
                  value={selectedToolId ? (tools.find(t => t.id === parseInt(selectedToolId, 10))?.category || 'Uncategorized') : ''}
                  readOnly
                  className="w-44 border border-neutral-200 rounded-xl px-3 py-2 bg-neutral-50 text-sm text-neutral-600" />
              </div>
              <div>
                <label className="block text-xs mb-1">Qty Received</label>
                <input type="number" min="1" value={qtyReceived} onChange={e => setQtyReceived(e.target.value)}
                  className="w-24 border border-neutral-300 dark:border-neutral-700 rounded-xl px-3 py-2 bg-white dark:bg-neutral-800 text-sm" />
              </div>
              <button onClick={addLine}
                className="px-3 py-2 bg-emerald-600 text-white rounded-xl text-sm hover:bg-emerald-700">
                <Plus className="h-4 w-4" />
              </button>
            </div>

            {/* Lines table */}
            {lines.length > 0 && (
              <table className="w-full text-sm mt-2">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-neutral-500">
                    <th className="py-2 pr-2">#</th>
                    <th className="py-2 pr-2">Tool Name</th>
                    <th className="py-2 pr-2">Category</th>
                    <th className="py-2 pr-2">Qty Received</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className="border-b border-neutral-100 dark:border-neutral-800">
                      <td className="py-2 pr-2">{i + 1}</td>
                      <td className="py-2 pr-2 font-medium">{l.tool_name}</td>
                      <td className="py-2 pr-2 text-neutral-500">{l.category || l.serial_number}</td>
                      <td className="py-2 pr-2">{l.quantity_received}</td>
                      <td className="py-2">
                        <button onClick={() => removeLine(i)}
                          className="text-red-500 hover:text-red-700"><X className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Optional remarks..."
              rows={2}
              className="w-full border border-neutral-300 dark:border-neutral-700 rounded-xl px-3 py-2 bg-white dark:bg-neutral-800" />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => { resetForm(); setShowForm(false); }}
              className="px-4 py-2 border border-neutral-300 rounded-xl text-sm hover:bg-neutral-100">
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={submitting}
              className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm hover:bg-emerald-700 disabled:opacity-50">
              {submitting ? 'Saving...' : 'Save Receipt'}
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
        <input type="text" value={receiptSearch} onChange={e => setReceiptSearch(e.target.value)}
          placeholder="Search receipts by ID, supplier, or receiver..."
          className="w-full max-w-md pl-10 pr-4 py-2 border border-neutral-300 dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-800 text-sm" />
      </div>

      {/* Receipts List */}
      {loading ? (
        <div className="text-center py-8 text-neutral-500">Loading...</div>
      ) : filteredReceipts.length === 0 ? (
        <div className="text-center py-8 text-neutral-400">
          <Package className="h-10 w-10 mx-auto mb-2 opacity-50" />
          No Delivery found
        </div>
      ) : (
        <div className="space-y-3">
          {filteredReceipts.map(r => (
            <div key={r.id} className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl overflow-hidden">
              {/* Header row */}
              <div
                className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-850"
                onClick={() => toggleExpand(r.id)}
              >
                <div className="flex items-center gap-3">
                  {expandedId === r.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <div>
                    <span className="font-semibold text-sm">Receipt #{r.id}</span>
                    <span className="text-neutral-500 text-xs ml-3">
                      {(r.lines || []).length} tool{(r.lines || []).length !== 1 ? 's' : ''} received
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-neutral-500">
                  <span>{r.supplied_from}</span>
                  <span>{fmtDate(r.received_date)}</span>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}
                    className="text-red-500 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>

              {/* Expanded detail */}
              {expandedId === r.id && (
                <div className="border-t px-5 py-4 space-y-2 text-sm">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div><span className="text-neutral-500">Date Supplied:</span> {fmtDate(r.date_supplied)}</div>
                    <div><span className="text-neutral-500">Supplied From:</span> {r.supplied_from}</div>
                    <div><span className="text-neutral-500">Supplied By:</span> {r.supplied_by}</div>
                    <div><span className="text-neutral-500">Received By:</span> {r.received_by_name || `User #${r.received_by}`}</div>
                    <div><span className="text-neutral-500">Received Date:</span> {fmtDate(r.received_date)}</div>
                    <div><span className="text-neutral-500">Notes:</span> {r.notes || '—'}</div>
                  </div>

                  {/* Lines detail table */}
                  {(r.lines || []).length > 0 && (
                    <div className="mt-3">
                      <h5 className="text-xs font-semibold uppercase text-neutral-500 mb-1">Tools Received</h5>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs uppercase text-neutral-400">
                            <th className="py-1 pr-2">Serial #</th>
                            <th className="py-1 pr-2">Tool Name</th>
                            <th className="py-1 pr-2 text-right">Qty</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(r.lines || []).map((l, i) => (
                            <tr key={i} className="border-b border-neutral-100 dark:border-neutral-800">
                              <td className="py-1 pr-2">{l.serial_number || '—'}</td>
                              <td className="py-1 pr-2 font-medium">{l.tool_name}</td>
                              <td className="py-1 pr-2 text-right">{l.quantity_received}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}