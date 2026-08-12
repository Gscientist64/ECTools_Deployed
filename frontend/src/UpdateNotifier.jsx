import React, { useState, useEffect } from 'react';
import { Download, RefreshCw, X, Check } from 'lucide-react';

const CURRENT_VERSION = '1.0.0';

export default function UpdateNotifier() {
  const [update, setUpdate] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [upToDate, setUpToDate] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        const { api } = await import('./api');
        const res = await api.checkAppUpdate();
        if (res.latest_version && res.latest_version !== CURRENT_VERSION && res.download_url) {
          setUpdate(res);
        }
      } catch {}
    };
    const timer = setTimeout(check, 3000);
    return () => clearTimeout(timer);
  }, []);

  const handleUpdate = async () => {
    if (!update?.download_url) return;
    setDownloading(true);
    // Open download in default browser — GitHub blocks CORS on release assets
    window.open(update.download_url, '_blank');
    setTimeout(() => {
      setProgress(100);
      setUpToDate(true);
    }, 800);
  };

  if (!update || dismissed) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-neutral-200 overflow-hidden">
        <div className={`px-5 py-4 flex items-center justify-between text-white ${upToDate ? 'bg-emerald-600' : 'bg-indigo-600'}`}>
          <div className="flex items-center gap-3">
            <div className="bg-white/20 rounded-full p-1.5">
              {upToDate ? <Check className="h-5 w-5" /> : <RefreshCw className="h-5 w-5 animate-spin" />}
            </div>
            <span className="font-semibold">{upToDate ? 'Download Complete!' : 'Update Available'}</span>
          </div>
          {!downloading && <button onClick={() => setDismissed(true)} className="text-white/70 hover:text-white transition-colors"><X className="h-5 w-5" /></button>}
        </div>
        <div className="p-5 space-y-4">
          {upToDate ? (
            <div className="text-center py-3">
              <p className="text-sm text-neutral-700 font-medium">Setup file: <span className="text-indigo-600">TIMS_Setup_v{update.latest_version}.exe</span></p>
              <p className="text-xs text-neutral-500 mt-1">Close this app and run the downloaded setup to install.</p>
              <button onClick={() => setDismissed(true)} className="mt-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-6 py-2.5 text-sm transition-colors">I'll Update Later</button>
            </div>
          ) : downloading ? (
            <div className="space-y-3 py-3">
              <p className="text-sm text-neutral-600 text-center">Downloading update&hellip;</p>
              <div className="w-full bg-neutral-200 rounded-full h-3 overflow-hidden">
                <div className="bg-indigo-600 h-3 rounded-full transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-neutral-400 text-center font-mono">{progress}%</p>
            </div>
          ) : (
            <>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">v{update.latest_version}</span>
                  <span className="text-xs text-neutral-400">(current: v{CURRENT_VERSION})</span>
                </div>
                {update.release_notes && (
                  <div className="mt-2 text-xs text-neutral-600 bg-neutral-50 rounded-xl p-3 max-h-32 overflow-y-auto whitespace-pre-wrap border border-neutral-100">{update.release_notes}</div>
                )}
                {update.size > 0 && <p className="text-xs text-neutral-400 mt-2">Size: ~{Math.round(update.size / 1024 / 1024)} MB</p>}
              </div>
              <div className="flex gap-2">
                <button onClick={handleUpdate} className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 text-sm transition-colors">
                  <Download className="h-4 w-4" />Download & Update
                </button>
                <button onClick={() => setDismissed(true)} className="px-4 rounded-xl border border-neutral-200 text-neutral-500 hover:bg-neutral-50 text-sm font-medium transition-colors">Later</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
