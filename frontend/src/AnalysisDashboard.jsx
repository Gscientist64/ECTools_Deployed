// frontend/src/AnalysisDashboard.jsx
import React, { useState, useEffect } from 'react';
import { useToast } from './toasts';
import { api } from './api';
import { Button, Select } from './ui';
import {
  BarChart3,
  TrendingUp,
  Users,
  Package,
  Calendar,
  Building,
  Activity
} from 'lucide-react';

// Simple chart components
const BarChart = ({ data, color = '#10b981', height = 200 }) => {
  if (!data || data.length === 0) return <div className="text-center text-neutral-500 py-8">No data available</div>;

  const maxValue = Math.max(...data.map(d => d.value));
  return (
    <div className="flex items-end justify-between gap-1" style={{ height }}>
      {data.map((item, index) => (
        <div key={index} className="flex flex-col items-center flex-1">
          <div
            className="w-full rounded-t transition-all hover:opacity-80"
            style={{
              height: `${maxValue ? (item.value / maxValue) * 100 : 0}%`,
              backgroundColor: color,
              minHeight: '4px'
            }}
          />
          <div className="text-xs text-neutral-600 mt-1 text-center truncate w-full">
            {item.label}
          </div>
        </div>
      ))}
    </div>
  );
};

const LineChart = ({ data, color = '#10b981', height = 200 }) => {
  if (!data || data.length === 0) return <div className="text-center text-neutral-500 py-8">No data available</div>;

  const maxValue = Math.max(...data.map(d => d.value));
  const points = data.map((item, index) => {
    const x = (index / (data.length - 1)) * 100;
    const y = 100 - (maxValue ? (item.value / maxValue) * 100 : 0);
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width="100%" height={height} className="overflow-visible">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="3"
        points={points}
        className="transition-all"
      />
      {data.map((item, index) => {
        const x = (index / (data.length - 1)) * 100;
        const y = 100 - (maxValue ? (item.value / maxValue) * 100 : 0);
        return (
          <circle
            key={index}
            cx={x + '%'}
            cy={y}
            r="4"
            fill={color}
            className="hover:r-6 transition-all cursor-pointer"
          />
        );
      })}
    </svg>
  );
};

export function AnalysisDashboard() {
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState(null);
  const [period, setPeriod] = useState('30');

  useEffect(() => {
    fetchDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const data = await api.getDashboardAnalysisData(period);
      setDashboardData(data);
    } catch (error) {
      push(`Failed to load analysis data: ${error.message}`, 'error');
      setDashboardData(null);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600 mx-auto"></div>
          <p className="text-neutral-600 dark:text-neutral-400 mt-2">Loading analysis...</p>
        </div>
      </div>
    );
  }

  if (!dashboardData) {
    return (
      <div className="text-center py-12">
        <BarChart3 className="h-12 w-12 text-neutral-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-2">
          No data available
        </h3>
        <p className="text-neutral-600 dark:text-neutral-400">
          There's no analysis data to display yet.
        </p>
      </div>
    );
  }

  // ✅ safe defaults so styling/components always render
  const summary = dashboardData?.summary || {
    total_requests: 0,
    total_items: 0,
    avg_daily_requests: 0,
    unique_facilities: 0,
  };

  const daily_trends = Array.isArray(dashboardData?.daily_trends) ? dashboardData.daily_trends : [];
  const facility_distribution = Array.isArray(dashboardData?.facility_distribution) ? dashboardData.facility_distribution : [];
  const category_distribution = Array.isArray(dashboardData?.category_distribution) ? dashboardData.category_distribution : [];
  const status_distribution = Array.isArray(dashboardData?.status_distribution) ? dashboardData.status_distribution : [];
  const top_tools = Array.isArray(dashboardData?.top_tools) ? dashboardData.top_tools : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Tools Analysis Dashboard</h1>
          <p className="text-neutral-600 dark:text-neutral-400 mt-1">
            Visual insights into tool usage patterns and consumption trends
          </p>
        </div>

        <div className="flex gap-3">
          <Select
            value={period}
            onChange={setPeriod}
            options={[
              { value: '7', label: 'Last 7 days' },
              { value: '30', label: 'Last 30 days' },
              { value: '90', label: 'Last 90 days' },
              { value: '180', label: 'Last 180 days' }
            ]}
            placeholder="Period"
          />
          <Button onClick={fetchDashboardData} variant="outline">
            <Activity className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-neutral-600 dark:text-neutral-400">Total Requests</p>
              <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mt-1">
                {summary.total_requests ?? 0}
              </p>
            </div>
            <Package className="h-8 w-8 text-emerald-600" />
          </div>
        </div>

        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-neutral-600 dark:text-neutral-400">Total Items</p>
              <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mt-1">
                {summary.total_items ?? 0}
              </p>
            </div>
            <TrendingUp className="h-8 w-8 text-blue-600" />
          </div>
        </div>

        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-neutral-600 dark:text-neutral-400">Avg Daily Requests</p>
              <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mt-1">
                {Math.round(summary.avg_daily_requests ?? 0)}
              </p>
            </div>
            <Calendar className="h-8 w-8 text-amber-600" />
          </div>
        </div>

        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-neutral-600 dark:text-neutral-400">Active Facilities</p>
              <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mt-1">
                {summary.unique_facilities ?? 0}
              </p>
            </div>
            <Building className="h-8 w-8 text-purple-600" />
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Request Trends */}
        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6">
          <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
            Daily Request Trends
          </h3>
          <LineChart
            data={daily_trends.map(trend => ({
              label: new Date(trend.date).toLocaleDateString(),
              value: trend.daily_requests
            }))}
            color="#10b981"
            height={200}
          />
        </div>

        {/* Facility Distribution */}
        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6">
          <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-4 flex items-center gap-2">
            <Building className="h-4 w-4 text-blue-600" />
            Top Facilities by Requests
          </h3>
          <div className="space-y-3">
            {facility_distribution.slice(0, 5).map((facility, index) => (
              <div key={facility.facility || index} className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                    {index + 1}
                  </div>
                  <span className="text-sm text-neutral-700 dark:text-neutral-300 truncate" title={facility.facility}>
                    {facility.facility}
                  </span>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-neutral-900 dark:text-neutral-100">
                    {facility.request_count ?? 0}
                  </div>
                  <div className="text-xs text-neutral-600 dark:text-neutral-400">
                    {facility.total_items ?? 0} items
                  </div>
                </div>
              </div>
            ))}
            {facility_distribution.length === 0 && (
              <div className="text-sm text-neutral-500 dark:text-neutral-400">No facility data yet.</div>
            )}
          </div>
        </div>

        {/* Category Distribution */}
        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6">
          <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-4 flex items-center gap-2">
            <Package className="h-4 w-4 text-amber-600" />
            Tool Categories
          </h3>
          <div className="space-y-2">
            {category_distribution.map((category, index) => (
              <div key={category.category || index} className="flex items-center justify-between">
                <span className="text-sm text-neutral-700 dark:text-neutral-300">
                  {category.category || 'Uncategorized'}
                </span>
                <div className="flex items-center gap-2">
                  <div className="w-20 bg-neutral-200 dark:bg-neutral-700 rounded-full h-2">
                    <div
                      className="bg-amber-500 h-2 rounded-full"
                      style={{
                        width: `${
                          (category.total_quantity / Math.max(...category_distribution.map(c => c.total_quantity || 1))) * 100
                        }%`
                      }}
                    />
                  </div>
                  <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100 w-12 text-right">
                    {category.total_quantity ?? 0}
                  </span>
                </div>
              </div>
            ))}
            {category_distribution.length === 0 && (
              <div className="text-sm text-neutral-500 dark:text-neutral-400">No category data yet.</div>
            )}
          </div>
        </div>

        {/* Status Distribution */}
        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6">
          <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-4 flex items-center gap-2">
            <Activity className="h-4 w-4 text-purple-600" />
            Request Status
          </h3>
          <div className="space-y-3">
            {status_distribution.map((status, index) => (
              <div key={status.status || index} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{
                      backgroundColor:
                        status.status === 'Approved' ? '#10b981' :
                        status.status === 'Pending' ? '#f59e0b' :
                        status.status === 'Rejected' ? '#ef4444' : '#6b7280'
                    }}
                  />
                  <span className="text-sm text-neutral-700 dark:text-neutral-300 capitalize">
                    {(status.status || '').toLowerCase()}
                  </span>
                </div>
                <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {status.count ?? 0}
                </span>
              </div>
            ))}
            {status_distribution.length === 0 && (
              <div className="text-sm text-neutral-500 dark:text-neutral-400">No status data yet.</div>
            )}
          </div>
        </div>

        {/* Top Requested Tools */}
        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6 lg:col-span-2">
          <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-4 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-emerald-600" />
            Most Requested Tools (Top 9)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {top_tools.slice(0, 9).map((tool, index) => {
              const colors = [
                { bg: 'bg-gradient-to-br from-emerald-500 to-green-500', text: 'text-white' },
                { bg: 'bg-gradient-to-br from-blue-500 to-cyan-500', text: 'text-white' },
                { bg: 'bg-gradient-to-br from-purple-500 to-pink-500', text: 'text-white' },
                { bg: 'bg-gradient-to-br from-amber-500 to-orange-500', text: 'text-white' },
                { bg: 'bg-gradient-to-br from-red-500 to-rose-500', text: 'text-white' },
                { bg: 'bg-gradient-to-br from-indigo-500 to-blue-500', text: 'text-white' },
                { bg: 'bg-gradient-to-br from-teal-500 to-emerald-500', text: 'text-white' },
                { bg: 'bg-gradient-to-br from-rose-500 to-pink-500', text: 'text-white' },
                { bg: 'bg-gradient-to-br from-violet-500 to-purple-500', text: 'text-white' }
              ];

              const color = colors[index % colors.length];

              return (
                <div
                  key={tool.tool_name || index}
                  className={`${color.bg} ${color.text} rounded-xl p-4 transform transition-transform hover:scale-105 hover:shadow-lg`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white text-sm font-bold">
                      {index + 1}
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold">
                        {tool.total_requested ?? 0}
                      </div>
                      <div className="text-xs opacity-90">
                        {tool.request_count ?? 0} req
                      </div>
                    </div>
                  </div>
                  <div className="font-semibold text-sm mb-1 line-clamp-2">
                    {tool.tool_name}
                  </div>
                  <div className="text-xs opacity-90 line-clamp-1">
                    {tool.category}
                  </div>
                </div>
              );
            })}
            {top_tools.length === 0 && (
              <div className="text-sm text-neutral-500 dark:text-neutral-400">No tool data yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
