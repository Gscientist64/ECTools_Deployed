// adminDashboard.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import { useToast } from './toasts';
import { LayoutDashboard, Building2, Package, Users, Loader2, RefreshCw } from 'lucide-react';

export default function AdminDashboardScreen() {
  const { push } = useToast();
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [facilities, setFacilities] = useState([]);
  const [selectedFacility, setSelectedFacility] = useState(null);
  const [facilityStock, setFacilityStock] = useState([]);
  const [facilityCounts, setFacilityCounts] = useState([]);
  const [facilityLoading, setFacilityLoading] = useState(false);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.adminDashboardSummary();
      setSummary(data);
    } catch (e) {
      push(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [push]);

  const fetchFacilities = useCallback(async () => {
    try {
      const data = await api.adminFacilities();
      setFacilities(data);
    } catch (e) {
      push(e.message, 'error');
    }
  }, [push]);

  useEffect(() => {
    fetchSummary();
    fetchFacilities();
  }, [fetchSummary, fetchFacilities]);

  const viewFacility = async (facilityName) => {
    setSelectedFacility(facilityName);
    setFacilityLoading(true);
    try {
      const [stock, counts] = await Promise.all([
        api.adminFacilityStock(facilityName),
        api.adminFacilityPhysicalCounts(facilityName),
      ]);
      setFacilityStock(stock);
      setFacilityCounts(counts);
    } catch (e) {
      push(e.message, 'error');
    } finally {
      setFacilityLoading(false);
    }
  };

  if (loading && !summary) {
    return (
      <div className="flex items-center gap-2 text-neutral-500 p-8">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading HQ dashboard...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <LayoutDashboard className="h-6 w-6 text-emerald-700" />
        <h1 className="text-xl font-bold">HQ Dashboard</h1>
        <button onClick={fetchSummary} className="p-1.5 hover:bg-neutral-100 rounded-lg ml-auto" title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl shadow border border-neutral-200 p-5">
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Total Facilities</p>
            <p className="text-2xl font-bold mt-1">{summary.total_facilities || 0}</p>
          </div>
          <div className="bg-white rounded-2xl shadow border border-neutral-200 p-5">
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Total Users</p>
            <p className="text-2xl font-bold mt-1">{summary.total_users || 0}</p>
          </div>
          <div className="bg-white rounded-2xl shadow border border-neutral-200 p-5">
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Total Stock Items</p>
            <p className="text-2xl font-bold mt-1">{summary.total_stock_items || 0}</p>
          </div>
          <div className="bg-white rounded-2xl shadow border border-neutral-200 p-5">
            <p className="text-xs text-neutral-500 uppercase tracking-wide">Pending Requests</p>
            <p className={`text-2xl font-bold mt-1 ${(summary.pending_requests || 0) > 0 ? 'text-amber-600' : ''}`}>
              {summary.pending_requests || 0}
            </p>
          </div>
        </div>
      )}

      {/* Facilities List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Facilities Table */}
        <div className="bg-white rounded-2xl shadow border border-neutral-200 overflow-hidden">
          <div className="p-4 border-b border-neutral-100">
            <h2 className="font-semibold flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Facilities
            </h2>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-3">Facility</th>
                  <th className="text-left px-4 py-3">Users</th>
                  <th className="text-left px-4 py-3">Stock Items</th>
                  <th className="text-left px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {facilities.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-neutral-400">No facilities found</td></tr>
                ) : facilities.map((f, i) => (
                  <tr key={i} className="border-t border-neutral-100 hover:bg-neutral-50 cursor-pointer"
                    onClick={() => viewFacility(f.name)}>
                    <td className="px-4 py-3 font-medium">{f.name}</td>
                    <td className="px-4 py-3">{f.user_count || 0}</td>
                    <td className="px-4 py-3">{f.stock_count || 0}</td>
                    <td className="px-4 py-3">
                      <button className="text-xs text-emerald-600 hover:underline">View Stock</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Facility Detail */}
        <div className="bg-white rounded-2xl shadow border border-neutral-200 overflow-hidden">
          <div className="p-4 border-b border-neutral-100">
            <h2 className="font-semibold">
              {selectedFacility ? `Facility: ${selectedFacility}` : 'Select a facility'}
            </h2>
          </div>
          {facilityLoading ? (
            <div className="flex items-center gap-2 p-4 text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : selectedFacility ? (
            <div className="p-4 space-y-4">
              {/* Stock */}
              <div>
                <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Package className="h-3 w-3" /> Stock
                </h3>
                {facilityStock.length === 0 ? (
                  <p className="text-xs text-neutral-400">No stock records</p>
                ) : (
                  <div className="overflow-x-auto max-h-48 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-neutral-50">
                        <tr>
                          <th className="text-left px-2 py-1.5">Tool ID</th>
                          <th className="text-left px-2 py-1.5">Name</th>
                          <th className="text-left px-2 py-1.5">Qty</th>
                          <th className="text-left px-2 py-1.5">Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {facilityStock.map((s, i) => (
                          <tr key={i} className="border-t border-neutral-50">
                            <td className="px-2 py-1.5 font-mono text-[10px]">{s.tool_id}</td>
                            <td className="px-2 py-1.5">{s.tool_name || s.name || '—'}</td>
                            <td className="px-2 py-1.5 font-semibold">{s.quantity}</td>
                            <td className="px-2 py-1.5 text-neutral-500">{s.updated_at ? new Date(s.updated_at).toLocaleDateString() : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Physical Counts */}
              <div>
                <h3 className="text-sm font-medium mb-2">Recent Physical Counts</h3>
                {facilityCounts.length === 0 ? (
                  <p className="text-xs text-neutral-400">No physical counts</p>
                ) : (
                  <div className="overflow-x-auto max-h-48 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-neutral-50">
                        <tr>
                          <th className="text-left px-2 py-1.5">Date</th>
                          <th className="text-left px-2 py-1.5">Tool</th>
                          <th className="text-left px-2 py-1.5">System</th>
                          <th className="text-left px-2 py-1.5">Actual</th>
                          <th className="text-left px-2 py-1.5">Var</th>
                        </tr>
                      </thead>
                      <tbody>
                        {facilityCounts.map((c, i) => {
                          const variance = (c.physical_count || 0) - (c.system_quantity || 0);
                          return (
                            <tr key={i} className="border-t border-neutral-50">
                              <td className="px-2 py-1.5">{new Date(c.created_at || c.date).toLocaleDateString()}</td>
                              <td className="px-2 py-1.5 font-mono text-[10px]">{c.tool_id}</td>
                              <td className="px-2 py-1.5">{c.system_quantity || 0}</td>
                              <td className="px-2 py-1.5">{c.physical_count || 0}</td>
                              <td className={`px-2 py-1.5 font-medium ${variance < 0 ? 'text-red-600' : variance > 0 ? 'text-emerald-600' : ''}`}>
                                {variance > 0 ? '+' : ''}{variance}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-neutral-400 text-sm">
              Click on a facility in the table to view its stock and physical counts
            </div>
          )}
        </div>
      </div>
    </div>
  );
}