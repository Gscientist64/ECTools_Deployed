import React, { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import { useToast } from './toasts';
import { useAuth } from './auth';
import { FileText, Download, Search, ChevronDown, ChevronRight, Package, CheckCircle } from 'lucide-react';

export default function DeliveryNotesScreen() {
  const { me } = useAuth();
  const { push } = useToast();

  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  const isAdmin = me?.role && ['admin', 'administrator', 'superadmin', 'hq_admin', 'hq admin'].includes(me.role.toLowerCase());

  const fetchNotes = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.listConfirmedDeliveryNotes();
      setNotes(Array.isArray(data) ? data : []);
    } catch (err) {
      push(`Failed to load delivery notes: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleDownload = async (deliveryId) => {
    try {
      setDownloadingId(deliveryId);
      const blob = await api.downloadDeliveryNote(deliveryId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `delivery_note_${deliveryId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      push('Delivery note downloaded', 'success');
    } catch (err) {
      push(`Download failed: ${err.message}`, 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const filteredNotes = notes.filter(n => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      String(n.id).includes(s) ||
      (n.tool_name || '').toLowerCase().includes(s) ||
      (n.received_by_name || '').toLowerCase().includes(s) ||
      (n.facility || '').toLowerCase().includes(s) ||
      (n.witnessed_by || '').toLowerCase().includes(s)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-emerald-600" />
          <h2 className="text-xl font-semibold">Confirmed Delivery Notes</h2>
          {!loading && (
            <span className="text-sm text-neutral-500 bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded-full">
              {filteredNotes.length} note{filteredNotes.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by ID, tool name, facility, recipient..."
          className="w-full max-w-md pl-10 pr-4 py-2 border border-neutral-300 dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-800 text-sm"
        />
      </div>

      {/* Notes List */}
      {loading ? (
        <div className="text-center py-8 text-neutral-500">Loading...</div>
      ) : filteredNotes.length === 0 ? (
        <div className="text-center py-8 text-neutral-400">
          <Package className="h-10 w-10 mx-auto mb-2 opacity-50" />
          {search ? 'No delivery notes match your search' : 'No confirmed delivery notes yet'}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredNotes.map(n => (
            <div
              key={n.id}
              className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl overflow-hidden"
            >
              {/* Header row */}
              <div
                className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-850"
                onClick={() => toggleExpand(n.id)}
              >
                <div className="flex items-center gap-3">
                  {expandedId === n.id ? (
                    <ChevronDown className="h-4 w-4 text-neutral-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-neutral-400" />
                  )}
                  <CheckCircle className="h-5 w-5 text-emerald-500" />
                  <div>
                    <span className="font-semibold text-sm">Delivery Note #{n.id}</span>
                    <span className="text-neutral-500 text-xs ml-3">
                      {n.tool_name} — {n.quantity_supplied} {n.basic_unit || 'unit'}{n.quantity_supplied !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-neutral-500">
                  {isAdmin && n.facility && (
                    <span className="bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">
                      {n.facility}
                    </span>
                  )}
                  <span>
                    {n.delivery_confirmed_at
                      ? new Date(n.delivery_confirmed_at).toLocaleDateString()
                      : n.delivery_date
                        ? new Date(n.delivery_date).toLocaleDateString()
                        : '—'}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDownload(n.id); }}
                    disabled={downloadingId === n.id}
                    className="flex items-center gap-1 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 disabled:opacity-50 text-xs font-medium transition"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {downloadingId === n.id ? 'Downloading...' : 'Download'}
                  </button>
                </div>
              </div>

              {/* Expanded detail */}
              {expandedId === n.id && (
                <div className="border-t border-neutral-100 dark:border-neutral-800 px-5 py-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                    <div>
                      <span className="text-neutral-500 block text-xs uppercase tracking-wide">Delivery Note #</span>
                      <span className="font-medium">{n.id}</span>
                    </div>
                    <div>
                      <span className="text-neutral-500 block text-xs uppercase tracking-wide">Tool</span>
                      <span className="font-medium">{n.tool_name}</span>
                    </div>
                    <div>
                      <span className="text-neutral-500 block text-xs uppercase tracking-wide">Quantity Supplied</span>
                      <span className="font-medium">{n.quantity_supplied} {n.basic_unit || 'unit'}{n.quantity_supplied !== 1 ? 's' : ''}</span>
                    </div>
                    <div>
                      <span className="text-neutral-500 block text-xs uppercase tracking-wide">Received By</span>
                      <span className="font-medium">{n.received_by_name}</span>
                    </div>
                    <div>
                      <span className="text-neutral-500 block text-xs uppercase tracking-wide">Facility</span>
                      <span className="font-medium">{n.facility || '—'}</span>
                    </div>
                    <div>
                      <span className="text-neutral-500 block text-xs uppercase tracking-wide">Witnessed By</span>
                      <span className="font-medium">{n.witnessed_by || '—'}</span>
                    </div>
                    <div>
                      <span className="text-neutral-500 block text-xs uppercase tracking-wide">Delivery Date</span>
                      <span className="font-medium">
                        {n.delivery_date ? new Date(n.delivery_date).toLocaleDateString() : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-neutral-500 block text-xs uppercase tracking-wide">Confirmed At</span>
                      <span className="font-medium">
                        {n.delivery_confirmed_at
                          ? new Date(n.delivery_confirmed_at).toLocaleString()
                          : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-neutral-500 block text-xs uppercase tracking-wide">Request Status</span>
                      <span className={`font-medium ${(n.request_status || '').toLowerCase() === 'approved' ? 'text-emerald-600' : 'text-neutral-600'}`}>
                        {n.request_status}
                      </span>
                    </div>
                    <div>
                      <span className="text-neutral-500 block text-xs uppercase tracking-wide">Note Generated</span>
                      <span className={`font-medium ${n.has_note ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {n.has_note ? 'Yes' : 'No'}
                      </span>
                    </div>
                    <div className="flex items-end">
                      <button
                        onClick={() => handleDownload(n.id)}
                        disabled={downloadingId === n.id}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm hover:bg-emerald-700 disabled:opacity-50 transition"
                      >
                        <Download className="h-4 w-4" />
                        {downloadingId === n.id ? 'Downloading...' : 'Download PDF'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}