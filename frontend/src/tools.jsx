// frontend/src/tools.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { useToast } from './toasts';
import { PackageCheck, Pencil, Trash2, ListOrdered, Layers, RefreshCw } from 'lucide-react';
import { Input, Button, Select } from './ui';

function Modal({ open, onClose, title, children, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-neutral-200">
        <div className="px-5 py-3 border-b border-neutral-200 flex items-center justify-between">
          <div className="text-sm font-semibold">{title}</div>
          <button onClick={onClose} className="text-neutral-500 text-sm">Close</button>
        </div>
        <div className="p-5">{children}</div>
        {footer ? <div className="px-5 pb-5">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ToolsScreen() {
  const { push } = useToast();
  const [rows, setRows] = useState([]);
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  // edit modal
  const [editing, setEditing] = useState(null); // tool object
  const [form, setForm] = useState({ name: '', description: '', quantity: 0, category: '' });

  // logs modal
  const [logOpen, setLogOpen] = useState(false);
  const [logTool, setLogTool] = useState(null);
  const [logs, setLogs] = useState([]);

  // delete modal
  const [delOpen, setDelOpen] = useState(false);
  const [delTool, setDelTool] = useState(null);
  const [delPwd, setDelPwd] = useState('');

  // Refresh tools function - call this whenever quantities might have changed
  const loadTools = async () => {
    setLoading(true);
    try {
      const [tools, categories] = await Promise.all([
        api.tools({ q }),
        api.categories(),
      ]);
      setRows(Array.isArray(tools) ? tools : []);
      setCats(Array.isArray(categories) ? categories : []);
    } catch (e) {
      push(e.message || 'Failed to load tools', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Manual refresh function
  const handleRefresh = async () => {
    await loadTools();
    push('Tools list refreshed', 'success');
  };

  // Set up periodic refresh to catch quantity changes
  useEffect(() => {
    loadTools(); // Initial load
    
    // Refresh every 30 seconds to catch quantity updates
    const interval = setInterval(loadTools, 1200000);
    return () => clearInterval(interval);
  }, []);

  // Debounced search - but always refresh data
  useEffect(() => { 
    const t = setTimeout(loadTools, 250); 
    return () => clearTimeout(t); 
  }, [q]);

  const onEdit = (t) => {
    setEditing(t);
    setForm({
      name: t.name || '',
      description: t.description || '',
      quantity: Number(t.quantity || 0),
      category: t.category || '',
    });
  };

  const onSave = async () => {
    try {
      await api.updateTool(editing.id, {
        name: form.name,
        description: form.description,
        quantity: Number(form.quantity || 0),
        category: form.category,
      });
      push('Tool updated', 'success');
      setEditing(null);
      await loadTools(); // Refresh to get updated quantities
    } catch (e) {
      push(e.message || 'Failed to update tool', 'error');
    }
  };

  const onLogs = async (t) => {
    try {
      const data = await api.toolLogs(t.id);
  
      // backend might return array OR object {distributions/logs}
      const list =
        Array.isArray(data) ? data :
        Array.isArray(data?.distributions) ? data.distributions :
        Array.isArray(data?.logs) ? data.logs :
        Array.isArray(data?.data) ? data.data :
        [];
  
      setLogTool(t);
      setLogs(list);
      setLogOpen(true);
    } catch (e) {
      push(e.message || 'Failed to load logs', 'error');
    }
  };
  

  const onDelete = (t) => {
    setDelTool(t);
    setDelPwd('');
    setDelOpen(true);
  };

  const confirmDelete = async () => {
    try {
      await api.deleteTool(delTool.id, delPwd);
      push('Tool deleted', 'success');
      setDelOpen(false);
      setDelTool(null);
      await loadTools(); // Refresh after deletion
    } catch (e) {
      push(e.message || 'Failed to delete tool', 'error');
    }
  };

  const filtered = useMemo(() => rows, [rows]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-emerald-600 via-green-600 to-emerald-700 text-white grid place-items-center shadow">
            <PackageCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-neutral-900">Tools</h1>
            <p className="text-sm text-neutral-600">Manage inventory, view distributions, and edit details.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tools…" className="w-56" />
          <Button variant="outline" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
        <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-3 text-xs font-semibold text-neutral-600 border-b border-neutral-200">
          <div className="col-span-5 flex items-center gap-1"><Layers className="h-3.5 w-3.5" /> Tool</div>
          <div className="col-span-3">Category</div>
          <div className="col-span-2">Quantity in Stock</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-neutral-600">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-sm text-neutral-600">No tools.</div>
        ) : (
          filtered.map((t) => (
            <div key={t.id} className="border-t border-neutral-200 px-4 py-3 grid md:grid-cols-12 gap-3">
              <div className="md:col-span-5">
                <div className="text-sm font-medium text-neutral-900">{t.name}</div>
                {t.description ? <div className="text-xs text-neutral-600 mt-0.5 line-clamp-1">{t.description}</div> : null}
              </div>
              <div className="md:col-span-3 text-sm">{t.category || '—'}</div>
              <div className="md:col-span-2">
                <div className={`text-sm font-semibold ${
                  t.quantity > 10 
                    ? 'text-emerald-600' 
                    : t.quantity > 0 
                    ? 'text-amber-600' 
                    : 'text-red-600'
                }`}>
                  {Number(t.quantity || 0)}
                </div>
                <div className="text-xs text-neutral-500">
                  {t.quantity > 10 ? 'Good stock' : t.quantity > 0 ? 'Low stock' : 'Out of stock'}
                </div>
              </div>
              <div className="md:col-span-2 md:text-right flex md:block gap-2">
                <Button variant="subtle" onClick={() => onLogs(t)}>
                  <ListOrdered className="h-4 w-4" />
                  View Logs
                </Button>
                <Button variant="ghost" onClick={() => onEdit(t)} className="mt-0 md:mt-2">
                  <Pencil className="h-4 w-4" />
                  Edit
                </Button>
                <Button variant="ghost" color="rose" onClick={() => onDelete(t)} className="mt-0 md:mt-2">
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Edit modal */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Edit Tool${editing ? ` — ${editing.name}` : ''}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="subtle" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={onSave}>Save</Button>
          </div>
        }
      >
        <div className="grid gap-3">
          <div>
            <label className="block text-xs font-semibold mb-1">Name</label>
            <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Description</label>
            <Input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Quantity</label>
            <Input
              inputMode="numeric"
              pattern="[0-9]*"
              value={String(form.quantity ?? 0)}
              onChange={(e) => {
                const n = e.target.value.replace(/[^\d]/g, '');
                setForm((p) => ({ ...p, quantity: n === '' ? 0 : Number(n) }));
              }}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Category</label>
            <Select
              value={form.category}
              onChange={(v) => setForm((p) => ({ ...p, category: v }))}
              options={(cats || []).map(c => ({ value: c.name, label: c.name }))}
              placeholder="Select category"
            />
          </div>
        </div>
      </Modal>

      {/* Logs modal */}
      <Modal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        title={logTool ? `Distribution Logs — ${logTool.name}` : 'Distribution Logs'}
      >
        {logs.length === 0 ? (
          <div className="text-sm text-neutral-600">No distributions recorded yet.</div>
        ) : (
          <div className="grid gap-2">
            <div className="hidden md:grid grid-cols-12 text-xs font-semibold text-neutral-600">
              <div className="col-span-5">Facility</div>
              <div className="col-span-3">Issued To</div>
              <div className="col-span-2">Quantity</div>
              <div className="col-span-2">Date</div>
            </div>
            {logs.map(l => (
              <div key={l.id} className="grid md:grid-cols-12 gap-2 rounded-xl border border-neutral-200 px-3 py-2">
                <div className="md:col-span-5 text-sm">{l.facility || '—'}</div>
                <div className="md:col-span-3 text-sm">{l.user_name || '—'}</div>
                <div className="md:col-span-2 text-sm font-semibold">{l.quantity}</div>
                <div className="md:col-span-2 text-xs text-neutral-600">
                  {l.date ? new Date(l.date).toLocaleString() : '—'}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Delete modal */}
      <Modal
        open={delOpen}
        onClose={() => setDelOpen(false)}
        title={delTool ? `Delete Tool — ${delTool.name}` : 'Delete Tool'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="subtle" onClick={() => setDelOpen(false)}>Cancel</Button>
            <Button color="rose" onClick={confirmDelete}>Delete</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="text-sm">Enter admin password to confirm deletion.</div>
          <Input type="password" value={delPwd} onChange={(e) => setDelPwd(e.target.value)} placeholder="••••••••" />
        </div>
      </Modal>
    </div>
  );
}