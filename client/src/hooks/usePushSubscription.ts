import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

// Real browser/OS push notifications (Push API) — separate from the
// in-app-only SSE + polling system in useSSE.ts/NotificationBell.tsx, which
// only reaches a user while a tab is open. See server/src/utils/webPush.ts
// for what sends these and client/src/sw.ts for the service worker that
// receives them.

export type PushPermission = 'unsupported' | 'default' | 'granted' | 'denied';

const isSupported =
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/**
 * VAPID public keys are base64url; pushManager.subscribe() wants a raw
 * BufferSource. Returned as a plain ArrayBuffer (rather than a Uint8Array)
 * since newer TS/lib.dom typings make Uint8Array generic over its backing
 * buffer (defaulting to the too-loose ArrayBufferLike, which SharedArrayBuffer
 * also satisfies) and applicationServerKey specifically wants an
 * ArrayBufferView<ArrayBuffer> — an ArrayBuffer itself sidesteps the
 * mismatch entirely.
 */
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output.buffer;
}

export function usePushSubscription() {
  const [status, setStatus] = useState<PushPermission>(() =>
    isSupported ? (Notification.permission as PushPermission) : 'unsupported',
  );
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reflects whether *this* browser already has an active push
  // subscription — distinct from permission, since permission can be
  // granted with no subscription yet registered (e.g. right after the
  // service worker first installs).
  useEffect(() => {
    if (!isSupported) return;
    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => setSubscribed(!!sub))
      .catch(() => {});
  }, []);

  const subscribe = useCallback(async () => {
    if (!isSupported) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      setStatus(permission as PushPermission);
      if (permission !== 'granted') return;

      const { data } = await api.get('/push/vapid-public-key');
      const registration = await navigator.serviceWorker.ready;
      let sub = await registration.pushManager.getSubscription();
      if (!sub) {
        sub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(data.publicKey),
        });
      }
      const json = sub.toJSON();
      await api.post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
      setSubscribed(true);
    } catch (err) {
      // Most likely: VAPID not configured on the server (404 from
      // /push/vapid-public-key) or the user dismissed the permission
      // prompt — either way, fail quietly rather than surfacing a toast for
      // an opt-in feature.
      console.error('[push] subscribe failed:', err);
    } finally {
      setBusy(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    if (!isSupported) return;
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await api.post('/push/unsubscribe', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (err) {
      console.error('[push] unsubscribe failed:', err);
    } finally {
      setBusy(false);
    }
  }, []);

  return { isSupported, status, subscribed, busy, subscribe, unsubscribe };
}
