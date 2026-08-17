import React, { useState, useEffect, useMemo } from 'react';
import { api } from './api';
import { useToast } from './toasts';
import {
  TrendingUp, Upload, AlertCircle, CheckCircle2, Search,
  FileSpreadsheet, RefreshCw, ShieldAlert, ShieldCheck,
} from 'lucide-react';

const PACK_LABEL = { form: 'booklet', card: 'card' };

const fmtNum = (n) => {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 });
};

// Quantity display: FORM tools are stored as sheets but shown as booklets + sheets.
function QtyCell({ kind, units, sheets, label }) {
  return (
    <div>
      <p className="text-[10px] text-neutral-400 uppercase tracking-wide">{label}</p>
      {kind === 'form' ? (
        <>
          <p className="text-lg font-bold text-neutral-800 leading-tight">{fmtNum(units)} booklet{units === 1 ? '' : 's'}</p>
          <p className="text-[10px] text-neutral-500">({fmtNum(sheets)} sheets)</p>
        </>
      ) : (
        <p className="text-lg font-bold text-neutral-800 leading-tight">{fmtNum(sheets)} card{sheets === 1 ? '' : 's'}</p>
      )}
    </div>
  );
}

function QtyInline({ kind, units, sheets }) {
  if (kind === 'form') {
    return (
      <span>
        <span className="font-semibold">{fmtNum(units)} booklet{units === 1 ? '' : 's'}</span>{' '}
        <span className="text-neutral-400">({fmtNum(sheets)} sheets)</span>
      </span>
    );
  }
  return <span className="font-semibold">{fmtNum(sheets)} card{sheets === 1 ? '' : 's'}</span>;
}

// Per-facility breakdown for one tool in the selected State period (card drill-down)
function StateDrilldown({ tool, data, loading, onBack }) {
  const rows = data?.results || [];
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-100 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">{tool.report_type}</p>
          <h3 className="text-sm font-semibold text-neutral-900">{tool.tool_name}</h3>
          {data && (
            <p className="text-[11px] text-neutral-500">
              {data.from} → {data.to} · {rows.length} facilit{rows.length !== 1 ? 'ies' : 'y'}
            </p>
          )}
        </div>
        <button onClick={onBack}
          className="inline-flex items-center gap-1 text-xs font-semibold text-violet-600 hover:text-violet-800 border border-neutral-200 rounded-xl px-3 py-1.5">
          ← Back to state
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="bg-neutral-50 border-b border-neutral-200">
            <tr>
              <th className="px-3 py-3 text-xs font-semibold text-neutral-600 uppercase tracking-wide text-left">Facility</th>
              <th className="px-3 py-3 text-xs font-semibold text-neutral-600 uppercase tracking-wide text-right">Given</th>
              <th className="px-3 py-3 text-xs font-semibold text-neutral-600 uppercase tracking-wide text-right">Used</th>
              <th className="px-3 py-3 text-xs font-semibold text-neutral-600 uppercase tracking-wide text-right">Utilization</th>
              <th className="px-3 py-3 text-xs font-semibold text-neutral-600 uppercase tracking-wide text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {loading ? (
              <tr><td colSpan={5} className="text-center py-12 text-neutral-400 text-sm">Loading facility breakdown…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-12 text-neutral-400 text-sm">No facilities were given this tool in the selected period.</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} className="hover:bg-neutral-50 transition">
                <td className="px-3 py-2.5 text-neutral-800">{r.facility}</td>
                <td className="px-3 py-2.5 text-right text-neutral-600"><QtyInline kind={tool.kind} units={r.given_units} sheets={r.given} /></td>
                <td className="px-3 py-2.5 text-right text-neutral-600"><QtyInline kind={tool.kind} units={r.used_units} sheets={r.used} /></td>
                <td className="px-3 py-2.5 text-right">
                  <span className={`font-bold ${r.under_utilized ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {r.utilization_pct == null ? '—' : `${r.utilization_pct}%`}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  {r.utilization_pct == null ? <span className="text-neutral-300 text-xs">—</span> : <StatusBadge under={r.under_utilized} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FileDropZone({ label, hint, file, onChange, disabled }) {
  return (
    <label className={`flex flex-col items-center justify-center gap-1.5 border-2 border-dashed rounded-2xl p-4 cursor-pointer transition text-center
      ${file ? 'border-emerald-400 bg-emerald-50' : 'border-neutral-300 bg-neutral-50 hover:bg-neutral-100'}
      ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      <input type="file" accept=".xlsx,.xls" className="hidden" onChange={e => onChange(e.target.files?.[0] || null)} disabled={disabled} />
      {file ? (
        <>
          <CheckCircle2 className="h-6 w-6 text-emerald-500" />
          <span className="text-xs font-semibold text-emerald-700 break-all">{file.name}</span>
        </>
      ) : (
        <>
          <FileSpreadsheet className="h-6 w-6 text-neutral-400" />
          <span className="text-xs font-semibold text-neutral-700">{label}</span>
          <span className="text-[10px] text-neutral-400">{hint}</span>
        </>
      )}
    </label>
  );
}

function StatusBadge({ under }) {
  if (under) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-700">
        <ShieldAlert className="h-3 w-3" /> Under-utilized
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">
      <ShieldCheck className="h-3 w-3" /> OK
    </span>
  );
}

export default function ToolsUtilizationScreen({ isAdmin = false }) {
  const { push } = useToast();

  const [data, setData] = useState(null);          // { results, by_facility, threshold, computed... }
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [radetFile, setRadetFile] = useState(null);
  const [htsFile, setHtsFile] = useState(null);
  const [prepFile, setPrepFile] = useState(null);
  const [search, setSearch] = useState('');

  // Admin sub-tabs: 'state' (aggregate) | 'facilities' (drill-down)
  const [subTab, setSubTab] = useState('state');
  const [periodFrom, setPeriodFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10);
  });
  const [periodTo, setPeriodTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [stateData, setStateData] = useState(null);
  const [stateLoading, setStateLoading] = useState(false);
  const [selectedFacility, setSelectedFacility] = useState(null);
  // State-card drill-down: shows the per-facility breakdown for one tool + period
  const [drillTool, setDrillTool] = useState(null);
  const [drillData, setDrillData] = useState(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const load = async () => {
    try {
      const d = await api.myUtilization();
      setData(d);
    } catch (e) {
      push(e.message || 'Failed to load utilization', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadState = async () => {
    if (!isAdmin) return;
    setStateLoading(true);
    try {
      const d = await api.utilizationState({ from: periodFrom, to: periodTo });
      setStateData(d);
    } catch (e) {
      push(e.message || 'Failed to load state utilization', 'error');
    } finally {
      setStateLoading(false);
    }
  };

  const openStateDrill = async (tool) => {
    setDrillTool(tool);
    setDrillData(null);
    setDrillLoading(true);
    try {
      const d = await api.utilizationStateFacilities({ tool_id: tool.tool_id, from: periodFrom, to: periodTo });
      setDrillData(d);
    } catch (e) {
      push(e.message || 'Failed to load facility breakdown', 'error');
    } finally {
      setDrillLoading(false);
    }
  };

  const closeStateDrill = () => {
    setDrillTool(null);
    setDrillData(null);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { if (isAdmin) loadState(); }, [isAdmin, periodFrom, periodTo]);

  const handleCalculate = async () => {
    if (!radetFile && !htsFile && !prepFile) {
      push('Upload at least one report (RADET, HTS or PrEP)', 'error');
      return;
    }
    setUploading(true);
    try {
      const res = await api.uploadUtilization({ radetFile, htsFile, prepFile });
      if (res.errors && Object.keys(res.errors).length) {
        Object.values(res.errors).forEach(m => push(m, 'error'));
      }
      push(`Utilization calculated for ${res.count ?? 0} facility/tool pair(s)`, 'success');
      setRadetFile(null); setHtsFile(null); setPrepFile(null);
      await load();
    } catch (e) {
      push(e.message || 'Calculation failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const results = data?.results || [];
  const threshold = data?.threshold ?? 70;

  const byFacility = data?.by_facility || {};
  const facilityNames = Object.keys(byFacility).sort((a, b) => a.localeCompare(b));
  const rowsFor = (f) => results.filter(r => r.facility === f);
  const underFor = (f) => rowsFor(f).filter(r => r.under_utilized).length;

  const renderFacilityTable = (frows) => (
    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-neutral-50 border-b border-neutral-200">
            <tr>
              <th className="px-3 py-3 text-xs font-semibold text-neutral-600 uppercase tracking-wide text-left">Tool</th>
              <th className="px-3 py-3 text-xs font-semibold text-neutral-600 uppercase tracking-wide text-right">Given</th>
              <th className="px-3 py-3 text-xs font-semibold text-neutral-600 uppercase tracking-wide text-right">Achieved</th>
              <th className="px-3 py-3 text-xs font-semibold text-neutral-600 uppercase tracking-wide text-right">Utilization</th>
              <th className="px-3 py-3 text-xs font-semibold text-neutral-600 uppercase tracking-wide text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {frows.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-10 text-neutral-400 text-sm">No utilization data for this facility.</td></tr>
            ) : frows.map((r, i) => (
              <tr key={i} className="hover:bg-neutral-50 transition">
                <td className="px-3 py-2.5 text-neutral-800">{r.tool_name || '—'}</td>
                <td className="px-3 py-2.5 text-right text-neutral-600"><QtyInline kind={r.kind} units={r.given_units} sheets={r.given} /></td>
                <td className="px-3 py-2.5 text-right text-neutral-600"><QtyInline kind={r.kind} units={r.achieved_units} sheets={r.achieved} /></td>
                <td className="px-3 py-2.5 text-right">
                  <span className={`font-bold ${r.under_utilized ? 'text-amber-600' : 'text-emerald-600'}`}>{r.utilization_pct == null ? '—' : `${r.utilization_pct}%`}</span>
                </td>
                <td className="px-3 py-2.5 text-right">{r.utilization_pct == null ? <span className="text-neutral-300 text-xs">—</span> : <StatusBadge under={r.under_utilized} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-2xl bg-violet-600 text-white grid place-items-center shadow-lg shadow-violet-200">
          <TrendingUp className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Tools Utilization</h1>
          <p className="text-sm text-neutral-500">
            Compares what each facility was given vs what they used — below {threshold}% means the tool was under-utilized.
          </p>
        </div>
      </div>

      {/* Upload (admin/S.I. only) */}
      {isAdmin && (
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-5 space-y-4">
          <p className="text-xs font-bold text-neutral-500 uppercase tracking-wide flex items-center gap-1.5">
            <Upload className="h-3.5 w-3.5" /> Upload Reports & Recalculate
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FileDropZone label="RADET" hint="Pharmacy Form · Care/ART Card · Care & Support"
              file={radetFile} onChange={setRadetFile} disabled={uploading} />
            <FileDropZone label="HTS_PEPFAR" hint="National HTS Form"
              file={htsFile} onChange={setHtsFile} disabled={uploading} />
            <FileDropZone label="PrEP Cross-Sectional" hint="PrEP/PEP Card · PrEP/PEP Eligibility Form"
              file={prepFile} onChange={setPrepFile} disabled={uploading} />
          </div>
          <button onClick={handleCalculate} disabled={uploading || (!radetFile && !htsFile && !prepFile)}
            className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-semibold py-3 rounded-xl text-sm transition disabled:opacity-50">
            {uploading
              ? <><RefreshCw className="h-4 w-4 animate-spin" /> Calculating…</>
              : <><TrendingUp className="h-4 w-4" /> Calculate Utilization</>
            }
          </button>
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm py-16 text-center text-neutral-400">
          <RefreshCw className="h-8 w-8 mx-auto mb-2 animate-spin text-neutral-200" />
          <p className="text-sm">Loading utilization…</p>
        </div>
      ) : (
        <>
          {/* Admin sub-tabs */}
          {isAdmin && (
            <div className="flex gap-2">
              <button onClick={() => setSubTab('state')}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${subTab === 'state' ? 'bg-violet-600 text-white shadow-sm' : 'bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50'}`}>
                State
              </button>
              <button onClick={() => setSubTab('facilities')}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${subTab === 'facilities' ? 'bg-violet-600 text-white shadow-sm' : 'bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50'}`}>
                Facilities
              </button>
            </div>
          )}

          {isAdmin && subTab === 'state' ? (
            /* ── STATE (aggregate) view ── */
            <div className="space-y-5">
              <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-5 space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-[11px] text-neutral-500 mb-1">From</label>
                    <input type="date" value={periodFrom} onChange={e => setPeriodFrom(e.target.value)}
                      className="border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-neutral-500 mb-1">To</label>
                    <input type="date" value={periodTo} onChange={e => setPeriodTo(e.target.value)}
                      className="border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
                  </div>
                  {stateLoading && <RefreshCw className="h-4 w-4 animate-spin text-violet-500 mb-2" />}
                </div>
                {stateData && (
                  <p className="text-xs text-neutral-500">
                    State-wide utilization for <strong>{stateData.from}</strong> to <strong>{stateData.to}</strong> · threshold {stateData.threshold}%
                  </p>
                )}
              </div>

              {stateLoading ? (
                <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm py-14 text-center text-neutral-400">
                  <RefreshCw className="h-8 w-8 mx-auto mb-2 animate-spin text-neutral-200" />
                  <p className="text-sm">Calculating state utilization…</p>
                </div>
              ) : !stateData || stateData.results.length === 0 ? (
                <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm py-14 text-center text-neutral-400">
                  <TrendingUp className="h-12 w-12 mx-auto text-neutral-200 mb-3" />
                  <p className="text-sm">No utilization data for the selected period.</p>
                </div>
              ) : drillTool ? (
                <StateDrilldown tool={drillTool} data={drillData} loading={drillLoading} onBack={closeStateDrill} />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {stateData.results.map(t => (
                    <button key={t.tool_id} onClick={() => openStateDrill(t)}
                      className="rounded-2xl border border-neutral-200 bg-white shadow-sm p-4 space-y-3 text-left hover:border-violet-300 hover:bg-violet-50/40 hover:shadow-md transition cursor-pointer group">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">{t.report_type}</p>
                          <p className="text-sm font-semibold text-neutral-900 leading-tight">{t.tool_name}</p>
                        </div>
                        <span className="text-[10px] text-violet-500 font-semibold opacity-0 group-hover:opacity-100 transition">View →</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <QtyCell kind={t.kind} units={t.given_units} sheets={t.given} label="Given" />
                        <QtyCell kind={t.kind} units={t.achieved_units} sheets={t.achieved} label="Used" />
                        <div>
                          <p className="text-[10px] text-neutral-400 uppercase tracking-wide">Utilization</p>
                          <p className={`text-lg font-bold ${t.under_utilized ? 'text-amber-600' : 'text-emerald-600'}`}>
                            {t.utilization_pct == null ? '—' : `${t.utilization_pct}%`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t border-neutral-100">
                        <span className="text-[11px] text-neutral-400">{t.facilities} facilit{t.facilities !== 1 ? 'ies' : 'y'}</span>
                        {t.utilization_pct == null ? <span className="text-neutral-300 text-xs">—</span> : <StatusBadge under={t.under_utilized} />}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* ── FACILITIES view ── */
            <div className="space-y-5">
              {selectedFacility ? (
                <div>
                  <button onClick={() => setSelectedFacility(null)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-violet-600 hover:text-violet-800 mb-2">
                    ← All facilities
                  </button>
                  <h2 className="text-lg font-bold text-neutral-900 mb-3">{selectedFacility}</h2>
                  {renderFacilityTable(rowsFor(selectedFacility), false)}
                </div>
              ) : (
                <div>
                  <div className="relative max-w-sm mb-3">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
                    <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search facility…"
                      className="w-full pl-8 pr-3 py-2 text-sm border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-200" />
                  </div>
                  {facilityNames.filter(f => !search || f.toLowerCase().includes(search.toLowerCase())).length === 0 ? (
                    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm py-12 text-center text-neutral-400">
                      <p className="text-sm">No facilities found.</p>
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {facilityNames.filter(f => !search || f.toLowerCase().includes(search.toLowerCase())).map(f => (
                        <button key={f} onClick={() => setSelectedFacility(f)}
                          className="rounded-xl border border-neutral-200 bg-white shadow-sm p-3 text-left hover:border-violet-300 hover:bg-violet-50/40 transition">
                          <p className="font-medium text-sm text-neutral-900">{f}</p>
                          <p className="text-[11px] text-neutral-400 mt-0.5">
                            {rowsFor(f).length} tool{rowsFor(f).length !== 1 ? 's' : ''}
                            {underFor(f) > 0 && <span className="text-amber-600 font-semibold"> · {underFor(f)} under-utilized</span>}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
