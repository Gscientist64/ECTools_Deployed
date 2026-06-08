// myInventory.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from './api';
import { useToast } from './toasts';
import { Package, ArrowRightLeft, ClipboardCheck, Loader2, AlertTriangle, CheckCircle, XCircle, RefreshCw, Search, ChevronDown, ChevronRight, ChevronLeft, Calendar } from 'lucide-react';

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
  const [editReceived, setEditReceived] = useState({}); // { facility_stock_id: value }
  const [savingReceived, setSavingReceived] = useState({});
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

  // Facility transfer form
  const [transferToolName, setTransferToolName] = useState('');
  const [transferToFacility, setTransferToFacility] = useState('');
  const [transferQuantity, setTransferQuantity] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [facilities, setFacilities] = useState([]);
  const [outgoingTransfers, setOutgoingTransfers] = useState([]);
  const [incomingTransfers, setIncomingTransfers] = useState([]);

  const fetchFacilities = useCallback(async () => {
    try {
      const data = await api.listFacilities();
      setFacilities(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  const fetchTransfers = useCallback(async () => {
    try {
      const [outgoing, incoming] = await Promise.all([
        api.outgoingTransfers(),
        api.incomingTransfers()
      ]);
      setOutgoingTransfers(Array.isArray(outgoing) ? outgoing : []);
      setIncomingTransfers(Array.isArray(incoming) ? incoming : []);
    } catch {}
  }, []);

  useEffect(() => { fetchFacilities(); }, [fetchFacilities]);

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

  // Longitudinal stock view
  const [longitudinalData, setLongitudinalData] = useState(null);
  const [periodType, setPeriodType] = useState('week');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedPeriod, setSelectedPeriod] = useState('all'); // 'all' | week number | month number
  const [expandedTools, setExpandedTools] = useState({}); // { tool_id: true/false }

  const fetchLongitudinal = useCallback(async (pt, yr) => {
    setLoading(true);
    try {
      const data = await api.myStockLongitudinal(pt || periodType, yr || selectedYear);
      setLongitudinalData(data);
      setSelectedPeriod('all');
      const expanded = {};
      (data.tools || []).forEach(t => {
        if (t.periods && t.periods.length > 0) {
          expanded[t.tool_id] = true;
        }
      });
      setExpandedTools(expanded);
    } catch (e) {
      push(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [push, periodType, selectedYear]);

  const toggleExpandTool = (toolId) => {
    setExpandedTools(prev => ({ ...prev, [toolId]: !prev[toolId] }));
  };

  const handlePeriodChange = (pt) => {
    setPeriodType(pt);
    setSelectedPeriod('all');
    fetchLongitudinal(pt, selectedYear);
  };

  const handleYearChange = (yr) => {
    setSelectedYear(yr);
    setSelectedPeriod('all');
    fetchLongitudinal(periodType, yr);
  };

  // Filter periods for a tool based on selectedPeriod
  const filterPeriods = (periods) => {
    if (selectedPeriod === 'all') return periods;
    if (periodType === 'week') return periods.filter(p => p.label.endsWith(`-W${String(selectedPeriod).padStart(2, '0')}`));
    if (periodType === 'month') return periods.filter(p => p.label.endsWith(`-${String(selectedPeriod).padStart(2, '0')}`));
    return periods;
  };

  // Build period dropdown options based on periodType
  const periodOptions = () => {
    if (periodType === 'week') {
      return Array.from({ length: 52 }, (_, i) => ({ value: i + 1, label: `Week ${i + 1}` }));
    }
    if (periodType === 'month') {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return months.map((m, i) => ({ value: i + 1, label: m }));
    }
    return []; // quarters — not used
  };

  // Navigate to previous/next period (for week/month, wraps around year)
  const goToPrevPeriod = () => {
    if (periodType === 'quarter') {
      handleYearChange(selectedYear - 1);
      return;
    }
    if (selectedPeriod === 'all') return;
    const sp = parseInt(selectedPeriod);
    if (sp <= 1) {
      handleYearChange(selectedYear - 1);
      if (periodType === 'week') setSelectedPeriod(52);
      else setSelectedPeriod(12);
    } else {
      setSelectedPeriod(sp - 1);
    }
  };

  const goToNextPeriod = () => {
    if (periodType === 'quarter') {
      handleYearChange(selectedYear + 1);
      return;
    }
    if (selectedPeriod === 'all') return;
    const sp = parseInt(selectedPeriod);
    const max = periodType === 'week' ? 52 : 12;
    if (sp >= max) {
      handleYearChange(selectedYear + 1);
      setSelectedPeriod(1);
    } else {
      setSelectedPeriod(sp + 1);
    }
  };

  useEffect(() => {
    if (view === 'stock') {
      fetchLongitudinal();
      fetchStock();
    }
    else if (view === 'distribute') { fetchDistributions(); fetchTransfers(); }
    else if (view === 'counts') fetchCounts();
    else if (view === 'summary') fetchSummary();
  }, [view, fetchLongitudinal, fetchStock, fetchDistributions, fetchCounts, fetchSummary, fetchTransfers]);

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
        physical_quantity: parseInt(countQuantity) || 0
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

  const handleFacilityTransfer = async (e) => {
    e.preventDefault();
    if (!transferToolName.trim()) { push('Select a tool name', 'error'); return; }
    if (!transferToFacility) { push('Select a target facility', 'error'); return; }
    const qty = parseInt(transferQuantity);
    if (!qty || qty <= 0) { push('Enter a valid quantity', 'error'); return; }

    try {
      await api.initiateTransfer({
        tool_name: transferToolName.trim(),
        to_facility: transferToFacility,
        quantity: qty,
        notes: transferNotes
      });
      push(`Transfer of ${qty} ${transferToolName} to ${transferToFacility} initiated`, 'success');
      setTransferToolName('');
      setTransferToFacility('');
      setTransferQuantity('');
      setTransferNotes('');
      fetchTransfers();
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
        <div className="space-y-5">
          {/* Period Toggle & Controls */}
          <div className="bg-white rounded-2xl shadow border border-neutral-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {/* Period Toggle */}
                <div className="flex bg-neutral-100 rounded-xl p-1">
                  {['week', 'month', 'quarter'].map(pt => (
                    <button
                      key={pt}
                      onClick={() => handlePeriodChange(pt)}
                      className={`px-4 py-1.5 text-sm font-medium rounded-lg transition ${
                        periodType === pt ? 'bg-emerald-600 text-white shadow-sm' : 'text-neutral-600 hover:text-neutral-900'
                      }`}
                    >
                      {pt.charAt(0).toUpperCase() + pt.slice(1)}
                    </button>
                  ))}
                </div>

                {/* Quarter: Year selector with prev/next */}
                {periodType === 'quarter' && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleYearChange(selectedYear - 1)} className="p-1 hover:bg-neutral-100 rounded" title="Previous year"><ChevronLeft className="h-4 w-4" /></button>
                    <div className="flex items-center gap-1">
                      <Calendar className="h-4 w-4 text-neutral-400" />
                      <select value={selectedYear} onChange={e => handleYearChange(parseInt(e.target.value))} className="border border-neutral-300 rounded-lg px-2 py-1.5 text-sm bg-white">
                        {Array.from({ length: 5 }, (_, i) => 2026 + i).map(yr => (<option key={yr} value={yr}>{yr}</option>))}
                      </select>
                    </div>
                    <button onClick={() => handleYearChange(selectedYear + 1)} className="p-1 hover:bg-neutral-100 rounded" title="Next year"><ChevronRight className="h-4 w-4" /></button>
                  </div>
                )}

                {/* Week / Month: Period dropdown + Year selector */}
                {(periodType === 'week' || periodType === 'month') && (
                  <div className="flex items-center gap-1">
                    <button onClick={goToPrevPeriod} className="p-1 hover:bg-neutral-100 rounded" title={`Previous ${periodType}`}><ChevronLeft className="h-4 w-4" /></button>
                    <select
                      value={selectedPeriod}
                      onChange={e => setSelectedPeriod(e.target.value)}
                      className="border border-neutral-300 rounded-lg px-2 py-1.5 text-sm bg-white font-medium"
                    >
                      <option value="all">All {periodType === 'week' ? 'Weeks' : 'Months'}</option>
                      {periodOptions().map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <select
                      value={selectedYear}
                      onChange={e => handleYearChange(parseInt(e.target.value))}
                      className="border border-neutral-300 rounded-lg px-2 py-1.5 text-sm bg-white"
                    >
                      {Array.from({ length: 5 }, (_, i) => 2026 + i).map(yr => (<option key={yr} value={yr}>{yr}</option>))}
                    </select>
                    <button onClick={goToNextPeriod} className="p-1 hover:bg-neutral-100 rounded" title={`Next ${periodType}`}><ChevronRight className="h-4 w-4" /></button>
                  </div>
                )}
              </div>
              <button onClick={() => fetchLongitudinal()} className="p-1.5 hover:bg-neutral-100 rounded-lg" title="Refresh">
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Longitudinal Data */}
          {longitudinalData && longitudinalData.tools && longitudinalData.tools.length > 0 ? (
            <div className="space-y-3">
              {longitudinalData.tools.map(tool => {
                const isExpanded = expandedTools[tool.tool_id] || false;
                const allPeriods = tool.periods || [];
                const periods = filterPeriods(allPeriods);
                const latestPeriod = allPeriods.length > 0 ? allPeriods[allPeriods.length - 1] : null;

                return (
                  <div key={tool.tool_id} className="bg-white rounded-2xl shadow border border-neutral-200 overflow-hidden">
                    {/* Tool Header */}
                    <button
                      onClick={() => toggleExpandTool(tool.tool_id)}
                      className="w-full p-4 flex items-center justify-between hover:bg-neutral-50 transition text-left"
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-neutral-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-neutral-400" />
                        )}
                        <div>
                          <span className="font-semibold text-sm">{tool.tool_name}</span>
                          <span className="text-xs text-neutral-400 ml-2">{tool.category}</span>
                        </div>
                      </div>
                      {latestPeriod && (
                        <div className="flex items-center gap-4 text-xs">
                          <span className="text-neutral-500">
                            Latest: <span className="font-medium">{latestPeriod.label}</span>
                          </span>
                          <span className="text-neutral-500">
                            Opening: <span className="font-semibold text-neutral-700">{latestPeriod.opening_balance}</span>
                          </span>
                          <span className="text-emerald-600">
                            +{latestPeriod.qty_supplied}
                          </span>
                          <span className="text-red-500">
                            -{latestPeriod.qty_utilized}
                          </span>
                          <span className={`font-bold text-sm px-2 py-0.5 rounded ${
                            latestPeriod.closing_balance <= 0 ? 'bg-red-50 text-red-700' :
                            latestPeriod.closing_balance < 10 ? 'bg-amber-50 text-amber-700' :
                            'bg-emerald-50 text-emerald-700'
                          }`}>
                            = {latestPeriod.closing_balance}
                          </span>
                        </div>
                      )}
                      {!latestPeriod && (
                        <span className="text-xs text-neutral-400">Opening: {tool.initial_opening}</span>
                      )}
                    </button>

                    {/* Expanded Period Table */}
                    {isExpanded && periods.length > 0 && (
                      <div className="border-t border-neutral-100 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-neutral-50">
                            <tr>
                              <th className="text-left px-4 py-2.5 text-xs font-medium text-neutral-500 uppercase">Period</th>
                              <th className="text-right px-4 py-2.5 text-xs font-medium text-neutral-500 uppercase">Opening Balance</th>
                              <th className="text-right px-4 py-2.5 text-xs font-medium text-neutral-500 uppercase">Qty Supplied</th>
                              <th className="text-right px-4 py-2.5 text-xs font-medium text-neutral-500 uppercase">Qty Utilized</th>
                              <th className="text-right px-4 py-2.5 text-xs font-medium text-neutral-500 uppercase">Closing Balance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {/* Initial opening row if there's no first period data */}
                            {tool.initial_opening > 0 && (
                              <tr className="border-b border-neutral-50 bg-neutral-50/50">
                                <td className="px-4 py-2 text-neutral-400 italic text-xs">Initial</td>
                                <td className="px-4 py-2 text-right font-medium">{tool.initial_opening}</td>
                                <td className="px-4 py-2 text-right text-neutral-400">—</td>
                                <td className="px-4 py-2 text-right text-neutral-400">—</td>
                                <td className="px-4 py-2 text-right font-medium">{tool.initial_opening}</td>
                              </tr>
                            )}
                            {periods.map((p, idx) => (
                              <tr key={idx} className="border-b border-neutral-50 hover:bg-neutral-50/50 transition">
                                <td className="px-4 py-2.5">
                                  <span className="font-medium text-neutral-700">{p.label}</span>
                                  <span className="text-xs text-neutral-400 ml-2">
                                    {new Date(p.period_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    {' — '}
                                    {new Date(p.period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5 text-right">
                                  <span className="font-medium">{p.opening_balance}</span>
                                </td>
                                <td className="px-4 py-2.5 text-right">
                                  {p.qty_supplied > 0 ? (
                                    <span className="text-emerald-600 font-medium">+{p.qty_supplied}</span>
                                  ) : (
                                    <span className="text-neutral-400">0</span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-right">
                                  {p.qty_utilized > 0 ? (
                                    <span className="text-red-500 font-medium">-{p.qty_utilized}</span>
                                  ) : (
                                    <span className="text-neutral-400">0</span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-right">
                                  <span className={`inline-block px-2 py-0.5 rounded font-bold text-sm ${
                                    p.closing_balance <= 0 ? 'bg-red-50 text-red-700' :
                                    p.closing_balance < 10 ? 'bg-amber-50 text-amber-700' :
                                    'bg-emerald-50 text-emerald-700'
                                  }`}>
                                    {p.closing_balance}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {isExpanded && periods.length === 0 && (
                      <div className="border-t border-neutral-100 p-6 text-center text-sm text-neutral-400">
                        No {periodType}ly activity for {tool.tool_name} in {selectedYear}.
                        {tool.initial_opening > 0 && (
                          <span> Opening balance: <strong>{tool.initial_opening}</strong></span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Current Stock Levels Summary */}
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
                    <th className="text-left px-4 py-3">Tool Name</th>
                    <th className="text-left px-4 py-3">Opening Balance</th>
                    <th className="text-left px-4 py-3">Qty Supplied</th>
                    <th className="text-left px-4 py-3">Qty Received</th>
                    <th className="text-left px-4 py-3">Qty Utilized</th>
                  </tr>
                </thead>
                <tbody>
                  {stock.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-400">No stock records found</td></tr>
                  ) : stock.map((s) => (
                    <tr key={s.tool_id} className="border-t border-neutral-100">
                      <td className="px-4 py-3 font-medium">{s.tool_name || '—'}</td>
                      <td className="px-4 py-3">{s.opening_balance ?? 0}</td>
                      <td className="px-4 py-3">{s.qty_supplied ?? 0}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            value={editReceived[s.tool_id] !== undefined ? editReceived[s.tool_id] : (s.qty_received ?? 0)}
                            onChange={e => setEditReceived(prev => ({ ...prev, [s.tool_id]: e.target.value }))}
                            className="border border-neutral-300 rounded px-2 py-1 w-24 text-sm bg-white"
                          />
                          <button
                            onClick={async () => {
                              const val = parseInt(editReceived[s.tool_id] !== undefined ? editReceived[s.tool_id] : s.qty_received);
                              if (isNaN(val) || val < 0) { push('Enter a valid non-negative number', 'error'); return; }
                              setSavingReceived(prev => ({ ...prev, [s.tool_id]: true }));
                              try {
                                await api.updateQtyReceived(s.tool_id, val);
                                push('Qty Received updated', 'success');
                                setEditReceived(prev => { const n = { ...prev }; delete n[s.tool_id]; return n; });
                                fetchStock();
                              } catch (e) {
                                push(e.message, 'error');
                              } finally {
                                setSavingReceived(prev => ({ ...prev, [s.tool_id]: false }));
                              }
                            }}
                            disabled={savingReceived[s.tool_id]}
                            className="bg-emerald-600 text-white text-xs px-2 py-1 rounded hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {savingReceived[s.tool_id] ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-semibold">{s.qty_utilized ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

          {/* Facility-to-Facility Transfer */}
          <div className="bg-white rounded-2xl shadow border border-neutral-200 p-5">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4" /> Transfer to Another Facility
            </h2>
            <form onSubmit={handleFacilityTransfer} className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">Tool Name</label>
                <ToolSearchInput
                  value={transferToolName}
                  onChange={setTransferToolName}
                  placeholder="Search tool name..."
                  toolsList={toolsList}
                  loadingTools={toolsLoading}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">Target Facility</label>
                <select
                  value={transferToFacility}
                  onChange={e => setTransferToFacility(e.target.value)}
                  className="border border-neutral-300 rounded-lg px-3 py-2 text-sm w-48 bg-white"
                  required
                >
                  <option value="">Select facility...</option>
                  {facilities.map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">Quantity</label>
                <input
                  type="number"
                  min="1"
                  value={transferQuantity}
                  onChange={e => setTransferQuantity(e.target.value)}
                  className="border border-neutral-300 rounded-lg px-3 py-2 text-sm w-24 bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 mb-1">Notes</label>
                <input
                  type="text"
                  value={transferNotes}
                  onChange={e => setTransferNotes(e.target.value)}
                  placeholder="Optional"
                  className="border border-neutral-300 rounded-lg px-3 py-2 text-sm w-40 bg-white"
                />
              </div>
              <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">
                Transfer
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

          {/* Incoming Transfers */}
          {incomingTransfers.length > 0 && (
            <div className="bg-white rounded-2xl shadow border border-neutral-200 overflow-hidden">
              <div className="p-4 border-b border-neutral-100 flex items-center justify-between">
                <h2 className="font-semibold">Incoming Transfers</h2>
                <button onClick={fetchTransfers} className="p-1.5 hover:bg-neutral-100 rounded-lg" title="Refresh">
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50">
                    <tr>
                      <th className="text-left px-4 py-3">Date</th>
                      <th className="text-left px-4 py-3">From</th>
                      <th className="text-left px-4 py-3">Tool</th>
                      <th className="text-left px-4 py-3">Qty</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-left px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incomingTransfers.map(t => (
                      <tr key={t.id} className="border-t border-neutral-100">
                        <td className="px-4 py-3 text-xs">{new Date(t.created_at).toLocaleDateString()}</td>
                        <td className="px-4 py-3">{t.from_facility}</td>
                        <td className="px-4 py-3">{t.tool_name}</td>
                        <td className="px-4 py-3 font-semibold">{t.quantity}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            t.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                            t.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' :
                            'bg-red-100 text-red-700'
                          }`}>{t.status}</span>
                        </td>
                        <td className="px-4 py-3">
                          {t.status === 'pending' && (
                            <div className="flex gap-1">
                              <button
                                onClick={async () => { try { await api.acceptTransfer(t.id); push('Transfer accepted', 'success'); fetchTransfers(); fetchStock(); } catch(e) { push(e.message, 'error'); } }}
                                className="bg-emerald-600 text-white text-xs px-2 py-1 rounded hover:bg-emerald-700"
                              >Accept</button>
                              <button
                                onClick={async () => { try { await api.rejectTransfer(t.id); push('Transfer rejected', 'success'); fetchTransfers(); } catch(e) { push(e.message, 'error'); } }}
                                className="bg-red-500 text-white text-xs px-2 py-1 rounded hover:bg-red-600"
                              >Reject</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Outgoing Transfers */}
          {outgoingTransfers.length > 0 && (
            <div className="bg-white rounded-2xl shadow border border-neutral-200 overflow-hidden">
              <div className="p-4 border-b border-neutral-100 flex items-center justify-between">
                <h2 className="font-semibold">Outgoing Transfers</h2>
                <button onClick={fetchTransfers} className="p-1.5 hover:bg-neutral-100 rounded-lg" title="Refresh">
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50">
                    <tr>
                      <th className="text-left px-4 py-3">Date</th>
                      <th className="text-left px-4 py-3">To</th>
                      <th className="text-left px-4 py-3">Tool</th>
                      <th className="text-left px-4 py-3">Qty</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-left px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outgoingTransfers.map(t => (
                      <tr key={t.id} className="border-t border-neutral-100">
                        <td className="px-4 py-3 text-xs">{new Date(t.created_at).toLocaleDateString()}</td>
                        <td className="px-4 py-3">{t.to_facility}</td>
                        <td className="px-4 py-3">{t.tool_name}</td>
                        <td className="px-4 py-3 font-semibold">{t.quantity}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            t.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                            t.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' :
                            t.status === 'rejected' ? 'bg-red-100 text-red-700' :
                            'bg-neutral-100 text-neutral-600'
                          }`}>{t.status}</span>
                        </td>
                        <td className="px-4 py-3">
                          {t.status === 'pending' && (
                            <button
                              onClick={async () => { try { await api.cancelTransfer(t.id); push('Transfer cancelled', 'success'); fetchTransfers(); fetchStock(); } catch(e) { push(e.message, 'error'); } }}
                              className="bg-neutral-500 text-white text-xs px-2 py-1 rounded hover:bg-neutral-600"
                            >Cancel</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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