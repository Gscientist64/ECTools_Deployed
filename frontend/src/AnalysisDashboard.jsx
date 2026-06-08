// frontend/src/AnalysisDashboard.jsx
import React, { useState, useEffect } from 'react';
import { useToast } from './toasts';
import { api } from './api';
import { Button } from './ui';
import {
  BarChart3, TrendingUp, Package, Calendar, Building, Activity,
  Box, Layers
} from 'lucide-react';

// ─────────────────── Chart Components ───────────────────

const MiniBarChart = ({ data, color = '#10b981', height = 140 }) => {
  if (!data || data.length === 0) return <div className="text-center text-neutral-400 py-6 text-xs">No data</div>;
  const maxValue = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="flex items-end gap-[2px]" style={{ height }}>
      {data.map((item, i) => (
        <div key={i} className="flex-1 flex flex-col items-center justify-end h-full" title={`${item.label}: ${item.value}`}>
          <div className="w-full rounded-sm transition-all hover:opacity-75 cursor-pointer"
            style={{ height: `${(item.value / maxValue) * 100}%`, backgroundColor: color, minHeight: 2 }} />
        </div>
      ))}
    </div>
  );
};

const LineChart = ({ data, color = '#10b981', height = 200 }) => {
  if (!data || data.length === 0) return <div className="text-center text-neutral-400 py-6 text-xs">No data</div>;
  const maxValue = Math.max(...data.map(d => d.value), 1);
  const w = 100; const h = 100; const pad = 6;
  const xs = (i) => pad + (i / Math.max(data.length - 1, 1)) * (w - pad * 2);
  const ys = (v) => h - pad - (v / maxValue) * (h - pad * 2);
  const pts = data.map((d, i) => `${xs(i)},${ys(d.value)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="lgrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <polygon points={`${xs(0)},${h - pad} ${pts} ${xs(data.length - 1)},${h - pad}`} fill="url(#lgrad)" />
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={pts} />
      {data.filter((_, i) => data.length <= 15 || i % Math.ceil(data.length / 10) === 0).map((d, i) => (
        <circle key={i} cx={xs(i)} cy={ys(d.value)} r="2.5" fill="white" stroke={color} strokeWidth="1.5" />
      ))}
    </svg>
  );
};

const DonutChart = ({ segments, size = 120 }) => {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  let cumulative = 0;
  const colors = ['#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4'];
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox="0 0 36 36" className="shrink-0">
        {segments.map((seg, i) => {
          const pct = seg.value / total;
          const dash = (pct * 100).toFixed(1);
          const offset = (cumulative * 100).toFixed(1);
          cumulative += pct;
          return <circle key={i} cx="18" cy="18" r="12" fill="none" stroke={colors[i % colors.length]} strokeWidth="6"
            strokeDasharray={`${dash} ${100 - dash}`} strokeDashoffset={-offset} strokeLinecap="butt"
            className="transition-all duration-500" />;
        })}
        <text x="18" y="19" textAnchor="middle" fill="#1f2937" className="text-[8px] font-bold">{total}</text>
      </svg>
      <div className="space-y-1 text-xs">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colors[i % colors.length] }} />
            <span className="text-neutral-500 capitalize">{seg.label}</span>
            <span className="font-semibold ml-auto">{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─────────────────── Main Dashboard ───────────────────

export function AnalysisDashboard() {
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState(null);
  const [period, setPeriod] = useState('30');

  useEffect(() => { fetchDashboardData(); }, [period]); // eslint-disable-line

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const data = await api.getDashboardAnalysisData(period);
      setDashboardData(data);
    } catch (error) {
      push(`Failed to load analysis data: ${error.message}`, 'error');
      setDashboardData(null);
    } finally { setLoading(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-80">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-neutral-200 border-t-emerald-600 mx-auto" />
          <p className="text-neutral-500 mt-3 text-sm">Loading analysis data...</p>
        </div>
      </div>
    );
  }

  if (!dashboardData) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-neutral-400">
        <BarChart3 className="h-14 w-14 mb-4 opacity-30" />
        <h3 className="text-base font-medium text-neutral-500 mb-1">No Data Available</h3>
        <p className="text-xs">No analysis data exists for the selected period.</p>
      </div>
    );
  }

  const summary = dashboardData?.summary || { total_requests: 0, total_items: 0, avg_daily_requests: 0, unique_facilities: 0 };
  const daily_trends = (dashboardData?.daily_trends || []).map(t => ({
    label: new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    value: t.daily_requests
  }));
  const monthly_trends = (dashboardData?.monthly_trends || []).map(t => ({
    label: t.month,
    value: t.request_count
  }));
  const facility_dist = dashboardData?.facility_distribution || [];
  const category_dist = dashboardData?.category_distribution || [];
  const status_dist = (dashboardData?.status_distribution || []).map(s => ({
    label: (s.status || 'unknown').toLowerCase(),
    value: s.count
  }));
  const top_tools = dashboardData?.top_tools || [];

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Analytics Dashboard</h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            Comprehensive overview of tool requests, usage patterns &amp; facility activity
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-neutral-100 rounded-lg p-0.5">
            {['7', '30', '90', '180'].map(d => (
              <button key={d} onClick={() => setPeriod(d)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${period === d ? 'bg-white shadow-sm text-neutral-900' : 'text-neutral-500 hover:text-neutral-700'}`}>
                {d}d
              </button>
            ))}
          </div>
          <Button onClick={fetchDashboardData} variant="outline" className="text-xs h-8">
            <Activity className="h-3.5 w-3.5 mr-1" />Refresh
          </Button>
        </div>
      </div>

      {/* ── Summary KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Requests', value: summary.total_requests, icon: Package, color: '#10b981', subtitle: `${summary.unique_facilities} facilities` },
          { label: 'Total Items', value: summary.total_items, icon: Box, color: '#3b82f6', subtitle: 'Requested quantity' },
          { label: 'Daily Average', value: Math.round(summary.avg_daily_requests), icon: Calendar, color: '#f59e0b', subtitle: 'Requests per day' },
          { label: 'Active Facilities', value: summary.unique_facilities, icon: Building, color: '#8b5cf6', subtitle: 'Submitted requests' },
        ].map((card, i) => (
          <div key={i} className="bg-white rounded-xl border border-neutral-200 p-4 hover:shadow-sm transition-shadow">
            <div className="flex items-start justify-between mb-2">
              <span className="text-xs font-medium text-neutral-400 uppercase tracking-wider">{card.label}</span>
              <card.icon className="h-5 w-5" style={{ color: card.color }} />
            </div>
            <p className="text-2xl font-bold text-neutral-900">{(card.value || 0).toLocaleString()}</p>
            <p className="text-[11px] text-neutral-400 mt-0.5">{card.subtitle}</p>
          </div>
        ))}
      </div>

      {/* ── Two-Column Charts ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Daily Trends */}
        <div className="bg-white rounded-xl border border-neutral-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm text-neutral-800 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-500" />Daily Request Trends
            </h3>
            <span className="text-[11px] text-neutral-400">{daily_trends.length} days</span>
          </div>
          <LineChart data={daily_trends} color="#10b981" height={180} />
          {daily_trends.length > 0 && (
            <div className="flex justify-between mt-2 text-[10px] text-neutral-400">
              <span>{daily_trends[0]?.label}</span>
              <span>{daily_trends[daily_trends.length - 1]?.label}</span>
            </div>
          )}
        </div>

        {/* Monthly Trends */}
        <div className="bg-white rounded-xl border border-neutral-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm text-neutral-800 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-500" />Monthly Request Volume
            </h3>
            <span className="text-[11px] text-neutral-400">{monthly_trends.length} months</span>
          </div>
          <MiniBarChart data={monthly_trends} color="#3b82f6" height={140} />
          {monthly_trends.length > 0 && (
            <div className="flex justify-between mt-2 text-[10px] text-neutral-400">
              {monthly_trends.slice(0, 6).map((m, i) => <span key={i}>{m.label}</span>)}
            </div>
          )}
        </div>

        {/* Status Distribution */}
        <div className="bg-white rounded-xl border border-neutral-200 p-5">
          <h3 className="font-semibold text-sm text-neutral-800 mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4 text-purple-500" />Request Status Breakdown
          </h3>
          {status_dist.length > 0 ? (
            <DonutChart segments={status_dist} size={110} />
          ) : (
            <p className="text-xs text-neutral-400 py-4 text-center">No status data yet</p>
          )}
        </div>

        {/* Category Distribution */}
        <div className="bg-white rounded-xl border border-neutral-200 p-5">
          <h3 className="font-semibold text-sm text-neutral-800 mb-3 flex items-center gap-2">
            <Layers className="h-4 w-4 text-amber-500" />Tool Categories
          </h3>
          {category_dist.length > 0 ? (
            <div className="space-y-2">
              {category_dist.slice(0, 6).map((cat, i) => {
                const max = Math.max(...category_dist.map(c => c.total_quantity), 1);
                const pct = Math.round((cat.total_quantity / max) * 100);
                return (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-24 truncate text-neutral-600">{cat.category}</span>
                    <div className="flex-1 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-400 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="font-semibold text-neutral-800 w-8 text-right">{cat.total_quantity}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-neutral-400 py-4 text-center">No category data</p>
          )}
        </div>
      </div>

      {/* ── Top Tools & Facility Breakdown ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Top Tools Table */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-neutral-200 p-5">
          <h3 className="font-semibold text-sm text-neutral-800 mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-emerald-500" />Most Requested Tools
          </h3>
          {top_tools.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-100 text-left text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
                    <th className="pb-2 w-8">#</th>
                    <th className="pb-2">Tool</th>
                    <th className="pb-2 hidden sm:table-cell">Category</th>
                    <th className="pb-2 text-right">Qty</th>
                    <th className="pb-2 text-right">Reqs</th>
                  </tr>
                </thead>
                <tbody>
                  {top_tools.slice(0, 12).map((tool, i) => {
                    const maxQty = Math.max(...top_tools.map(t => t.total_requested), 1);
                    const barPct = Math.round((tool.total_requested / maxQty) * 100);
                    return (
                      <tr key={i} className="border-b border-neutral-50 hover:bg-neutral-50/50 transition-colors">
                        <td className="py-2.5 font-mono text-xs text-neutral-400">{i + 1}</td>
                        <td className="py-2.5">
                          <span className="font-medium text-neutral-800">{tool.tool_name}</span>
                          <div className="mt-1 h-1 bg-neutral-100 rounded-full w-full max-w-[200px]">
                            <div className="h-full bg-emerald-400 rounded-full transition-all duration-500" style={{ width: `${barPct}%` }} />
                          </div>
                        </td>
                        <td className="py-2.5 text-xs text-neutral-500 hidden sm:table-cell">{tool.category}</td>
                        <td className="py-2.5 text-right font-semibold">{tool.total_requested}</td>
                        <td className="py-2.5 text-right text-neutral-500">{tool.request_count}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-neutral-400 py-6 text-center">No tool request data</p>
          )}
        </div>

        {/* Facility Breakdown */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-neutral-200 p-5">
          <h3 className="font-semibold text-sm text-neutral-800 mb-3 flex items-center gap-2">
            <Building className="h-4 w-4 text-blue-500" />Facility Activity
          </h3>
          {facility_dist.length > 0 ? (
            <div className="space-y-1 max-h-[360px] overflow-y-auto">
              {facility_dist.map((f, i) => {
                const maxR = Math.max(...facility_dist.map(x => x.request_count), 1);
                const pct = Math.round((f.request_count / maxR) * 100);
                return (
                  <div key={i} className="flex items-center gap-2 py-1.5 border-b border-neutral-50 last:border-0 text-xs">
                    <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-[10px]">{i + 1}</span>
                    <span className="flex-1 truncate text-neutral-700 font-medium">{f.facility}</span>
                    <div className="flex items-center gap-2 min-w-[130px]">
                      <div className="flex-1 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-400 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="font-semibold w-5 text-right">{f.request_count}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-neutral-400 py-6 text-center">No facility data</p>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <p className="text-center text-[11px] text-neutral-300">
        Data shown for the last {period} days &bull; Updated {new Date().toLocaleTimeString()}
      </p>
    </div>
  );
}
