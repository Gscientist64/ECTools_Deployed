import React, { useState } from 'react';
import { api } from './api';
import { useToast } from './toasts';
import {
  TrendingUp, Upload, AlertCircle, CheckCircle2, Search,
  FileSpreadsheet, Calendar, ChevronDown, ChevronUp, RefreshCw,
} from 'lucide-react';

const TOOLS = [
  {
    key: 'combined_pharmacy_forms',
    label: 'Combined Pharmacy Order Form',
    source: 'RADET',
    basis: 'radet_refills',
    basisLabel: 'Refills',
    rate: '100 refills / form',
    color: 'emerald',
  },
  {
    key: 'facility_care_support_forms',
    label: 'Facility Care & Support Form',
    source: 'RADET',
    basis: 'radet_refills',
    basisLabel: 'Refills',
    rate: '100 persons / form',
    color: 'blue',
  },
  {
    key: 'pharmacy_daily_worksheets',
    label: 'Pharmacy Daily Worksheet',
    source: 'RADET',
    basis: 'radet_refills',
    basisLabel: 'Refills',
    rate: '1,900 refills / worksheet',
    color: 'violet',
  },
  {
    key: 'national_hts_forms',
    label: 'National HTS Form',
    source: 'HTS',
    basis: 'hts_tests',
    basisLabel: 'Tests',
    rate: '1 test / form',
    color: 'rose',
  },
];

const COLOR = {
  emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  blue:    'bg-blue-50    border-blue-200    text-blue-700',
  violet:  'bg-violet-50  border-violet-200  text-violet-700',
  rose:    'bg-rose-50    border-rose-200    text-rose-700',
};

function FileDropZone({ label, accept, file, onChange, disabled }) {
  return (
    <label className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-2xl p-5 cursor-pointer transition
      ${file ? 'border-emerald-400 bg-emerald-50' : 'border-neutral-300 bg-neutral-50 hover:bg-neutral-100'}
      ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      <input type="file" accept={accept} className="hidden" onChange={e => onChange(e.target.files?.[0] || null)} disabled={disabled} />
      {file ? (
        <>
          <CheckCircle2 className="h-7 w-7 text-emerald-500" />
          <span className="text-sm font-semibold text-emerald-700 text-center break-all">{file.name}</span>
          <span className="text-xs text-neutral-400">{(file.size / 1024 / 1024).toFixed(2)} MB — click to change</span>
        </>
      ) : (
        <>
          <FileSpreadsheet className="h-7 w-7 text-neutral-400" />
          <span className="text-sm font-semibold text-neutral-700">{label}</span>
          <span className="text-xs text-neutral-400">.xlsx or .xls, max 30 MB</span>
        </>
      )}
    </label>
  );
}

function SummaryCard({ tool, value }) {
  return (
    <div className={`rounded-2xl border p-4 space-y-1 ${COLOR[tool.color]}`}>
      <p className="text-[11px] font-bold uppercase tracking-wide opacity-70">{tool.source}</p>
      <p className="text-xs font-semibold leading-tight">{tool.label}</p>
      <p className="text-3xl font-extrabold">{value ?? 0}</p>
      <p className="text-[11px] opacity-60">{tool.rate}</p>
    </div>
  );
}

export default function ToolsUtilizationScreen() {
  const { push } = useToast();

  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd,   setPeriodEnd]   = useState('');
  const [radetFile,   setRadetFile]   = useState(null);
  const [htsFile,     setHtsFile]     = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [result,      setResult]      = useState(null);
  const [search,      setSearch]      = useState('');
  const [sortCol,     setSortCol]     = useState('facility');
  const [sortAsc,     setSortAsc]     = useState(true);

  const handleCalculate = async () => {
    if (!periodStart || !periodEnd) {
      push('Please select both a start and end date for the period', 'error');
      return;
    }
    if (!radetFile && !htsFile) {
      push('Please upload at least one report file (RADET or HTS)', 'error');
      return;
    }
    if (periodStart > periodEnd) {
      push('Start date must be before end date', 'error');
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const data = await api.calculateUtilization({ radetFile, htsFile, periodStart, periodEnd });
      setResult(data);
      const n = data.results?.length ?? 0;
      push(`Utilization calculated for ${n} facilit${n !== 1 ? 'ies' : 'y'}`, 'success');

      // Surface any column-detection errors from backend
      if (data.errors?.radet) push(`RADET: ${data.errors.radet}`, 'error');
      if (data.errors?.hts)   push(`HTS: ${data.errors.hts}`,   'error');
    } catch (e) {
      push(e.message || 'Calculation failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const toggleSort = (col) => {
    if (sortCol === col) setSortAsc(a => !a);
    else { setSortCol(col); setSortAsc(true); }
  };

  const rows = (result?.results || [])
    .filter(r => !search || r.facility.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const va = a[sortCol] ?? 0;
      const vb = b[sortCol] ?? 0;
      if (typeof va === 'string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortAsc ? va - vb : vb - va;
    });

  const totals = result?.totals ?? {};

  const SortIcon = ({ col }) => {
    if (sortCol !== col) return <ChevronDown className="h-3 w-3 text-neutral-300" />;
    return sortAsc
      ? <ChevronUp   className="h-3 w-3 text-neutral-600" />
      : <ChevronDown className="h-3 w-3 text-neutral-600" />;
  };

  const Th = ({ col, children, right }) => (
    <th
      onClick={() => toggleSort(col)}
      className={`px-3 py-3 text-xs font-semibold text-neutral-600 uppercase tracking-wide cursor-pointer select-none hover:bg-neutral-100 transition whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}
    >
      <span className="inline-flex items-center gap-1">
        {children} <SortIcon col={col} />
      </span>
    </th>
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
          <p className="text-sm text-neutral-500">Calculate how many forms/registers facilities should have used, based on RADET & HTS reports</p>
        </div>
      </div>

      {/* Controls card */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-5 space-y-5">

        {/* Period row */}
        <div>
          <p className="text-xs font-bold text-neutral-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" /> Reporting Period
          </p>
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[150px]">
              <label className="block text-[11px] text-neutral-500 mb-1">From</label>
              <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)}
                className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
            </div>
            <div className="flex-1 min-w-[150px]">
              <label className="block text-[11px] text-neutral-500 mb-1">To</label>
              <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}
                className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
            </div>
          </div>
        </div>

        {/* File uploads */}
        <div>
          <p className="text-xs font-bold text-neutral-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Upload className="h-3.5 w-3.5" /> Upload Reports
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-semibold text-neutral-600 mb-1.5">RADET Report</p>
              <p className="text-[11px] text-neutral-400 mb-2">Used for: Pharmacy Order Form, Care & Support Form, Daily Worksheet</p>
              <FileDropZone
                label="Click to upload RADET (.xlsx)"
                accept=".xlsx,.xls"
                file={radetFile}
                onChange={setRadetFile}
                disabled={loading}
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-neutral-600 mb-1.5">HTS_PEPFAR Report</p>
              <p className="text-[11px] text-neutral-400 mb-2">Used for: National HTS Form</p>
              <FileDropZone
                label="Click to upload HTS (.xlsx)"
                accept=".xlsx,.xls"
                file={htsFile}
                onChange={setHtsFile}
                disabled={loading}
              />
            </div>
          </div>
        </div>

        {/* Column guide */}
        <div className="rounded-xl bg-neutral-50 border border-neutral-200 px-4 py-3 text-xs text-neutral-500 space-y-1">
          <p className="font-semibold text-neutral-700 mb-1">Required columns in each file:</p>
          <p><span className="font-medium text-neutral-700">RADET</span> — <span className="font-mono">Facility Name</span> · <span className="font-mono">Last Pickup Date (yyyy-mm-dd)</span></p>
          <p><span className="font-medium text-neutral-700">HTS</span> — <span className="font-mono">facility</span> · <span className="font-mono">Date of Current HIV Testing (yyyy-mm-dd)</span></p>
        </div>

        <button
          onClick={handleCalculate}
          disabled={loading || (!radetFile && !htsFile) || !periodStart || !periodEnd}
          className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-semibold py-3 rounded-xl text-sm transition disabled:opacity-50"
        >
          {loading
            ? <><RefreshCw className="h-4 w-4 animate-spin" /> Calculating…</>
            : <><TrendingUp className="h-4 w-4" /> Calculate Utilization</>
          }
        </button>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-5">
          {/* Period badge */}
          <div className="flex items-center gap-2 text-sm text-neutral-600">
            <Calendar className="h-4 w-4 text-violet-500" />
            <span>Period: <strong>{result.period?.start}</strong> to <strong>{result.period?.end}</strong></span>
            <span className="text-neutral-400">·</span>
            <span>{totals.facility_count ?? 0} facilities</span>
            {result.radet_facilities > 0 && <span className="text-neutral-400">· {result.radet_facilities} from RADET</span>}
            {result.hts_facilities > 0 && <span className="text-neutral-400">· {result.hts_facilities} from HTS</span>}
          </div>

          {/* Errors */}
          {(result.errors?.radet || result.errors?.hts) && (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 space-y-1">
              <p className="text-xs font-bold text-rose-700 flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5" /> Column detection issues
              </p>
              {result.errors.radet && <p className="text-xs text-rose-600">{result.errors.radet}</p>}
              {result.errors.hts   && <p className="text-xs text-rose-600">{result.errors.hts}</p>}
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {TOOLS.map(t => (
              <SummaryCard key={t.key} tool={t} value={totals[t.key]} />
            ))}
          </div>

          {/* Search */}
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search facility…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-200" />
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead className="bg-neutral-50 border-b border-neutral-200">
                  <tr>
                    <Th col="facility">Facility</Th>
                    <Th col="radet_refills" right>RADET Refills</Th>
                    <Th col="hts_tests" right>HTS Tests</Th>
                    <Th col="combined_pharmacy_forms" right>
                      Combined Pharmacy<br/>Order Form
                    </Th>
                    <Th col="facility_care_support_forms" right>
                      Facility Care &<br/>Support Form
                    </Th>
                    <Th col="pharmacy_daily_worksheets" right>
                      Pharmacy Daily<br/>Worksheet
                    </Th>
                    <Th col="national_hts_forms" right>
                      National HTS<br/>Form
                    </Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-neutral-400 text-sm">
                        {search ? 'No facilities match your search' : 'No data in selected period'}
                      </td>
                    </tr>
                  ) : rows.map((r, i) => (
                    <tr key={i} className="hover:bg-neutral-50 transition">
                      <td className="px-3 py-2.5 font-medium text-neutral-900">{r.facility}</td>
                      <td className="px-3 py-2.5 text-right text-neutral-600">{r.radet_refills || '—'}</td>
                      <td className="px-3 py-2.5 text-right text-neutral-600">{r.hts_tests || '—'}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-emerald-700">{r.combined_pharmacy_forms || '—'}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-blue-700">{r.facility_care_support_forms || '—'}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-violet-700">{r.pharmacy_daily_worksheets || '—'}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-rose-700">{r.national_hts_forms || '—'}</td>
                    </tr>
                  ))}
                </tbody>
                {rows.length > 0 && (
                  <tfoot className="bg-neutral-50 border-t border-neutral-200 font-bold">
                    <tr>
                      <td className="px-3 py-2.5 text-neutral-700">
                        Total ({rows.length} facilit{rows.length !== 1 ? 'ies' : 'y'})
                      </td>
                      <td className="px-3 py-2.5 text-right text-neutral-600">
                        {rows.reduce((s, r) => s + r.radet_refills, 0) || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right text-neutral-600">
                        {rows.reduce((s, r) => s + r.hts_tests, 0) || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right text-emerald-700">
                        {rows.reduce((s, r) => s + r.combined_pharmacy_forms, 0)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-blue-700">
                        {rows.reduce((s, r) => s + r.facility_care_support_forms, 0)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-violet-700">
                        {rows.reduce((s, r) => s + r.pharmacy_daily_worksheets, 0)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-rose-700">
                        {rows.reduce((s, r) => s + r.national_hts_forms, 0)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {!result && !loading && (
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm py-16 text-center text-neutral-400">
          <TrendingUp className="h-12 w-12 mx-auto text-neutral-200 mb-3" />
          <p className="text-sm">Select a period and upload report(s) above, then click Calculate</p>
        </div>
      )}
    </div>
  );
}
