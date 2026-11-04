import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { ensureFreshToken } from '../api/client';

export type SSEEventType =
  | 'ticket:created'
  | 'ticket:updated'
  | 'ticket:status'
  | 'inbox:message'
  | 'inbox:conversation'
  | 'lead:created'
  | 'deal:updated'
  | 'notification'
  | 'chat:message'
  | 'attendance:updated'
  | 'attendance:locate'
  | 'ping';

type Handler = (data: any) => void;

// ─── Global toast callback (set by NotificationBell) ─────────────────────────

let globalToastHandler: ((event: SSEEventType, data: any) => void) | null = null;
export function setSSEToastHandler(fn: typeof globalToastHandler) { globalToastHandler = fn; }

// ─── Main hook ────────────────────────────────────────────────────────────────

export function useSSE() {
  const { accessToken, isAuthenticated } = useAuth();
  const qc = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (!isAuthenticated || !accessToken) return;
    if (esRef.current) esRef.current.close();

    // Pass token as query param — EventSource doesn't support custom headers.
    // Same VITE_API_URL bug as api/client.ts: EventSource can't go through
    // the axios instance, so it needs its own base-URL resolution rather
    // than a hardcoded relative '/api' path.
    const apiBase = import.meta.env.VITE_API_URL || '/api';
    const es = new EventSource(`${apiBase}/events/stream?_t=${encodeURIComponent(accessToken)}`);
    esRef.current = es;

    const handlers: Partial<Record<SSEEventType, Handler>> = {
      'ticket:created': (data) => {
        qc.invalidateQueries({ queryKey: ['tickets'] });
        globalToastHandler?.('ticket:created', data);
      },
      'ticket:status': (data) => {
        qc.invalidateQueries({ queryKey: ['tickets'] });
        qc.invalidateQueries({ queryKey: ['ticket', data.id] });
        globalToastHandler?.('ticket:status', data);
      },
      'ticket:updated': () => {
        qc.invalidateQueries({ queryKey: ['tickets'] });
      },
      'inbox:message': (data) => {
        qc.invalidateQueries({ queryKey: ['conversations'] });
        qc.invalidateQueries({ queryKey: ['messages', data.conversationId] });
        if (data.direction === 'INBOUND') globalToastHandler?.('inbox:message', data);
      },
      'inbox:conversation': () => {
        qc.invalidateQueries({ queryKey: ['conversations'] });
      },
      'lead:created': (data) => {
        qc.invalidateQueries({ queryKey: ['leads'] });
        globalToastHandler?.('lead:created', data);
      },
      'notification': (data) => {
        qc.invalidateQueries({ queryKey: ['notifications'] });
        globalToastHandler?.('notification', data);
      },
      'chat:message': (data) => {
        qc.invalidateQueries({ queryKey: ['chat-threads'] });
        if (data.threadId) qc.invalidateQueries({ queryKey: ['chat-messages', data.threadId] });
      },
      'attendance:updated': () => {
        qc.invalidateQueries({ queryKey: ['attendance-today'] });
        qc.invalidateQueries({ queryKey: ['attendance-live'] });
      },
      // A manager asked for this user's position — the heartbeat hook listens for this and pings immediately
      'attendance:locate': (data) => {
        window.dispatchEvent(new CustomEvent('attendance:locate', { detail: data }));
      },
    };

    for (const [event, handler] of Object.entries(handlers)) {
      es.addEventListener(event, (e: MessageEvent) => {
        try { handler!(JSON.parse(e.data)); } catch {}
      });
    }

    es.onerror = () => {
      es.close();
      esRef.current = null;
      // EventSource doesn't expose the HTTP status to JS, so there's no way
      // to tell "the access token expired" apart from a network blip here —
      // rather than guessing, always try a refresh before reconnecting.
      // ensureFreshToken() shares api/client.ts's single in-flight
      // refreshPromise, so this never fires a second refresh request if one
      // triggered by some other API call is already in progress. Once it
      // resolves, AuthContext's onAccessTokenRefreshed subscription updates
      // `accessToken` in state, `connect` picks up the new dependency value,
      // and the effect below tears down and reconnects with the current
      // token — this call is what makes that happen even in a tab that's
      // otherwise idle (nothing else around to trigger a 401-driven refresh).
      // If the refresh itself fails (refresh token also expired), this
      // reconnects with the same stale token, 401s again, and retries in
      // 5s exactly as before — the interceptor's own session-expiry
      // redirect (from whichever REST call notices next) is what actually
      // ends that loop, same as it always has.
      ensureFreshToken().finally(() => {
        retryRef.current = setTimeout(connect, 5_000);
      });
    };
  }, [isAuthenticated, accessToken, qc]);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [connect]);
}
