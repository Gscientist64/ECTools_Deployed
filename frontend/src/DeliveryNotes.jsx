import React, { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import { useToast } from './toasts';
import { useAuth } from './auth';
import { fmtDate } from './utils';
import { FileText, Download, Search, ChevronDown, ChevronRight, Package, CheckCircle, Eye, X, MapPin, User } from 'lucide-react';

export default function DeliveryNotesScreen() {
  const { me } = useAuth();
  const { push } = useToast();

  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

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

  const handleDownload = async (requestId) => {
    try {
      setDownloadingId(requestId);
      const blob = await api.downloadRequestDeliveryNote(requestId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `delivery_note_req_${requestId}.pdf`;
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

  const handleView = async (requestId) => {
    try {
      setPreviewLoading(true);
      const data = await api.getDeliveryNotePreview(requestId);
      setPreviewData(data);
    } catch (err) {
      push(`Failed to load preview: ${err.message}`, 'error');
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setPreviewData(null);
  };

  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') closePreview();
    };
    if (previewData) {
      document.addEventListener('keydown', handleEsc);
      return () => document.removeEventListener('keydown', handleEsc);
    }
  }, [previewData]);

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const filteredNotes = notes.filter(n => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      String(n.request_id).includes(s) ||
      (n.facility || '').toLowerCase().includes(s) ||
      (n.received_by_name || '').toLowerCase().includes(s) ||
      (n.items || []).some(item => (item.tool_name || '').toLowerCase().includes(s))
    );
  });

  const PreviewModal = previewData && (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={closePreview}>
      <div
        className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="sticky top-0 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <div>
            <h3 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">Delivery Note Preview</h3>
            <p className="text-sm text-neutral-500">Request #{previewData.request_id}</p>
          </div>
          <button onClick={closePreview} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition">
            <X className="h-5 w-5 text-neutral-500" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="px-6 py-5 space-y-6">
          {/* Header Info */}
          <div className="bg-neutral-50 dark:bg-neutral-800 rounded-xl p-5">
            <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-100 mb-4">DELIVERY NOTE</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-neutral-500 text-xs uppercase tracking-wide">Delivery Note #</span>
                <p className="font-semibold">{previewData.request_id}</p>
              </div>
              <div>
                <span className="text-neutral-500 text-xs uppercase tracking-wide">Date</span>
                <p className="font-semibold">{fmtDate(new Date().toISOString())}</p>
              </div>
            </div>
          </div>

          {/* Recipient Info */}
          <div>
            <h4 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 uppercase tracking-wide mb-2">Deliver To:</h4>
            <div className="space-y-1 text-sm">
              <p className="flex items-center gap-2 text-neutral-700 dark:text-neutral-300">
                <User className="h-4 w-4 text-neutral-400" />
                <span className="font-medium">{previewData.received_by_name}</span>
              </p>
              <p className="flex items-center gap-2 text-neutral-700 dark:text-neutral-300">
                <MapPin className="h-4 w-4 text-neutral-400" />
                <span>{previewData.facility}</span>
              </p>
              {previewData.received_by_email && (
                <p className="text-neutral-500 text-xs ml-6">{previewData.received_by_email}</p>
              )}
            </div>
          </div>

          {/* Items Table */}
          <div>
            <h4 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 uppercase tracking-wide mb-2">Items Supplied:</h4>
            <div className="overflow-hidden border border-neutral-200 dark:border-neutral-700 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-neutral-100 dark:bg-neutral-800">
                    <th className="text-left px-4 py-2.5 font-semibold text-neutral-700 dark:text-neutral-300">Tool Name</th>
                    <th className="text-center px-4 py-2.5 font-semibold text-neutral-700 dark:text-neutral-300">Unit</th>
                    <th className="text-center px-4 py-2.5 font-semibold text-neutral-700 dark:text-neutral-300">Qty Supplied</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {previewData.items.map((item, idx) => (
                    <tr key={idx} className="hover:bg-neutral-50 dark:hover:bg-neutral-850">
                      <td className="px-4 py-2.5 text-neutral-900 dark:text-neutral-100">{item.tool_name}</td>
                      <td className="px-4 py-2.5 text-center text-neutral-600 dark:text-neutral-400">{item.basic_unit}</td>
                      <td className="px-4 py-2.5 text-center font-semibold text-neutral-900 dark:text-neutral-100">{item.quantity_supplied}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Signatures */}
          <div>
            <h4 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 uppercase tracking-wide mb-3">Delivery Confirmation:</h4>
            <div className="grid grid-cols-3 gap-4 text-center text-xs">
              <div>
                <div className="border-b border-neutral-300 dark:border-neutral-600 pb-8 mb-1"></div>
                <p className="font-medium text-neutral-700 dark:text-neutral-300">{previewData.distributed_by_name}</p>
                <p className="text-neutral-400 italic">({previewData.distributed_by_role})</p>
                <p className="text-neutral-500 text-xs mt-0.5">Distributed By</p>
              </div>
              <div>
                <div className="border-b border-neutral-300 dark:border-neutral-600 pb-8 mb-1"></div>
                <p className="font-medium text-neutral-700 dark:text-neutral-300">{previewData.received_by_name}</p>
                <p className="text-neutral-400 italic">(Recipient)</p>
                <p className="text-neutral-500 text-xs mt-0.5">Received By</p>
              </div>
              <div>
                <div className="border-b border-neutral-300 dark:border-neutral-600 pb-8 mb-1"></div>
                <p className="font-medium text-neutral-700 dark:text-neutral-300">{previewData.items[0]?.witnessed_by || '_________________'}</p>
                <p className="text-neutral-400 italic">(Witness)</p>
                <p className="text-neutral-500 text-xs mt-0.5">Witnessed By</p>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="sticky bottom-0 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800 px-6 py-4 flex items-center justify-between rounded-b-2xl">
          <p className="text-xs text-neutral-400 italic">This delivery note is system-generated.</p>
          <button
            onClick={() => { closePreview(); handleDownload(previewData.request_id); }}
            disabled={downloadingId === previewData.request_id}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition"
          >
            <Download className="h-4 w-4" />
            {downloadingId === previewData.request_id ? 'Downloading...' : 'Download PDF'}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-emerald-600" />
          <h2 className="text-xl font-semibold">Confirmed Delivery Notes</h2>
          {!loading && (
            <span className="text-sm text-neutral-500 bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded-full">
              {filteredNotes.length} request{filteredNotes.length !== 1 ? 's' : ''}
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
          placeholder="Search by request ID, facility, tool name..."
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
              key={n.request_id}
              className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl overflow-hidden"
            >
              {/* Header row */}
              <div
                className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-850"
                onClick={() => toggleExpand(n.request_id)}
              >
                <div className="flex items-center gap-3">
                  {expandedId === n.request_id ? (
                    <ChevronDown className="h-4 w-4 text-neutral-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-neutral-400" />
                  )}
                  <CheckCircle className="h-5 w-5 text-emerald-500" />
                  <div>
                    <span className="font-semibold text-sm">Request #{n.request_id}</span>
                    <span className="text-neutral-500 text-xs ml-3">
                      {(n.items || []).length} tool{(n.items || []).length !== 1 ? 's' : ''} —{' '}
                      {(n.items || []).reduce((sum, i) => sum + i.quantity_supplied, 0)} total item{(n.items || []).reduce((sum, i) => sum + i.quantity_supplied, 0) !== 1 ? 's' : ''}
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
                    {fmtDate(n.delivery_confirmed_at || n.delivery_date)}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleView(n.request_id); }}
                    disabled={previewLoading}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 disabled:opacity-50 text-xs font-medium transition"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    View
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDownload(n.request_id); }}
                    disabled={downloadingId === n.request_id}
                    className="flex items-center gap-1 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 disabled:opacity-50 text-xs font-medium transition"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {downloadingId === n.request_id ? 'Downloading...' : 'Download'}
                  </button>
                </div>
              </div>

              {/* Expanded detail - show all tool items */}
              {expandedId === n.request_id && (
                <div className="border-t border-neutral-100 dark:border-neutral-800 px-5 py-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
                    <div>
                      <span className="text-neutral-500 block text-xs uppercase tracking-wide">Request #</span>
                      <span className="font-medium">{n.request_id}</span>
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
                      <span className="text-neutral-500 block text-xs uppercase tracking-wide">Status</span>
                      <span className={`font-medium ${(n.request_status || '').toLowerCase() === 'approved' ? 'text-emerald-600' : 'text-neutral-600'}`}>
                        {n.request_status}
                      </span>
                    </div>
                  </div>

                  {/* Items table */}
                  <div className="overflow-hidden border border-neutral-200 dark:border-neutral-700 rounded-xl mb-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-neutral-50 dark:bg-neutral-800">
                          <th className="text-left px-4 py-2 font-semibold text-neutral-600 dark:text-neutral-400">Tool</th>
                          <th className="text-center px-4 py-2 font-semibold text-neutral-600 dark:text-neutral-400">Unit</th>
                          <th className="text-center px-4 py-2 font-semibold text-neutral-600 dark:text-neutral-400">Qty</th>
                          <th className="text-center px-4 py-2 font-semibold text-neutral-600 dark:text-neutral-400">Witnessed By</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                        {(n.items || []).map((item, idx) => (
                          <tr key={idx}>
                            <td className="px-4 py-2 text-neutral-900 dark:text-neutral-100">{item.tool_name}</td>
                            <td className="px-4 py-2 text-center text-neutral-600 dark:text-neutral-400">{item.basic_unit || 'unit'}</td>
                            <td className="px-4 py-2 text-center font-semibold text-neutral-900 dark:text-neutral-100">{item.quantity_supplied}</td>
                            <td className="px-4 py-2 text-center text-neutral-500 text-xs">{item.witnessed_by || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleView(n.request_id)}
                      disabled={previewLoading}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm hover:bg-blue-700 disabled:opacity-50 transition"
                    >
                      <Eye className="h-4 w-4" />
                      {previewLoading ? 'Loading...' : 'View Preview'}
                    </button>
                    <button
                      onClick={() => handleDownload(n.request_id)}
                      disabled={downloadingId === n.request_id}
                      className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm hover:bg-emerald-700 disabled:opacity-50 transition"
                    >
                      <Download className="h-4 w-4" />
                      {downloadingId === n.request_id ? 'Downloading...' : 'Download PDF'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Preview Modal */}
      {PreviewModal}
    </div>
  );
}
