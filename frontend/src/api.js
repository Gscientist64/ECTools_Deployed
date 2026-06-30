// frontend/src/api.js

// Build a safe base that works both locally and in production under /toolsapp/
// If VITE_API_URL is set (e.g. http://148.230.125.89/toolsapp), use it.
// Otherwise fall back to Vite's BASE_URL (e.g. '/toolsapp/').
const API_BASE = (import.meta.env.VITE_API_URL || import.meta.env.BASE_URL).replace(/\/+$/, '');

// Join helper to always hit the Flask API under /api/*
const withApi = (path) => `${API_BASE}/api${path}`;

// Helper to parse JSON and surface server error messages nicely
const asJson = async (res) => {
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j?.error || j?.message || '';
    } catch {}
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return res.json();
};

export const api = {
  // ---------- Auth ----------
  async me() {
    const r = await fetch(withApi('/me'), { credentials: 'include' });
    return asJson(r);
  },

  async login(username, password) {
    const r = await fetch(withApi('/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    return asJson(r);
  },

  async signup(payload) {
    const r = await fetch(withApi('/signup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload), // include facility & role in payload
    });
    return asJson(r);
  },

  async logout() {
    const r = await fetch(withApi('/logout'), { method: 'POST', credentials: 'include' });
    return asJson(r);
  },

  // ---------- Tools ----------
  async tools(params = {}) {
    const q = new URLSearchParams(params).toString();
    const r = await fetch(withApi(`/tools${q ? `?${q}` : ''}`), { credentials: 'include' });
    return asJson(r);
  },

  async createTool(payload) {
    const r = await fetch(withApi('/tools'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    return asJson(r);
  },

  async updateTool(id, payload) {
    const r = await fetch(withApi(`/tools/${id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    return asJson(r);
  },

  async deleteTool(id, password) {
    const r = await fetch(withApi(`/tools/${id}`), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ password }),
    });
    return asJson(r);
  },

  async toolLogs(id) {
    const r = await fetch(withApi(`/tools/${id}/logs`), { credentials: 'include' });
    return asJson(r);
  },

  async checkoutTool(id, assignee) {
    const r = await fetch(withApi(`/tools/${id}/checkout`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ assignee }),
    });
    return asJson(r);
  },

  async checkinTool(id) {
    const r = await fetch(withApi(`/tools/${id}/checkin`), {
      method: 'POST',
      credentials: 'include',
    });
    return asJson(r);
  },

  async importCSV(file) {
    const f = new FormData();
    f.append('file', file);
    const r = await fetch(withApi('/tools/import'), {
      method: 'POST',
      body: f,
      credentials: 'include',
    });
    return asJson(r);
  },

  async exportCSV() {
    const r = await fetch(withApi('/tools/export'), { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text(); // CSV text
  },

  // ---------- Users / Categories / Catalog ----------
  async users() {
    const r = await fetch(withApi('/users'), { credentials: 'include' });
    return asJson(r);
  },

  async categories() {
    const r = await fetch(withApi('/categories'), { credentials: 'include' });
    return asJson(r);
  },

  async catalog() {
    const r = await fetch(withApi('/catalog'), { credentials: 'include' });
    return asJson(r);
  },

  // ---------- Requests ----------
  async createRequest(items) {
    const r = await fetch(withApi('/requests'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ items }),
    });
    return asJson(r);
  },

  // (optional alias if some code still calls createCombinedRequest)
  async createCombinedRequest(items) {
    return this.createRequest(items);
  },

  async myRequests() {
    const r = await fetch(withApi('/requests'), { credentials: 'include' });
    const j = await asJson(r);
    if (Array.isArray(j)) return j;
    if (j && Array.isArray(j.requests)) return j.requests;
    return [];
  },

  // ---------- Admin ----------
  async adminRequests(status) {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    const r = await fetch(withApi(`/admin/requests${qs}`), { credentials: 'include' });
    return asJson(r);
  },

  async adminApproveRequest(id) {
    const r = await fetch(withApi(`/admin/requests/${id}/approve`), {
      method: 'POST',
      credentials: 'include',
    });
    return asJson(r);
  },

  async adminRejectRequest(id) {
    const r = await fetch(withApi(`/admin/requests/${id}/reject`), {
      method: 'POST',
      credentials: 'include',
    });
    return asJson(r);
  },

  async adminEditRequest(id, lines) {
    const r = await fetch(withApi(`/admin/requests/${id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ lines }),
    });
    return asJson(r);
  },

  async adminDeleteRequest(id) {
    const r = await fetch(withApi(`/admin/requests/${id}`), {
      method: 'DELETE',
      credentials: 'include',
    });
    return asJson(r);
  },

  async adminPendingCount() {
    const r = await fetch(withApi(`/admin/pending-count`), { credentials: 'include' });
    return asJson(r);
  },

  // ---------- Forecast ----------
  async forecastPharmacy({ file, periodDays = "30", facility = "", refillsPerBooklet = "50" }) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("period_days", String(periodDays));
    fd.append("facility", facility || "");
    fd.append("refills_per_booklet", String(refillsPerBooklet));

    const r = await fetch(withApi("/forecast/pharmacy"), {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    return asJson(r);
  },


  // ---------- Reports & Analysis ----------
  async generateRequestSummaryReport(payload) {
    const r = await fetch(withApi('/reports/request-summary'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.blob();
  },

  async generateInventoryConsumptionReport() {
    const r = await fetch(withApi('/reports/inventory-consumption'), {
      credentials: 'include',
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.blob();
  },

  async getToolUsageAnalysis(period = '30', limit = '10') {
    const r = await fetch(withApi(`/analysis/tool-usage?period=${period}&limit=${limit}`), {
      credentials: 'include',
    });
    return asJson(r);
  },

  async getConsumptionTrends(toolId = null, period = '90') {
    const url = toolId 
      ? `/analysis/consumption-trends?tool_id=${toolId}&period=${period}`
      : `/analysis/consumption-trends?period=${period}`;
    const r = await fetch(withApi(url), { credentials: 'include' });
    return asJson(r);
  },

  async getDashboardAnalysisData(period = '30') {
    const r = await fetch(withApi(`/analysis/dashboard-data?period=${period}`), {
      credentials: 'include',
    });
    return asJson(r);
  },

  async getRecentNotifications() {
    const r = await fetch(withApi('/notifications/recent'), { credentials: 'include' });
    return asJson(r);
  },

  async markNotificationRead(deliveryId) {
    const r = await fetch(withApi(`/notifications/mark-read/${deliveryId}`), {
      method: 'POST',
      credentials: 'include',
    });
    return asJson(r);
  },

  async markAllNotificationsRead() {
    const r = await fetch(withApi('/notifications/mark-all-read'), {
      method: 'POST',
      credentials: 'include',
    });
    return asJson(r);
  },

  // ---------- Delivery Management (New) ----------
  async getMyDeliveries() {
    const r = await fetch(withApi('/delivery/my-confirmations'), { credentials: 'include' });
    return asJson(r);
  },

  async getPendingDeliveries() {
    const r = await fetch(withApi('/delivery/pending-confirmations'), { credentials: 'include' });
    return asJson(r);
  },

  async confirmDelivery(requestedToolId, witnessedBy, basicUnit) {
    const r = await fetch(withApi(`/delivery/confirm/${requestedToolId}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ witnessed_by: witnessedBy, basic_unit: basicUnit }),
    });
    return asJson(r);
  },

  async confirmRequestDelivery(requestId, witnessedBy, basicUnit, actualQtys) {
    const r = await fetch(withApi(`/delivery/confirm-request/${requestId}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        witnessed_by: witnessedBy,
        basic_unit: basicUnit,
        actual_quantities: actualQtys || {},
      }),
    });
    return asJson(r);
  },

  async generateDeliveryNote(deliveryId) {
    const r = await fetch(withApi(`/delivery/generate-note/${deliveryId}`), {
      method: 'POST',
      credentials: 'include',
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.blob();
  },

  async downloadDeliveryNote(deliveryId) {
    const r = await fetch(withApi(`/delivery/note/${deliveryId}/download`), {
      method: 'GET',
      credentials: 'include',
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.blob();
  },

  // ---------- Facility-to-Facility Transfer ----------
  async initiateTransfer(payload) {
    const r = await fetch(withApi('/inventory/transfer/initiate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    return asJson(r);
  },

  async incomingTransfers() {
    const r = await fetch(withApi('/inventory/transfer/incoming'), { credentials: 'include' });
    return asJson(r);
  },

  async outgoingTransfers() {
    const r = await fetch(withApi('/inventory/transfer/outgoing'), { credentials: 'include' });
    return asJson(r);
  },

  async acceptTransfer(transferId) {
    const r = await fetch(withApi(`/inventory/transfer/${transferId}/accept`), {
      method: 'POST',
      credentials: 'include',
    });
    return asJson(r);
  },

  async rejectTransfer(transferId) {
    const r = await fetch(withApi(`/inventory/transfer/${transferId}/reject`), {
      method: 'POST',
      credentials: 'include',
    });
    return asJson(r);
  },

  async cancelTransfer(transferId) {
    const r = await fetch(withApi(`/inventory/transfer/${transferId}/cancel`), {
      method: 'POST',
      credentials: 'include',
    });
    return asJson(r);
  },

  async allTransfers() {
    const r = await fetch(withApi('/inventory/transfer/all'), { credentials: 'include' });
    return asJson(r);
  },

  // ---------- List Facilities (for transfer dropdown) ----------
  async listFacilities() {
    const r = await fetch(withApi('/admin/facilities'), { credentials: 'include' });
    return asJson(r);
  },

  // ---------- Inventory ----------
  async myStock() {
    const r = await fetch(withApi('/inventory/my-stock'), { credentials: 'include' });
    return asJson(r);
  },

  async myStockLongitudinal(period = 'week', year = null) {
    const params = new URLSearchParams({ period });
    if (year) params.set('year', String(year));
    const r = await fetch(withApi(`/inventory/my-stock/longitudinal?${params}`), { credentials: 'include' });
    return asJson(r);
  },

  async updateQtyReceived(toolId, qtyReceived) {
    const r = await fetch(withApi('/inventory/my-stock/update-qty-received'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ tool_id: toolId, qty_received: qtyReceived }),
    });
    return asJson(r);
  },

  async myDistributions() {
    const r = await fetch(withApi('/inventory/distributions'), { credentials: 'include' });
    return asJson(r);
  },

  async distributeToDepartment(payload) {
    const r = await fetch(withApi('/inventory/distribute'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    return asJson(r);
  },

  async myInventorySummary() {
    const r = await fetch(withApi('/inventory/summary'), { credentials: 'include' });
    return asJson(r);
  },

  async recordPhysicalCount(payload) {
    const r = await fetch(withApi('/inventory/physical-count'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    return asJson(r);
  },

  async myPhysicalCounts() {
    const r = await fetch(withApi('/inventory/physical-counts'), { credentials: 'include' });
    return asJson(r);
  },

  async myStocktake() {
    const r = await fetch(withApi('/inventory/stocktake'), { credentials: 'include' });
    return asJson(r);
  },

  // ---------- Utilization ----------
  async recordUtilization(payload) {
    const r = await fetch(withApi('/inventory/record-utilization'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    return asJson(r);
  },

  async myUtilization() {
    const r = await fetch(withApi('/inventory/my-utilization'), { credentials: 'include' });
    return asJson(r);
  },

  // ---------- Admin Inventory ----------
  async adminDashboardSummary() {
    const r = await fetch(withApi('/admin/dashboard-summary'), { credentials: 'include' });
    return asJson(r);
  },

  async adminFacilities() {
    const r = await fetch(withApi('/admin/facilities'), { credentials: 'include' });
    return asJson(r);
  },

  async adminFacilityStock(facilityName) {
    const r = await fetch(withApi(`/admin/facility/${encodeURIComponent(facilityName)}/stock`), { credentials: 'include' });
    return asJson(r);
  },

  async adminFacilityPhysicalCounts(facilityName) {
    const r = await fetch(withApi(`/admin/facility/${encodeURIComponent(facilityName)}/physical-counts`), { credentials: 'include' });
    return asJson(r);
  },

  // --- Stock Receipts ---
  async listStockReceipts() {
    const r = await fetch(withApi('/stock-receipts'), { credentials: 'include' });
    return asJson(r);
  },
  async getStockReceipt(id) {
    const r = await fetch(withApi(`/stock-receipts/${id}`), { credentials: 'include' });
    return asJson(r);
  },
  async createStockReceipt(data) {
    const r = await fetch(withApi('/stock-receipts'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    });
    return asJson(r);
  },
  async deleteStockReceipt(id) {
    const r = await fetch(withApi(`/stock-receipts/${id}`), {
      method: 'DELETE',
      credentials: 'include',
    });
    return asJson(r);
  },

  // Updated reject with reason
  async adminRejectRequestWithReason(id, reason) {
    const r = await fetch(withApi(`/admin/requests/${id}/reject`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ reason }),
    });
    return asJson(r);
  },

  // ---------- Confirmed Delivery Notes ----------
  async listConfirmedDeliveryNotes() {
    const r = await fetch(withApi('/delivery/confirmed'), { credentials: 'include' });
    return asJson(r);
  },

  async getDeliveryNotePreview(requestId) {
    const r = await fetch(withApi(`/delivery/preview/${requestId}`), { credentials: 'include' });
    return asJson(r);
  },

  async downloadRequestDeliveryNote(requestId) {
    const r = await fetch(withApi(`/delivery/generate-request-note/${requestId}`), {
      method: 'POST',
      credentials: 'include',
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.blob();
  },

  // ---------- Audit Log ----------
  async getAuditLog(params = {}) {
    const q = new URLSearchParams(params).toString();
    const r = await fetch(withApi(`/admin/audit-log${q ? `?${q}` : ''}`), { credentials: 'include' });
    return asJson(r);
  },

  // ---------- Request Comments ----------
  async getRequestComments(reqId) {
    const r = await fetch(withApi(`/requests/${reqId}/comments`), { credentials: 'include' });
    return asJson(r);
  },

  async addRequestComment(reqId, message) {
    const r = await fetch(withApi(`/requests/${reqId}/comments`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ message }),
    });
    return asJson(r);
  },

  // ---------- Batch Approve / Reject ----------
  async batchApproveRequests(ids) {
    const r = await fetch(withApi('/admin/requests/batch-approve'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ ids }),
    });
    return asJson(r);
  },

  async batchRejectRequests(ids, reason = '') {
    const r = await fetch(withApi('/admin/requests/batch-reject'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ ids, reason }),
    });
    return asJson(r);
  },

  // ---------- Low Stock ----------
  async getLowStock(threshold) {
    const q = threshold !== undefined ? `?threshold=${threshold}` : '';
    const r = await fetch(withApi(`/admin/low-stock${q}`), { credentials: 'include' });
    return asJson(r);
  },

  async setToolThreshold(toolId, low_stock_threshold) {
    const r = await fetch(withApi(`/tools/${toolId}/threshold`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ low_stock_threshold }),
    });
    return asJson(r);
  },

  // ---------- Facility Dashboard ----------
  async facilityDashboard() {
    const r = await fetch(withApi('/facility/dashboard'), { credentials: 'include' });
    return asJson(r);
  },

  // ---------- Admin Dashboard ----------
  async adminDashboard() {
    const r = await fetch(withApi('/admin/dashboard-summary'), { credentials: 'include' });
    return asJson(r);
  },

  // ---------- Monthly Consumption Report ----------
  async getMonthlyConsumption(year, month) {
    const r = await fetch(withApi(`/reports/monthly-consumption?year=${year}&month=${month}`), { credentials: 'include' });
    return asJson(r);
  },

  async downloadMonthlyConsumption(year, month) {
    const r = await fetch(withApi(`/reports/monthly-consumption/download?year=${year}&month=${month}`), { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.blob();
  },
};
