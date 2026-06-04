// frontend/src/staff.jsx
import React, { useEffect, useState } from 'react';
import { api } from './api';
import { Users as UsersIcon } from 'lucide-react';
import { useToast } from './toasts';

export default function StaffScreen() {
  const { push } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.users();
      const list = Array.isArray(data) ? data : [];
      // admins first
      list.sort((a, b) => {
        const ra = (a.role || '').toLowerCase();
        const rb = (b.role || '').toLowerCase();
        if (ra === 'admin' && rb !== 'admin') return -1;
        if (rb === 'admin' && ra !== 'admin') return 1;
        return (a.name || '').localeCompare(b.name || '');
      });
      setRows(list);
    } catch (e) {
      push(e.message || 'Failed to load users', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-emerald-600 via-green-600 to-emerald-700 text-white grid place-items-center shadow">
          <UsersIcon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Staff Directory</h1>
          <p className="text-sm text-neutral-600">All registered users (admins first).</p>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
        {/* Table header */}
        <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-3 text-xs font-semibold text-neutral-600 border-b border-neutral-200">
          <div className="col-span-4">Name</div>
          <div className="col-span-3">Email</div>
          <div className="col-span-3">Facility</div>
          <div className="col-span-2 text-right">Role</div>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-neutral-600">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-neutral-600">No users found.</div>
        ) : (
          <ul className="divide-y divide-neutral-200">
            {rows.map((u) => {
              const role = (u.role || '').toLowerCase();
              return (
                <li key={u.id} className="px-4 py-3 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                  <div className="sm:col-span-4">
                    <div className="font-medium">{u.name || u.username || '—'}</div>
                    <div className="text-xs text-neutral-600">{u.username || '—'}</div>
                  </div>
                  <div className="sm:col-span-3 text-sm">{u.email || '—'}</div>
                  <div className="sm:col-span-3 text-sm">{u.facility || '—'}</div>
                  <div className="sm:col-span-2 sm:text-right">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      role === 'admin' ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 text-neutral-700'
                    }`}>
                      {u.role || 'user'}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
