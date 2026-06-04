// frontend/src/dashboard.jsx
import React, { useEffect, useState } from 'react';
import { api } from './api';
import { ChevronDown, FolderTree } from 'lucide-react';

export default function DashboardScreen() {
  const [data, setData] = useState([]);
  const [openKey, setOpenKey] = useState(null); // single open panel key
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const catalog = await api.catalog();
        setData(Array.isArray(catalog) ? catalog : []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Safely resolve a stable key for each row (id preferred; fallback to name; finally index)
  const getRowKey = (item, index) =>
    item?.id ?? item?.category_id ?? item?.categoryId ?? item?.name ?? item?.category ?? index;

  // Safely resolve the category label
  const getCategoryLabel = (item) => {
    const raw =
      item?.category ??
      item?.name ??
      item?.category_name ??
      item?.title ??
      ''; // last resort empty -> will show fallback text
    return typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
  };

  const toggle = (rowKey) => {
    setOpenKey((cur) => (cur === rowKey ? null : rowKey));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-emerald-600 via-green-600 to-emerald-700 text-white grid place-items-center shadow">
            <FolderTree className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-neutral-900">Tools Available</h1>
            <p className="text-sm text-neutral-600">Tap a category to view tools.</p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="grid gap-4 sm:grid-cols-1">
        {loading ? (
          <div className="rounded-2xl p-6 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
            Loading…
          </div>
        ) : data.length === 0 ? (
          <div className="rounded-2xl p-6 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-center">
            No categories yet.
          </div>
        ) : (
          data.map((item, index) => {
            const rowKey = getRowKey(item, index);
            const tools = Array.isArray(item?.tools) ? item.tools : [];
            const catName = getCategoryLabel(item);
            const open = openKey === rowKey;

            return (
              <div
                key={rowKey}
                className="rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm"
              >
                {/* Row header */}
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggle(rowKey)}
                  className="w-full flex items-center px-4 py-4 hover:bg-emerald-50/60 dark:hover:bg-emerald-900/20 transition"
                >
                  {/* LEFT: category name (left-justified, truncates nicely) */}
                  <div className="flex-1 min-w-0 text-left">
                    <div className="font-semibold text-emerald-700 dark:text-emerald-300 truncate">
                      {catName || 'Category'}
                    </div>
                  </div>

                  {/* RIGHT: count + chevron (fixed; doesn't squeeze name) */}
                  <div className="ml-3 flex items-center gap-3 shrink-0">
                    <div className="text-xs font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                      {tools.length} tool{tools.length === 1 ? '' : 's'}
                    </div>
                    <ChevronDown
                      className={`h-5 w-5 transition-transform ${open ? 'rotate-180' : ''} text-emerald-700`}
                    />
                  </div>
                </button>

                {/* Tools panel (only the open one expands) */}
                <div
                  className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                    open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="px-4 pb-4">
                      {tools.length === 0 ? (
                        <div className="text-sm text-neutral-500">No tools in this category yet.</div>
                      ) : (
                        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {tools.map((t) => (
                            <li
                              key={t.id ?? t.name}
                              className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 bg-neutral-50/60 dark:bg-neutral-950/40"
                            >
                              <div className="font-medium text-neutral-900 dark:text-neutral-100">
                                {t.name}
                              </div>
                              {t.description ? (
                                <div className="text-xs text-neutral-600 dark:text-neutral-400 mt-1 line-clamp-2">
                                  {t.description}
                                </div>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
