import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { addToast } from '../shared/components/toastStore';

interface PolicyLite { autoCheckoutOnLeave: boolean; autoCheckoutAfterMinutes: number; heartbeatTimeoutMinutes: number; shareLiveLocation: boolean }
interface HeartbeatOutcome {
  open: boolean;
  inside: boolean | null;
  nearestDistanceMeters: number | null;
  minutesUntilAutoCheckout: number | null;
  checkedOut?: { at: string; source: 'AUTO_GEOFENCE' | 'AUTO_TIMEOUT' };
}

const OPEN_INTERVAL_MS = 60_000;      // while checked in
const IDLE_INTERVAL_MS = 5 * 60_000;  // not checked in — just watch for a new session

/**
 * Mounted once in AppLayout. When the org uses geofence auto check-out, a
 * heartbeat timeout, or live location sharing, sends the user's location every
 * minute while they have an open attendance session, from any page in the app.
 * A manager's "Locate now" arrives as an SSE event and triggers an immediate ping. Browsers can't do
 * this in the background, so it only runs while the app is open.
 */
export function useAttendanceHeartbeat(enabled: boolean) {
  const qc = useQueryClient();
  const { data: policy } = useQuery<PolicyLite>({
    queryKey: ['attendance-policy'],
    queryFn: () => api.get('/hr/attendance/policy').then(r => r.data),
    enabled,
    staleTime: 5 * 60_000,
  });
  const active = enabled && !!policy && (policy.autoCheckoutOnLeave || policy.heartbeatTimeoutMinutes > 0 || policy.shareLiveLocation);
  const warnedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const schedule = (ms: number) => { if (!stopped) timer = setTimeout(tick, ms); };

    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === 'hidden') { schedule(OPEN_INTERVAL_MS); return; }
      let pos: GeolocationPosition;
      try {
        pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20_000, maximumAge: 30_000 }));
      } catch {
        // No permission / no fix — try again later; the server's timeout rule (if any) handles silence.
        schedule(OPEN_INTERVAL_MS); return;
      }
      try {
        const { data } = await api.post<HeartbeatOutcome>('/hr/attendance/heartbeat', {
          lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy,
        });
        if (data.checkedOut) {
          qc.invalidateQueries({ queryKey: ['attendance-me'] });
          qc.invalidateQueries({ queryKey: ['attendance-today'] });
          addToast(
            data.checkedOut.source === 'AUTO_GEOFENCE'
              ? `You were checked out automatically at ${new Date(data.checkedOut.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} because you left the office.`
              : 'You were checked out automatically after the app lost contact.',
            'info', { duration: 12_000, actionLabel: 'View', actionHref: '/hr/attendance' },
          );
          warnedRef.current = null;
          schedule(IDLE_INTERVAL_MS); return;
        }
        if (data.open && data.inside === false && data.minutesUntilAutoCheckout != null) {
          // Warn once per "outside" episode so the user can walk back or check out deliberately
          if (warnedRef.current === null) {
            warnedRef.current = Date.now();
            addToast(`You appear to be ${data.nearestDistanceMeters ?? '?'}m from the office — you'll be checked out automatically in about ${data.minutesUntilAutoCheckout} min unless you return.`, 'warning', { duration: 10_000 });
          }
        } else {
          warnedRef.current = null;
        }
        schedule(data.open ? OPEN_INTERVAL_MS : IDLE_INTERVAL_MS);
      } catch {
        schedule(OPEN_INTERVAL_MS);
      }
    };

    // Kick off promptly, and again whenever the session changes (check-in from the Attendance page)
    schedule(3_000);
    const onLocate = () => { clearTimeout(timer); schedule(200); };
    window.addEventListener('attendance:locate', onLocate);
    // Pushes relayed by the service worker (app open but backgrounded, or just re-opened from a notification)
    const onSwMessage = (e: MessageEvent) => { if (e.data?.type === 'attendance:locate') onLocate(); };
    navigator.serviceWorker?.addEventListener('message', onSwMessage);
    // Coming back to the foreground (PWA resumed, tab re-focused) → fresh fix straight away
    const onVisible = () => { if (document.visibilityState === 'visible') onLocate(); };
    document.addEventListener('visibilitychange', onVisible);
    // While backgrounded, timers are throttled but position callbacks can still
    // arrive on some platforms — forward them as pings without our own timer.
    let watchId: number | null = null;
    let lastWatchPing = 0;
    if (navigator.geolocation?.watchPosition) {
      watchId = navigator.geolocation.watchPosition(pos => {
        if (document.visibilityState === 'visible') return; // the foreground loop handles this
        const now = Date.now();
        if (now - lastWatchPing < OPEN_INTERVAL_MS) return;
        lastWatchPing = now;
        api.post('/hr/attendance/heartbeat', { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }).catch(() => {});
      }, () => {}, { enableHighAccuracy: false, maximumAge: 60_000 });
    }
    const unsubscribe = qc.getQueryCache().subscribe(evt => {
      if (evt.type === 'updated' && evt.query.queryKey[0] === 'attendance-me' && evt.action.type === 'success') {
        clearTimeout(timer); schedule(2_000);
      }
    });
    return () => {
      stopped = true; clearTimeout(timer); unsubscribe();
      window.removeEventListener('attendance:locate', onLocate);
      navigator.serviceWorker?.removeEventListener('message', onSwMessage);
      document.removeEventListener('visibilitychange', onVisible);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [active, qc]);
}
