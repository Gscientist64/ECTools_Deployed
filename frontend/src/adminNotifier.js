// frontend/src/adminNotifier.js
import { useEffect, useRef } from "react";
import { api } from "./api";
import { useToast } from "./toasts";

/**
 * Admin Pending Request Notifier
 * - Rings immediately when an admin is logged in and there is any pending request.
 * - Snoozes: rings again every 15 minutes while pending still exists.
 * - Stops immediately when no pending requests remain.
 *
 * IMPORTANT:
 * - Browsers may block autoplay audio until user interaction. We try anyway.
 */
export function useAdminPendingRequestNotifier({
  enabled = false,
  isAdmin = false,
  pollMs = 30000,
  snoozeMs = 15 * 60 * 1000,
  soundUrl = "/notify.mp3", // put notify.mp3 in frontend/public/notify.mp3
} = {}) {
  const { push } = useToast();

  const audioRef = useRef(null);
  const pollTimerRef = useRef(null);
  const snoozeTimerRef = useRef(null);

  const lastRingAtRef = useRef(0);
  const pendingRef = useRef(false);

  // Create Audio once (no conditional hooks)
  useEffect(() => {
    if (!audioRef.current) {
      try {
        const a = new Audio(soundUrl);
        a.preload = "auto";
        audioRef.current = a;
      } catch {
        audioRef.current = null;
      }
    }
  }, [soundUrl]);

  // Helper: play ring sound (safe)
  const ring = async () => {
    lastRingAtRef.current = Date.now();

    const a = audioRef.current;
    if (!a) return;

    try {
      a.currentTime = 0;
      await a.play();
    } catch (e) {
      // Autoplay restrictions can block play() in browsers until user interaction
      // We don't crash; we just hint via toast.
      push("New pending request (sound blocked by browser until you interact).", "info");
    }
  };

  // Helper: stop snooze timer
  const clearSnooze = () => {
    if (snoozeTimerRef.current) {
      clearTimeout(snoozeTimerRef.current);
      snoozeTimerRef.current = null;
    }
  };

  // Helper: schedule snooze ring if pending persists
  const scheduleSnooze = () => {
    clearSnooze();
    snoozeTimerRef.current = setTimeout(async () => {
      // Only ring if still enabled/admin and still pending
      if (!enabled || !isAdmin) return;
      if (!pendingRef.current) return;

      await ring();
      scheduleSnooze(); // keep snoozing while pending remains
    }, snoozeMs);
  };

  // Main effect: polling + immediate ring on login if pending exists
  useEffect(() => {
    // Always clear any previous timers on re-run
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    clearSnooze();
    pendingRef.current = false;

    // Not active? nothing to do (but hooks still ran safely)
    if (!enabled || !isAdmin) return;

    let alive = true;

    const checkPending = async () => {
      try {
        const rows = await api.adminRequests("Pending");
        const hasPending = Array.isArray(rows) && rows.length > 0;

        // Transition: no pending -> pending (ring immediately)
        if (hasPending && !pendingRef.current) {
          pendingRef.current = true;
          await ring();
          scheduleSnooze();
          return;
        }

        // Still pending: ensure snooze is active (but don't ring every poll)
        if (hasPending && pendingRef.current) {
          if (!snoozeTimerRef.current) scheduleSnooze();
          return;
        }

        // No pending: stop snooze
        if (!hasPending) {
          pendingRef.current = false;
          clearSnooze();
        }
      } catch (e) {
        // Don’t spam toast; just fail silently
      }
    };

    // Run immediately (so admin login hears it if pending exists)
    checkPending();

    // Poll
    pollTimerRef.current = setInterval(() => {
      if (!alive) return;
      checkPending();
    }, pollMs);

    return () => {
      alive = false;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      clearSnooze();
    };
  }, [enabled, isAdmin, pollMs, snoozeMs]); // NOTE: no conditional hooks inside
}
