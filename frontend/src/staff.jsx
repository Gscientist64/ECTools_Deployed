// frontend/src/staff.jsx
import React, { useEffect, useState } from 'react';
import { api } from './api';
import { Users as UsersIcon, Pencil, Ban, CheckCircle, X } from 'lucide-react';
import { useToast } from './toasts';

export default function StaffScreen() {
  const { push } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  // Edit modal
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ first_name: '', email: '', role: 'user', facility: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.users();
      const list = Array.isArray(data) ? data : [];
      list.sort((a, b) => {
        const ra = (a.role || '').toLowerCase();
        const rb = (b.role || '').toLowerCase();
        if (ra === 'admin' && rb !== 'admin') return -1;
        if (rb === 'admin' && ra !== 'admin') return 1;
        return (a.first_name || '').localeCompare(b.first_name || '');
      });
      setRows(list);
    } catch (e) {
      push(e.message || 'Failed to load users', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openEdit = (u) => {
    setEditing(u);
    setForm({
      first_name: u.first_name || '',
      email: u.email || '',
      role: (u.role || 'user').toLowerCase(),
      facility: u.facility || '',
    });
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      await api.editUser(editing.id, form);
      push('User updated', 'success');
      setEditing(null);
      load();
    } catch (e) { push(e.message || 'Failed to update user', 'error'); }
    finally { setSaving(false); }
  };

  const toggleStatus = async (u) => {
    try {
      const res = await api.toggleUserStatus(u.id);
      push(res.message || 'Status toggled', 'success');
      load();
    } catch (e) { push(e.message || 'Failed', 'error'); }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-emerald-600 via-green-600 to-emerald-700 text-white grid place-items-center shadow">
          <UsersIcon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Staff Directory</h1>
          <p className="text-sm text-neutral-600">Manage users — edit details, change roles, enable or disable accounts.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
        <div className="hidden sm:grid grid-cols-12 gap-2 px-4 py-3 text-xs font-semibold text-neutral-600 border-b border-neutral-200">
          <div className="col-span-3">Name</div>
          <div className="col-span-3">Email</div>
          <div className="col-span-2">Facility</div>
          <div className="col-span-2">Role</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-neutral-600">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-neutral-600">No users found.</div>
        ) : (
          <ul className="divide-y divide-neutral-200">
            {rows.map((u) => {
              const role = (u.role || '').toLowerCase();
              const isDisabled = u.is_active === false;
              return (
                <li key={u.id} className={`px-4 py-3 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center ${isDisabled ? 'opacity-50 bg-neutral-50' : ''}`}>
                  <div className="sm:col-span-3">
                    <div className="font-medium flex items-center gap-1.5">
                      {u.first_name || u.username || '—'}
                      {isDisabled && <span className="text-[10px] bg-rose-100 text-rose-700 px-1.5 rounded-full">Disabled</span>}
                    </div>
                    <div className="text-xs text-neutral-600">{u.username || '—'}</div>
                  </div>
                  <div className="sm:col-span-3 text-sm truncate">{u.email || '—'}</div>
                  <div className="sm:col-span-2 text-sm truncate">{u.facility || '—'}</div>
                  <div className="sm:col-span-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      role === 'admin' ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 text-neutral-700'
                    }`}>
                      {u.role || 'user'}
                    </span>
                  </div>
                  <div className="sm:col-span-2 sm:text-right flex gap-1 justify-end">
                    <button onClick={() => openEdit(u)}
                      className="text-xs font-medium px-2 py-1 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700 flex items-center gap-1">
                      <Pencil className="h-3 w-3" />Edit
                    </button>
                    <button onClick={() => toggleStatus(u)}
                      className={`text-xs font-medium px-2 py-1 rounded-lg flex items-center gap-1 ${
                        isDisabled ? 'bg-emerald-100 hover:bg-emerald-200 text-emerald-700' : 'bg-rose-100 hover:bg-rose-200 text-rose-700'
                      }`}>
                      {isDisabled ? <><CheckCircle className="h-3 w-3" />Enable</> : <><Ban className="h-3 w-3" />Disable</>}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-neutral-200 overflow-hidden">
            <div className="bg-emerald-600 px-5 py-4 flex items-center justify-between text-white">
              <span className="font-semibold">Edit User — {editing.first_name || editing.username}</span>
              <button onClick={() => setEditing(null)}><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-600 mb-1">Name</label>
                <input value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                  className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-600 mb-1">Email</label>
                <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-600 mb-1">Facility</label>
                <input value={form.facility} onChange={e => setForm(f => ({ ...f, facility: e.target.value }))}
                  className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-emerald-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-600 mb-1">Role</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-emerald-400">
                  <option value="user">User (Facility)</option>
                  <option value="admin">Admin (HQ)</option>
                </select>
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button onClick={() => setEditing(null)}
                className="flex-1 py-2.5 rounded-xl border border-neutral-200 text-sm font-semibold hover:bg-neutral-50">Cancel</button>
              <button onClick={saveEdit} disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
