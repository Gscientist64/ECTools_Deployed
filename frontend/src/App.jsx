// App.jsx
import React, { useState } from 'react';
import './index.css';
import { ToolsScreen } from './tools';
import { ToastProvider, useToast } from './toasts';
import { AuthProvider, useAuth } from './auth';
import Login from './Login';
import {
  PackageCheck, ClipboardList, Users, Settings, BarChart3,
  FileText, Warehouse, PackageOpen, ArrowRightLeft,
  ShieldCheck, LayoutGrid, TrendingUp,
} from 'lucide-react';
import RequestScreen from './requests';
import AdminScreen from './admin';
import StaffScreen from './staff';
import { ReportsScreen } from './reports';
import { AnalysisScreen } from './analysis';
import { useAdminPendingRequestNotifier } from "./adminNotifier";
import ToolsForecastScreen from './toolsForecast';
import MyInventoryScreen from './myInventory';
import DeliveryNotifier from './DeliveryNotifier';
import StockReceiptsScreen from './stockReceipts';
import DeliveryNotesScreen from './DeliveryNotes';
import FacilityDashboard from './facilityDashboard';
import FacilityTransfersScreen from './facilityTransfers';
import AuditLogScreen from './auditLog';
import AdminDashboard from './adminDashboard';


const SidebarItem = ({ icon: Icon, label, active, onClick, badge }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-3 py-2 rounded-2xl text-sm transition w-full text-left
      ${active ? 'bg-gradient-to-r from-emerald-600 to-green-600 text-white' : 'hover:bg-neutral-100'}`}
  >
    <Icon className="h-4 w-4 flex-shrink-0" />
    <span className="flex-1">{label}</span>
    {badge != null && badge > 0 && (
      <span className="h-5 w-5 flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold leading-none">
        {badge > 9 ? '9+' : badge}
      </span>
    )}
  </button>
);

function Shell() {
  const [tab, setTab] = useState('dashboard');
  const { me, logout, loading } = useAuth();
  const { push } = useToast();

  const role    = ((me?.role || me?.roles || 'user') + '').toLowerCase();
  const isAdmin = role === 'admin';

  useAdminPendingRequestNotifier({
    enabled: !loading && !!me?.id,
    isAdmin,
    pollMs: 30000,
    snoozeMs: 15 * 60 * 1000,
    soundUrl: "/notify.mp3",
  });

  if (!me) return <Login />;

  const go = (nextTab, adminOnly = false) => {
    if (adminOnly && !isAdmin) { push("You're not an admin", 'error'); return; }
    setTab(nextTab);
  };

  // Pass navigate to facility dashboard so its quick-action buttons work
  const navigate = (t) => setTab(t);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="fixed top-4 right-4 z-50">
        <DeliveryNotifier />
      </div>

      <div className="flex">
        <aside className="hidden lg:flex lg:w-64 flex-col gap-1 border-r border-neutral-200 dark:border-neutral-800 p-3 min-h-screen">
          {/* Brand + user */}
          <div className="flex items-center justify-between px-1 py-2 mb-1">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white shadow overflow-hidden">
                <img src="/ecews-logo.png" alt="ECEWS" className="h-7 w-7 object-contain" />
              </div>
              <div>
                <div className="text-sm font-semibold truncate max-w-[120px]">
                  {me.first_name || me.name || me.username}
                </div>
                <div className="text-xs opacity-70 truncate max-w-[120px]">
                  {me.facility || '—'}
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className={`text-[11px] px-2 py-0.5 rounded-full ${isAdmin ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 text-neutral-700'}`}>
                {role}
              </span>
              <button className="text-xs underline opacity-60 hover:opacity-100" onClick={logout}>
                Logout
              </button>
            </div>
          </div>

          {/* ── Facility user tabs ── */}
          {!isAdmin && (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 px-2 mt-1 mb-0.5">My Facility</p>
              <SidebarItem icon={LayoutGrid}     label="Dashboard"      active={tab==='dashboard'}    onClick={() => go('dashboard')} />
              <SidebarItem icon={ClipboardList}  label="Requests"       active={tab==='requests'}     onClick={() => go('requests')} />
              <SidebarItem icon={Warehouse}      label="My Inventory"   active={tab==='myinventory'}  onClick={() => go('myinventory')} />
              <SidebarItem icon={FileText}       label="Delivery Notes" active={tab==='deliverynotes'} onClick={() => go('deliverynotes')} />
              <SidebarItem icon={ArrowRightLeft} label="Transfers"      active={tab==='transfers'}    onClick={() => go('transfers')} />
            </>
          )}

          {/* ── Admin tabs ── */}
          {isAdmin && (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 px-2 mt-1 mb-0.5">HQ</p>
              <SidebarItem icon={LayoutGrid}      label="Dashboard"        active={tab==='dashboard'}      onClick={() => go('dashboard', true)} />
              <SidebarItem icon={PackageCheck}    label="Tools"            active={tab==='tools'}          onClick={() => go('tools', true)} />
              <SidebarItem icon={BarChart3}       label="Analysis"         active={tab==='analysis'}       onClick={() => go('analysis', true)} />
              <SidebarItem icon={TrendingUp}      label="Tools Forecast"   active={tab==='forecast'}       onClick={() => go('forecast', true)} />
              <SidebarItem icon={FileText}        label="Reports"          active={tab==='reports'}        onClick={() => go('reports', true)} />
              <SidebarItem icon={Users}           label="Users"            active={tab==='staff'}          onClick={() => go('staff', true)} />
              <SidebarItem icon={PackageOpen}     label="Delivery Receipts" active={tab==='stockreceipts'} onClick={() => go('stockreceipts', true)} />
              <SidebarItem icon={ArrowRightLeft}  label="Transfers"        active={tab==='transfers'}      onClick={() => go('transfers', true)} />
              <SidebarItem icon={ShieldCheck}     label="Audit Log"        active={tab==='auditlog'}       onClick={() => go('auditlog', true)} />
              <SidebarItem icon={Settings}        label="Admin"            active={tab==='admin'}          onClick={() => go('admin', true)} />
            </>
          )}
        </aside>

        <main className="flex-1 p-6 max-w-7xl mx-auto">
          {/* Dashboard — different component per role */}
          {tab === 'dashboard' && (isAdmin
            ? <AdminDashboard onNavigate={navigate} />
            : <FacilityDashboard onNavigate={navigate} />
          )}

          {/* Facility user screens */}
          {tab === 'requests'                  && <RequestScreen />}
          {tab === 'myinventory'               && <MyInventoryScreen />}
          {tab === 'deliverynotes'             && <DeliveryNotesScreen />}
          {tab === 'transfers'                 && <FacilityTransfersScreen />}

          {/* Admin screens */}
          {tab === 'tools'           && (isAdmin ? <ToolsScreen /> : null)}
          {tab === 'analysis'        && (isAdmin ? <AnalysisScreen /> : null)}
          {tab === 'forecast'        && (isAdmin ? <ToolsForecastScreen /> : null)}
          {tab === 'reports'         && (isAdmin ? <ReportsScreen /> : null)}
          {tab === 'staff'           && (isAdmin ? <StaffScreen /> : null)}
          {tab === 'stockreceipts'   && (isAdmin ? <StockReceiptsScreen /> : null)}
          {tab === 'auditlog'        && (isAdmin ? <AuditLogScreen /> : null)}
          {tab === 'admin'           && (isAdmin ? <AdminScreen /> : null)}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </ToastProvider>
  );
}
