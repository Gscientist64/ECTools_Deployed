// myInventory.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from './api';
import { useToast } from './toasts';
import { Package, ArrowRightLeft, ClipboardCheck, Loader2, AlertTriangle, CheckCircle, XCircle, RefreshCw, Search } from 'lucide-react';

const DEPARTMENTS = [
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'lab', label: 'Lab' },
  { value: 'triage', label: 'Triage' },
  { value: 'community', label: 'Community' },
  { value: 'm&e', label: 'M&E' },
  { value: 'others', label: 'Others' },
];

// Searchable tool name dropdown component
function ToolSearchInput({ value, onChange, placeholder, className, required, toolsList, loadingTools, onSearchChange }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = (toolsList || []).filter(t =>
    t.name.toLowerCase().includes((value || '').toLowerCase())
  );

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={e => { onChange(e.target.value); onSearchChange && onSearchChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder || "Search tool name..."}
          className={`border border-neutral-300 rounded-lg px-3 py-2 text-sm w-56 pr-8 bg-white ${className || ''}`}
          required={required}
          autoComplete="off"
        />
        <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
      </div>
      {open && value && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-neutral-200 rounded-lg shadow-lg">
          {filtered.map(t => (
            <button
              key={t.id}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 hover:text-emerald-700 border-b border-neutral-50 last:border-0"
              onClick={() => { onChange(t.name); setOpen(false); }}
            >
              <span className="font-medium">{t.name}</span>
              {t.category && <span className="text-xs text-neutral-400 ml-2">({t.category})</span>}
            </button>
          ))}
        </div>
      )}
      {loadingTools && (
        <div className="absolute right-8 top-1/2 -translate-y-1/2">
          <Loader2 className="h-3 w-3 animate-spin text-neutral-400" />
        </div>
      )}
    </div>
  );
}

export default function MyInventoryScreen() {
  const { push } = useToast();
  const [view, setView] = useState('stock'); // stock | distribute | counts | summary
  const [loading, setLoading] = useState(false);

  // Stock data
  const [stock, setStock] = useState([]);
  const [distributions, setDistributions] = useState([]);
  const [counts, setCounts] = useState([]);
  const [summary, setSummary] = useState(null);

  // Tools list for search
  const [toolsList, setToolsList] = useState([]);
  const [toolsLoading, setToolsLoading] = useState(false);

  // Distribute form
  const [distToolName, setDistToolName] = useState('');
  const [distDepartment, setDistDepartment] = useState('');
  const [distQuantity, setDistQuantity] = useState('');

  // Physical count form
  const [countToolName, setCountToolName] = useState('');
  const [countQuantity, setCountQuantity] = useState('');

  // Fetch tools list for search
  const fetchTools = useCallback(async () => {
    setToolsLoading(true);
    try {
      const data = await api.tools();
      setToolsList(Array.isArray(data) ? data : []);
    } catch (e) {
      // silent
    } finally {
      setToolsLoading(false);
    }
  }, []);

  useEffect(() => { fetchTools(); }, [fetchTools]);

  const findToolId = (name) => {
    const tool = toolsList.find(t => t.name.toLowerCase() === name.toLowerCase());
    return tool ? tool.id : null;
  };

  const fetchStock = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.myStock();
      setStock(data);
    } catch (e) {
      push(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [push]);

  const fetchDistributions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.myDistributions();
      setDistributions(data);
    } catch (e) {
      push(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [push]);

  const fetchCounts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.myPhysicalCounts();
      setCounts(data);
    } catch (e) {
      push(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [push]);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.myInventorySummary();
      setSummary(data);
    } catch (e) {
      push(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    if (view === 'stock') fetchStock();
    else if (view === 'distribute') fetchDistributions();
    else if (view === 'counts') fetchCounts();
    else if (view === 'summary') fetchSummary();
  }, [view, fetchStock, fetchDistributions, fetchCounts, fetchSummary]);

  const handleDistribute = async (e) => {
    e.preventDefault();
    if (!distToolName.trim()) { push('Select a tool name', 'error'); return; }
    if (!distDepartment) { push('Select a department', 'error'); return; }

    const toolId = findToolId(distToolName.trim());
    if (!toolId) { push('Tool not found. Please select from the dropdown.', 'error'); return; }

    try {
      await api.distributeToDepartment({
        tool_id: toolId,
        department: distDepartment,
        basic_unit: 'unit',
        quantity: parseInt(distQuantity) || 1
      });
      push('Distribution recorded', 'success');
      setDistToolName('');
      setDistDepartment('');
      setDistQuantity('');
      fetchDistributions();
      fetchStock();
    } catch (e) {
      push(e.message, 'error');
    }
  };

  const handlePhysicalCount = async (e) => {
    e.preventDefault();
    if (!countToolName.trim()) { push('Select a tool name', 'error'); return; }

    const toolId = findToolId(countToolName.trim());
    if (!toolId) { push('Tool not found. Please select from the dropdown.', 'error'); return; }

    try {
      await api.recordPhysicalCount({
        tool_id: toolId,
        physical_count: parseInt(countQuantity) || 0
      });
      push('Physical count recorded', 'success');
      setCountToolName('');
      setCountQuantity('');
      fetchCounts();
      fetchStock();
    } catch (e) {
      push(e.message, 'error');
    }
  };

  const tabClass = (t) => `px-4 py-2 text-sm font-medium rounded-xl transition ${view === t ? 'bg-emerald-600 text-white' : 'bg-neutral-100 hover:bg-neutral-200'}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Package className="h-6 w-6 text-emerald-700" />
        <h1 className="text-xl font-bold">My Inventory</h1>
      </div>

      {/* Tab Bar */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setView('stock')} className={tabClass('stock')}>Stock Levels</button>
        <button onClick={() => setView('distribute')} className={tabClass('distribute')}>Distribute</button>
        <button onClick={() => setView('counts')} className={tabClass('counts')}>Physical Counts</button>
        <button onClick={() => setView('summary')} className={tabClass('summary')}>Summary</button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      )}

      {/* ---------- STOCK VIEW ---------- */}
      {view === 'stock' && !loading && (
        <div className="bg-white rounded-2xl shadow border border-neutral-200 overflow-hidden">
          <div className="p-4 border-b border-neutral-100 flex items-center justify-between">
            <h2 className="font-semibold">Current Stock Levels</h2>
            <button onClick={fetchStock} className="p-1.5 hover:bg-neutral-100 rounded-lg" title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Quantity</th>
                  <th className="text-left px-4 py-3">Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {stock.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-neutral-400">No stock records found</td></tr>
                ) : stock.map((s) => (
                  <tr key={s.id} className="border-t border-neutral-100">
                    <td className="px-4 py-3">{s.tool_name || s.name || '—'}</td>
                    <td className="px-4 py-3 font-semibold">{s.quantity}</td>
                    <td className="px-4 py-3 text-neutral-500 text-xs">{s.updated_at ? new Date(s.updated_at).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------- DISTRIBUTE VIEW ---------- */}
      {view === 'distribute' && !loading && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow border border-neutral-200 p-5">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4" /> Distribute to Department
            </h2>
            <form onSubmit={handleDistribute} className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">Tool Name</label>
                <ToolSearchInput
                  value={distToolName}
                  onChange={setDistToolName}
                  placeholder="Search tool name..."
                  toolsList={toolsList}
                  loadingTools={toolsLoading}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">Department</label>
                <select
                  value={distDepartment}
                  onChange={e => setDistDepartment(e.target.value)}
                  className="border border-neutral-300 rounded-lg px-3 py-2 text-sm w-44 bg-white"
                  required
                >
                  <option value="">Select department...</option>
                  {DEPARTMENTS.map(d => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">Quantity</label>
                <input
                  type="number"
                  min="1"
                  value={distQuantity}
                  onChange={e => setDistQuantity(e.target.value)}
                  className="border border-neutral-300 rounded-lg px-3 py-2 text-sm w-24 bg-white"
                />
              </div>
              <button type="submit" className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-emerald-700">
                Distribute
              </button>
            </form>
          </div>

          <div className="bg-white rounded-2xl shadow border border-neutral-200 overflow-hidden">
            <div className="p-4 border-b border-neutral-100 flex items-center justify-between">
              <h2 className="font-semibold">Distribution History</h2>
              <button onClick={fetchDistributions} className="p-1.5 hover:bg-neutral-100 rounded-lg" title="Refresh">
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="text-left px-4 py-3">Date</th>
                    <th className="text-left px-4 py-3">Tool Name</th>
                    <th className="text-left px-4 py-3">Department</th>
                    <th className="text-left px-4 py-3">Qty</th>
                    <th className="text-left px-4 py-3">Unit</th>
                    <th className="text-left px-4 py-3">Issued By</th>
                  </tr>
                </thead>
                <tbody>
                  {distributions.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-neutral-400">No distributions recorded</td></tr>
                  ) : distributions.map((d) => (
                    <tr key={d.id} className="border-t border-neutral-100">
                      <td className="px-4 py-3 text-xs">{new Date(d.created_at || d.date).toLocaleString()}</td>
                      <td className="px-4 py-3">{d.tool_name || d.tool_id || '—'}</td>
                      <td className="px-4 py-3 capitalize">{d.department || d.basic_unit || '—'}</td>
                      <td className="px-4 py-3 font-semibold">{d.quantity}</td>
                      <td className="px-4 py-3 text-neutral-500">{d.basic_unit || 'unit'}</td>
                      <td className="px-4 py-3 text-neutral-500">{d.issued_by || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ---------- PHYSICAL COUNTS VIEW ---------- */}
      {view === 'counts' && !loading && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow border border-neutral-200 p-5">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4" /> Record Physical Count
            </h2>
            <form onSubmit={handlePhysicalCount} className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">Tool Name</label>
                <ToolSearchInput
                  value={countToolName}
                  onChange={setCountToolName}
                  placeholder="Search tool name..."
                  toolsList={toolsList}
                  loadingTools={toolsLoading}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">Actual Count</label>
                <input
                  type="number"
                  min="0"
                  value={countQuantity}
                  onChange={e => setCountQuantity(e.target.value)}
                  className="border border-neutral-300 rounded-lg px-3 py-2 text-sm w-32 bg-white"
                />
              </div>
              <button type="submit" className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-emerald-700">
                Submit Count
              </button>
            </form>
          </div>

          <div className="bg-white rounded-2xl shadow border border-neutral-200 overflow-hidden">
            <div className="p-4 border-b border-neutral-100 flex items-center justify-between">
              <h2 className="font-semibold">Physical Count History</h2>
              <button onClick={fetchCounts} className="p-1.5 hover:bg-neutral-100 rounded-lg" title="Refresh">
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="text-left px-4 py-3">Date</th>
                    <th className="text-left px-4 py-3">Tool Name</th>
                    <th className="text-left px-4 py-3">System Qty</th>
                    <th className="text-left px-4 py-3">Actual Count</th>
                    <th className="text-left px-4 py-3">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {counts.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-400">No physical counts recorded</td></tr>
                  ) : counts.map((c) => {
                    const variance = (c.physical_count || 0) - (c.system_quantity || 0);
                    return (
                      <tr key={c.id} className="border-t border-neutral-100">
                        <td className="px-4 py-3 text-xs">{new Date(c.created_at || c.date).toLocaleString()}</td>
                        <td className="px-4 py-3">{c.tool_name || c.tool_id || '—'}</td>
                        <td className="px-4 py-3">{c.system_quantity || 0}</td>
                        <td className="px-4 py-3 font-semibold">{c.physical_count || 0}</td>
                        <td className={`px-4 py-3 font-medium ${variance < 0 ? 'text-red-600' : variance > 0 ? 'text-emerald-600' : 'text-neutral-500'}`}>
                          {variance > 0 ? '+' : ''}{variance}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ---------- SUMMARY VIEW ---------- */}
      {view === 'summary' && !loading && summary && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl shadow border border-neutral-200 p-5">
              <p className="text-xs text-neutral-500 uppercase tracking-wide">Total Tools</p>
              <p className="text-2xl font-bold mt-1">{summary.total_tools || 0}</p>
            </div>
            <div className="bg-white rounded-2xl shadow border border-neutral-200 p-5">
              <p className="text-xs text-neutral-500 uppercase tracking-wide">Total Stock Qty</p>
              <p className="text-2xl font-bold mt-1">{summary.total_stock_qty || 0}</p>
            </div>
            <div className="bg-white rounded-2xl shadow border border-neutral-200 p-5">
              <p className="text-xs text-neutral-500 uppercase tracking-wide">Low Stock Items</p>
              <p className={`text-2xl font-bold mt-1 ${(summary.low_stock || 0) > 0 ? 'text-amber-600' : ''}`}>
                {summary.low_stock || 0}
              </p>
            </div>
            <div className="bg-white rounded-2xl shadow border border-neutral-200 p-5">
              <p className="text-xs text-neutral-500 uppercase tracking-wide">Out of Stock</p>
              <p className={`text-2xl font-bold mt-1 ${(summary.out_of_stock || 0) > 0 ? 'text-red-600' : ''}`}>
                {summary.out_of_stock || 0}
              </p>
            </div>
          </div>

          {/* Facilities summary */}
          {summary.facilities && summary.facilities.length > 0 && (
            <div className="bg-white rounded-2xl shadow border border-neutral-200 p-5">
              <h2 className="font-semibold mb-3">My Facility Stock</h2>
              <div className="space-y-2">
                {summary.facilities.map((f, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-neutral-100 pb-2 last:border-0 last:pb-0">
                    <span className="text-sm font-medium">{f.name}</span>
                    <span className="text-sm text-neutral-600">{f.stock_count} items</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}