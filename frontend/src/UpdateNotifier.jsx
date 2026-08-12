import React, { useState, useEffect } from 'react';
import { Download, RefreshCw, X, Check } from 'lucide-react';
import { APP_VERSION } from './version';

export default function UpdateNotifier() {
  const [update, setUpdate] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        const { api } = await import('./api');
        const res = await api.checkAppUpdate();
        if (res.latest_version && res.latest_version !== APP_VERSION && res.download_url) {
          setUpdate(res);
        }
      } catch {}
    };
    const timer = setTimeout(check, 3000);
    return () => clearTimeout(timer);
  }, []);

  const handleUpdate = async () => {
    if (!update?.download_url) return;
    setUpdating(true);
    setMessage('Downloading update…');
    try {
      const { api } = await import('./api');
      const res = await api.applyAppUpdate({ download_url: update.download_url });
      if (res && res.ok) {
        setDone(true);
        setMessage('App will restart shortly…');
      } else {
        setMessage(res?.error || 'Update failed');
        setUpdating(false);
      }
    } catch (e) {
      setMessage('Update failed: ' + (e.message || e));
      setUpdating(false);
    }
  };

  if (!update || dismissed) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-neutral-200 overflow-hidden">
        <div className={`px-5 py-4 flex items-center justify-between text-white ${done ? 'bg-emerald-600' : 'bg-indigo-600'}`}>
          <div className="flex items-center gap-3">
            <div className="bg-white/20 rounded-full p-1.5">
              {done ? <Check className="h-5 w-5" /> : <RefreshCw className={`h-5 w-5 ${updating ? 'animate-spin' : ''}`} />}
            </div>
            <span className="font-semibold">{done ? 'Updating…' : 'Update Available'}</span>
          </div>
          {!updating && <button onClick={() => setDismissed(true)} className="text-white/70 hover:text-white transition-colors"><X className="h-5 w-5" /></button>}
        </div>
        <div className="p-5 space-y-4">
          {done ? (
            <div className="text-center py-3">
              <p className="text-sm text-neutral-700 font-medium">Downloaded and installing v{update.latest_version}.</p>
              <p className="text-xs text-neutral-500 mt-1">The app will close and restart automatically.</p>
            </div>
          ) : (
            <>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">v{update.latest_version}</span>
                  <span className="text-xs text-neutral-400">(current: v{APP_VERSION})</span>
                </div>
                {update.release_notes && (
                  <div className="mt-2 text-xs text-neutral-600 bg-neutral-50 rounded-xl p-3 max-h-32 overflow-y-auto whitespace-pre-wrap border border-neutral-100">{update.release_notes}</div>
                )}
                {update.size > 0 && <p className="text-xs text-neutral-400 mt-2">Size: ~{Math.round(update.size / 1024 / 1024)} MB</p>}
              </div>
              <div className="flex gap-2">
                <button onClick={handleUpdate} disabled={updating} className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 text-sm transition-colors disabled:opacity-50">
                  <Download className="h-4 w-4" />{updating ? message || 'Updating…' : 'Update & Restart'}
                </button>
                <button onClick={() => setDismissed(true)} className="px-4 rounded-xl border border-neutral-200 text-neutral-500 hover:bg-neutral-50 text-sm font-medium transition-colors">Later</button>
              </div>
              {message && !done && <p className="text-xs text-rose-500 text-center">{message}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
