import React, { useState, useEffect } from 'react';
import { UserPlus, Trash2, Save, X, Shield, ChevronDown, Check, Search, Building2, Mail, Settings, Plus, Pencil } from 'lucide-react';
import { api } from './api';
import { useToast } from './toasts';

// ─── Facility Multi-Select (inline scrollable list) ──────────────────────────

function FacilityMultiSelect({ selected, onChange, facilities }) {
  const [search, setSearch] = useState('');
  const filtered = facilities.filter(f => f.toLowerCase().includes(search.toLowerCase()));
  const toggle = (fac) => selected.includes(fac) ? onChange(selected.filter(f => f !== fac)) : onChange([...selected, fac]);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
      <div className="p-2 border-b border-neutral-100 bg-neutral-50">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search facilities…" 
            className="w-full pl-8 pr-3 py-2 text-xs border border-neutral-200 rounded-lg outline-none focus:border-emerald-400 bg-white" />
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button onClick={() => onChange([...facilities])} className="text-[10px] text-emerald-600 hover:text-emerald-800 font-medium">Select All</button>
          <button onClick={() => onChange([])} className="text-[10px] text-neutral-400 hover:text-neutral-600 font-medium">Clear</button>
          <span className="text-[10px] text-neutral-400 ml-auto">{selected.length}/{facilities.length} selected</span>
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="text-xs text-neutral-400 text-center py-4">No facilities match "{search}"</p>
      ) : (
        filtered.map(fac => (
          <button key={fac} onClick={() => toggle(fac)}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition border-b border-neutral-50 last:border-b-0 hover:bg-neutral-50 ${selected.includes(fac) ? 'bg-emerald-50 text-emerald-800 font-medium' : 'text-neutral-700'}`}>
            <div className={`h-4 w-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${selected.includes(fac) ? 'bg-emerald-600 border-emerald-600' : 'border-neutral-300'}`}>
              {selected.includes(fac) && <Check className="h-3 w-3 text-white" />}
            </div>
            <span className="truncate text-xs">{fac}</span>
          </button>
        ))
      )}
    </div>
  );
}

// ─── Add / Edit Supervisor Modal ──────────────────────────────────────────────

function SupervisorModal({ open, onClose, onSave, editing, facilities }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [selectedFacs, setSelectedFacs] = useState([]);
  const [saving, setSaving] = useState(false);
  const { push } = useToast();

  useEffect(() => {
    if (editing) { setEmail(editing.email || ''); setName(editing.first_name || ''); setSelectedFacs(editing.supervised_facilities || []); }
    else { setEmail(''); setName(''); setSelectedFacs([]); }
  }, [editing, open]);

  const handleSave = async () => {
    if (!email.trim()) { push('Email is required', 'error'); return; }
    setSaving(true);
    try { await onSave({ email: email.trim(), first_name: name.trim(), facilities: selectedFacs }); onClose(); }
    catch (e) { push(e.message || 'Failed to save', 'error'); }
    finally { setSaving(false); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm p-4 pt-[8vh] overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-neutral-200 my-4">
        <div className="bg-emerald-600 px-5 py-4 flex items-center justify-between rounded-t-2xl">
          <div className="flex items-center gap-2 text-white font-semibold"><Shield className="h-5 w-5" />{editing ? 'Edit Supervisor' : 'Add Supervisor'}</div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Email Address</label>
            <div className="relative mt-1">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="supervisor@ecews.org"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-neutral-200 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Full Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Dr. Jane Doe"
              className="w-full mt-1 px-3 py-2.5 rounded-xl border border-neutral-200 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
          </div>
          <div className="min-h-[200px]">
            <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Assigned Facilities <span className="text-neutral-400 font-normal ml-1">(empty = all)</span></label>
            <div className="mt-1"><FacilityMultiSelect selected={selectedFacs} onChange={setSelectedFacs} facilities={facilities} /></div>
          </div>
          {selectedFacs.length > 0 && (
            <div className="text-[10px] text-neutral-500 bg-neutral-50 rounded-lg p-2 max-h-24 overflow-y-auto">
              {selectedFacs.length === facilities.length ? (
                <span className="text-emerald-600 font-medium">All {facilities.length} facilities selected</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {selectedFacs.map(f => <span key={f} className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[10px]">{f}</span>)}
                </div>
              )}
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button onClick={handleSave} disabled={saving} className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 text-sm transition disabled:opacity-60">
              <Save className="h-4 w-4" />{saving ? 'Saving…' : editing ? 'Update Supervisor' : 'Add Supervisor'}
            </button>
            <button onClick={onClose} className="flex-1 rounded-xl border border-neutral-200 text-neutral-600 hover:bg-neutral-50 font-medium py-2.5 text-sm transition">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── S.I Management (multiple Super-Supervisors with edit/remove) ─────────────

function SIManagementPanel() {
  const { push } = useToast();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [editingIdx, setEditingIdx] = useState(null);
  const [editEmail, setEditEmail] = useState('');
  const [editName, setEditName] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getSIManagementSettings();
      const list = Array.isArray(data.entries) ? data.entries : [];
      setEntries(list);
    } catch { setEntries([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const saveAll = async (newEntries) => {
    setSaving(true);
    try {
      await api.updateSIManagementSettings({ entries: newEntries });
      setEntries(newEntries);
      push('S.I Management updated', 'success');
    } catch (e) { push(e.message || 'Failed to save', 'error'); }
    finally { setSaving(false); }
  };

  const addEntry = () => {
    if (!newEmail.trim()) { push('Email is required', 'error'); return; }
    if (entries.some(e => e.email === newEmail.trim())) { push('This email is already added', 'error'); return; }
    const updated = [...entries, { email: newEmail.trim(), name: newName.trim() || 'S.I Management' }];
    saveAll(updated);
    setNewEmail('');
    setNewName('');
    setShowAdd(false);
  };

  const saveEdit = () => {
    if (!editEmail.trim()) { push('Email is required', 'error'); return; }
    const updated = [...entries];
    updated[editingIdx] = { email: editEmail.trim(), name: editName.trim() || 'S.I Management' };
    saveAll(updated);
    setEditingIdx(null);
  };

  const removeEntry = (idx) => {
    const updated = entries.filter((_, i) => i !== idx);
    saveAll(updated);
  };

  if (loading) return <div className="h-20 rounded-2xl bg-neutral-100 animate-pulse" />;

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-indigo-600 grid place-items-center"><Settings className="h-4 w-4 text-white" /></div>
          <div>
            <h3 className="text-sm font-bold text-neutral-900">S.I Management (Super-Supervisors)</h3>
            <p className="text-xs text-neutral-500">These supervisors receive requests after facility supervisor approval</p>
          </div>
        </div>
        <button
          onClick={() => { setShowAdd(!showAdd); setEditingIdx(null); }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 transition"
        >
          <Plus className="h-3.5 w-3.5" />Add
        </button>
      </div>

      {/* Add new entry form */}
      {showAdd && (
        <div className="mb-3 p-3 bg-white rounded-xl border border-indigo-200 space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
              <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
                placeholder="Email address" onKeyDown={e => e.key === 'Enter' && addEntry()}
                className="w-full pl-8 pr-2 py-2 rounded-lg border border-neutral-200 text-xs outline-none focus:border-indigo-400" />
            </div>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Name (optional)" onKeyDown={e => e.key === 'Enter' && addEntry()}
              className="w-40 rounded-lg border border-neutral-200 text-xs px-2 py-2 outline-none focus:border-indigo-400" />
          </div>
          <div className="flex gap-2">
            <button onClick={addEntry} disabled={saving} className="flex items-center gap-1 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition disabled:opacity-50">
              <Plus className="h-3 w-3" />{saving ? 'Adding…' : 'Add'}
            </button>
            <button onClick={() => setShowAdd(false)} className="text-xs text-neutral-500 hover:text-neutral-700 px-3 py-1.5">Cancel</button>
          </div>
        </div>
      )}

      {/* Entry list */}
      {entries.length === 0 ? (
        <p className="text-xs text-neutral-400 italic py-3">No S.I Management emails configured. Click "Add" to add one.</p>
      ) : (
        <div className="space-y-1.5">
          {entries.map((entry, idx) => (
            <div key={idx} className="flex items-center gap-3 bg-white rounded-xl border border-indigo-100 px-3 py-2.5">
              {editingIdx === idx ? (
                <>
                  <div className="relative flex-1">
                    <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
                    <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)}
                      className="w-full pl-8 pr-2 py-1.5 rounded-lg border border-neutral-200 text-xs outline-none focus:border-indigo-400" />
                  </div>
                  <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                    className="w-32 rounded-lg border border-neutral-200 text-xs px-2 py-1.5 outline-none focus:border-indigo-400" />
                  <button onClick={saveEdit} disabled={saving} className="p-1.5 rounded-lg hover:bg-emerald-50 text-neutral-400 hover:text-emerald-600 transition" title="Save">
                    <Save className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setEditingIdx(null)} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition" title="Cancel">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <div className="h-7 w-7 rounded-lg bg-indigo-100 grid place-items-center flex-shrink-0">
                    <span className="text-[10px] font-bold text-indigo-700">{(entry.name || 'S')[0].toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-neutral-800 truncate">{entry.name || 'S.I Management'}</div>
                    <div className="text-[10px] text-neutral-500 truncate">{entry.email}</div>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button
                      onClick={() => { setEditingIdx(idx); setEditEmail(entry.email); setEditName(entry.name || ''); }}
                      className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-indigo-600 transition" title="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => { if (window.confirm(`Remove ${entry.email} from S.I Management?`)) removeEntry(idx); }}
                      className="p-1.5 rounded-lg hover:bg-rose-50 text-neutral-400 hover:text-rose-600 transition" title="Remove">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Supervisor Management Screen ───────────────────────────────────────

export default function SupervisorManagement() {
  const { push } = useToast();
  const [supervisors, setSupervisors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, editing: null });
  const [facilities, setFacilities] = useState([]);

  const load = async () => {
    setLoading(true);
    try { const [sups, facs] = await Promise.all([api.listSupervisors(), api.listAllFacilities()]); setSupervisors(sups || []); setFacilities(facs || []); }
    catch { push('Failed to load supervisors', 'error'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async (data) => {
    if (modal.editing) await api.updateSupervisor(modal.editing.id, data);
    else await api.createSupervisor(data);
    push(modal.editing ? 'Supervisor updated' : 'Supervisor added', 'success');
    load();
  };

  const handleDelete = async (sup) => {
    if (!window.confirm(`Remove supervisor status from ${sup.email}?`)) return;
    try { await api.removeSupervisor(sup.id); push('Supervisor removed', 'success'); load(); }
    catch (e) { push(e.message || 'Failed to remove', 'error'); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-indigo-600 text-white grid place-items-center shadow-lg shadow-indigo-200"><Shield className="h-5 w-5" /></div>
          <div><h1 className="text-xl font-bold text-neutral-900">Supervisor Management</h1><p className="text-sm text-neutral-500">Manage facility supervisors and their assigned facilities.</p></div>
        </div>
        <button onClick={() => setModal({ open: true, editing: null })} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-4 py-2.5 text-sm transition shadow-sm">
          <UserPlus className="h-4 w-4" />Add Supervisor
        </button>
      </div>

      {/* S.I Management Panel */}
      <SIManagementPanel />

      {/* Supervisors List */}
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-20 rounded-2xl bg-neutral-100 animate-pulse" />)}</div>
      ) : supervisors.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-neutral-400"><Shield className="h-12 w-12 opacity-30" /><p className="text-sm">No supervisors configured yet.</p></div>
      ) : (
        <div className="space-y-2">
          {supervisors.map(sup => {
            const facs = sup.supervised_facilities || [];
            return (
              <div key={sup.id} className="rounded-2xl border border-neutral-200 bg-white px-4 py-3.5 flex flex-wrap items-center gap-3 shadow-sm">
                <div className="h-10 w-10 rounded-xl bg-indigo-100 grid place-items-center flex-shrink-0"><span className="text-sm font-bold text-indigo-700">{(sup.first_name || sup.email)[0].toUpperCase()}</span></div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-neutral-900">{sup.first_name || 'Supervisor'}</div>
                  <div className="text-xs text-neutral-500 flex items-center gap-1"><Mail className="h-3 w-3" />{sup.email}</div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-neutral-600 min-w-48">
                  <Building2 className="h-3.5 w-3.5 text-neutral-400 flex-shrink-0" />
                  {facs.length === 0 ? <span className="font-medium text-emerald-600">All Facilities</span> : (
                    <div className="flex flex-wrap gap-1">
                      {facs.slice(0, 3).map(f => <span key={f} className="bg-neutral-100 text-neutral-700 px-2 py-0.5 rounded-full text-[10px] font-medium truncate max-w-32">{f}</span>)}
                      {facs.length > 3 && <span className="text-neutral-400 text-[10px]">+{facs.length - 3} more</span>}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => setModal({ open: true, editing: sup })} className="p-2 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-emerald-600 transition" title="Edit"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => handleDelete(sup)} className="p-2 rounded-lg hover:bg-rose-50 text-neutral-400 hover:text-rose-600 transition" title="Remove"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SupervisorModal open={modal.open} editing={modal.editing} onClose={() => setModal({ open: false, editing: null })} onSave={handleSave} facilities={facilities} />
    </div>
  );
}
