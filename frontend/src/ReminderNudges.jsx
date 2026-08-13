import { useEffect } from 'react';
import { api } from './api';
import { useToast } from './toasts';

// Shows smart nudges to facility users: deliveries to confirm + low-stock tools.
// Appears shortly after login and re-checks periodically.
export default function ReminderNudges({ isAdmin }) {
  const { push } = useToast();

  useEffect(() => {
    if (isAdmin) return undefined;
    let cancelled = false;

    const nudge = async () => {
      try {
        const res = await api.reminders();
        if (cancelled || !res) return;
        if (res.pending_deliveries > 0) {
          push(`📦 You have ${res.pending_deliveries} delivery to confirm`, 'info');
        }
        if (Array.isArray(res.low_stock) && res.low_stock.length > 0) {
          const names = res.low_stock.slice(0, 3).map(t => t.name).join(', ');
          const more = res.low_stock.length > 3 ? ` +${res.low_stock.length - 3} more` : '';
          push(`⚠️ Low stock: ${names}${more} — consider making a request`, 'info');
        }
      } catch { /* ignore */ }
    };

    const t = setTimeout(nudge, 1200);
    const iv = setInterval(nudge, 30 * 60 * 1000); // re-nudge every 30 min
    return () => { cancelled = true; clearTimeout(t); clearInterval(iv); };
  }, [isAdmin, push]);

  return null;
}
