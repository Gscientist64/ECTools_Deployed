import React, { useState, useEffect } from 'react';
import { Download, RefreshCw, X, Check, AlertTriangle } from 'lucide-react';
import { APP_VERSION } from './version';

export default function UpdateNotifier() {
  const [update, setUpdate] = useState(null);
  const [justUpdated, setJustUpdated] = useState(null); // version shown in the post-restart success banner
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const [percent, setPercent] = useState(0);
  const [status, setStatus] = useState('idle'); // idle | downloading | installing | restarting | success | error

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const { api } = await import('./api');
        // One-shot "update succeeded" confirmation from the restarted app.
        const st = await api.appUpdateStatus();
        if (st && st.updated_to && st.updated_to === APP_VERSION) {
          setJustUpdated(st.updated_to);
          setTimeout(() => setJustUpdated(null), 10000); // auto-dismiss
          return;
        }
        const res = await api.checkAppUpdate();
        if (res.latest_version && res.latest_version !== APP_VERSION && res.download_url) {
          setUpdate(res);
        }
      } catch {}
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  const dismissSuccess = () => setJustUpdated(null);

  const handleUpdate = async () => {
    if (!update?.download_url) return;
    setUpdating(true);
    setStatus('downloading');
    setMessage('Preparing update…');
    setPercent(0);
    try {
      const { api } = await import('./api');
      const res = await api.applyAppUpdate({
        download_url: update.download_url,
        version: update.latest_version,
      });
      if (!res || !res.ok) {
        setStatus('error');
        setMessage(res?.error || 'Update failed');
        setUpdating(false);
        return;
      }
      pollProgress();
    } catch (e) {
      setStatus('error');
      setMessage('Update failed: ' + (e.message || e));
      setUpdating(false);
    }
  };

  const pollProgress = async () => {
    const { api } = await import('./api');
    const tick = async () => {
      let p;
      try {
        p = await api.updateProgress();
      } catch (e) {
        // Server unreachable — the app was killed to restart. Confirm via marker.
        confirmRestart();
        return;
      }
      setPercent(p.percent ?? 0);
      setStatus(p.status || 'downloading');
      if (p.message) setMessage(p.message);
      if (p.status === 'error') {
        setStatus('error');
        setMessage(p.message || 'Update failed');
        setUpdating(false);
        return;
      }
      if (p.status === 'restarting') {
        // Download + install complete; the bat is replacing the exe now.
        setStatus('restarting');
        setMessage('Update Successful — the app is restarting…');
        return;
      }
      setTimeout(tick, 250);
    };
    const confirmRestart = async () => {
      // Wait for the server (new exe) to come back and verify via the marker.
      const start = Date.now();
      const iv = setInterval(async () => {
        try {
          const st = await api.appUpdateStatus();
          clearInterval(iv);
          if (st && st.updated_to === APP_VERSION) {
            setStatus('success');
            setMessage('Update Successful');
          } else {
            setStatus('error');
            setMessage('The update did not complete. Please close and reopen the app.');
            setUpdating(false);
          }
        } catch (e2) {
          if (Date.now() - start > 45000) {
            clearInterval(iv);
            setStatus('error');
            setMessage('The update did not complete. Please close and reopen the app.');
            setUpdating(false);
          }
        }
      }, 1000);
    };
    tick();
  };

  // One-shot success banner shown right after the app restarts onto the new version.
  if (justUpdated) {
    return (
      <div className="fixed bottom-6 right-6 z-[100] w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-2xl border border-emerald-200 overflow-hidden">
          <div className="bg-emerald-600 px-4 py-3 flex items-center gap-3 text-white">
            <div className="bg-white/20 rounded-full p-1.5"><Check className="h-5 w-5" /></div>
            <span className="font-semibold">Update Successful</span>
            <button onClick={dismissSuccess} className="ml-auto text-white/70 hover:text-white transition-colors"><X className="h-4 w-4" /></button>
          </div>
          <div className="px-4 py-4">
            <p className="text-sm text-neutral-800 font-medium">
              You're now on <span className="font-bold text-emerald-600">v{justUpdated}</span>.
            </p>
            <p className="text-xs text-neutral-500 mt-1">The latest version has been installed.</p>
            <button onClick={dismissSuccess} className="mt-3 w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 text-sm transition-colors">
              Great!
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!update || dismissed) return null;

  const showBar = updating && (status === 'downloading' || status === 'installing');
  const success = status === 'restarting' || status === 'success';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-neutral-200 overflow-hidden">
        <div className={`px-5 py-4 flex items-center justify-between text-white ${success ? 'bg-emerald-600' : status === 'error' ? 'bg-rose-600' : 'bg-indigo-600'}`}>
          <div className="flex items-center gap-3">
            <div className="bg-white/20 rounded-full p-1.5">
              {success
                ? <Check className="h-5 w-5" />
                : status === 'error'
                  ? <AlertTriangle className="h-5 w-5" />
                  : <RefreshCw className={`h-5 w-5 ${updating ? 'animate-spin' : ''}`} />}
            </div>
            <span className="font-semibold">
              {success ? 'Update Successful'
                : status === 'error' ? 'Update Failed'
                : 'Update Available'}
            </span>
          </div>
          {!updating && !success && (
            <button onClick={() => setDismissed(true)} className="text-white/70 hover:text-white transition-colors"><X className="h-5 w-5" /></button>
          )}
        </div>
        <div className="p-5 space-y-4">
          {success ? (
            <div className="text-center py-3">
              <div className="mx-auto h-14 w-14 rounded-full bg-emerald-100 grid place-items-center mb-3">
                <Check className="h-8 w-8 text-emerald-600" strokeWidth={3} />
              </div>
              <p className="text-base font-bold text-neutral-900">Update Successful</p>
              <p className="text-sm text-neutral-600 mt-1">v{update.latest_version} has been installed.</p>
              <p className="text-xs text-neutral-500 mt-1">
                {status === 'restarting' ? 'The app will close and restart automatically…' : ''}
              </p>
            </div>
          ) : status === 'error' ? (
            <div className="text-center py-3">
              <p className="text-sm text-neutral-700 font-medium">{message}</p>
              <p className="text-xs text-neutral-500 mt-2 leading-relaxed">
                The update could not be completed. Close the app and reopen it. If it still asks to update,
                download the latest version from the release page.
              </p>
              <button onClick={() => setDismissed(true)} className="mt-3 w-full rounded-xl border border-neutral-300 text-neutral-600 hover:bg-neutral-50 font-semibold py-2.5 text-sm transition-colors">
                Close
              </button>
            </div>
          ) : (
            <>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">v{update.latest_version}</span>
                  <span className="text-xs text-neutral-400">(current: v{APP_VERSION})</span>
                </div>
                {update.release_notes && !showBar && (
                  <div className="mt-2 text-xs text-neutral-600 bg-neutral-50 rounded-xl p-3 max-h-32 overflow-y-auto whitespace-pre-wrap border border-neutral-100">{update.release_notes}</div>
                )}
                {update.size > 0 && !showBar && <p className="text-xs text-neutral-400 mt-2">Size: ~{Math.round(update.size / 1024 / 1024)} MB</p>}
              </div>

              {showBar && (
                <div className="space-y-2">
                  <div className="w-full bg-neutral-200 rounded-full h-3 overflow-hidden">
                    <div className="bg-indigo-600 h-3 rounded-full transition-all duration-200 ease-out" style={{ width: `${percent}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-neutral-500">
                    <span>{message}</span>
                    <span className="font-mono font-semibold">{percent}%</span>
                  </div>
                </div>
              )}

              {!showBar && (
                <div className="flex gap-2">
                  <button onClick={handleUpdate} disabled={updating} className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 text-sm transition-colors disabled:opacity-50">
                    <Download className="h-4 w-4" />{updating ? message || 'Updating…' : 'Update & Restart'}
                  </button>
                  <button onClick={() => setDismissed(true)} className="px-4 rounded-xl border border-neutral-200 text-neutral-500 hover:bg-neutral-50 text-sm font-medium transition-colors">Later</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
