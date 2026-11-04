import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPopover, popoverStyle } from './useAnchoredPopover';
import { Bell, BellRing, BellOff, X, Ticket, MessageSquare, Target, CheckCircle } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useSSE, setSSEToastHandler, type SSEEventType } from '../../hooks/useSSE';
import { usePushSubscription } from '../../hooks/usePushSubscription';
import { useFormat } from '../../hooks/useFormat';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

interface Toast {
  id: string;
  event: SSEEventType;
  data: any;
  ts: number;
}

// ─── Toast icons ──────────────────────────────────────────────────────────────

function toastContent(event: SSEEventType, data: any): { icon: React.ReactNode; text: string } {
  switch (event) {
    case 'ticket:created': return { icon: <Ticket size={14} className="text-accent" />, text: `New ticket: ${data.title}` };
    case 'ticket:status':  return { icon: <CheckCircle size={14} className="text-success" />, text: `Ticket "${data.title}" → ${data.status}` };
    case 'inbox:message':  return { icon: <MessageSquare size={14} className="text-cyan-500" />, text: `New inbound message` };
    case 'lead:created':   return { icon: <Target size={14} className="text-violet-500" />, text: `New lead created` };
    default:               return { icon: <Bell size={14} className="text-fg-subtle" />, text: 'New notification' };
  }
}

// ─── Toast Stack ──────────────────────────────────────────────────────────────

function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => {
        const { icon, text } = toastContent(t.event, t.data);
        return (
          <div key={t.id}
            className="pointer-events-auto flex items-center gap-3 ui-popover px-4 py-3 min-w-[260px] max-w-sm animate-slide-in">
            <div className="flex-shrink-0">{icon}</div>
            <p className="text-sm text-fg flex-1">{text}</p>
            <button onClick={() => onDismiss(t.id)} className="text-fg-subtle hover:text-fg-muted flex-shrink-0 transition-colors">
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Notification Bell ────────────────────────────────────────────────────────

export function NotificationBell() {
  const { time } = useFormat();
  // Start SSE connection for this component tree
  useSSE();
  const push = usePushSubscription();

  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  /* Portaled: this 320px panel hangs off the top bar, which lives inside the
     shell's `overflow-hidden` wrapper, so on a narrow screen it was clipped
     rather than shown. */
  const { triggerRef, panelRef: floatRef, position } = useAnchoredPopover<HTMLButtonElement>(open, {
    width: 320, align: 'right', estimatedHeight: 420,
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: notifications = [] } = useQuery<Notification[]>({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then(r => r.data?.data ?? r.data ?? []),
    refetchInterval: 60_000,
  });

  const unread = notifications.filter(n => !n.readAt).length;

  // Register toast handler once
  useEffect(() => {
    setSSEToastHandler((event, data) => {
      const id = Math.random().toString(36).slice(2);
      setToasts(prev => [...prev.slice(-3), { id, event, data, ts: Date.now() }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5_000);
    });
    return () => setSSEToastHandler(null);
  }, []);

  // Close panel when clicking outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (floatRef.current?.contains(t)) return;
      setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function markAllRead() {
    try {
      await api.post('/notifications/read-all');
      qc.invalidateQueries({ queryKey: ['notifications'] });
    } catch {}
  }

  async function markRead(id: string) {
    try {
      await api.patch(`/notifications/${id}/read`);
      qc.invalidateQueries({ queryKey: ['notifications'] });
    } catch {}
  }

  function notifIcon(type: string) {
    if (type?.includes('TICKET')) return <Ticket size={13} className="text-accent" />;
    if (type?.includes('INBOX') || type?.includes('MESSAGE')) return <MessageSquare size={13} className="text-cyan-500" />;
    if (type?.includes('LEAD')) return <Target size={13} className="text-violet-500" />;
    return <Bell size={13} className="text-fg-subtle" />;
  }

  return (
    <>
      <div className="relative" ref={panelRef}>
        <button ref={triggerRef} onClick={() => setOpen(o => !o)}
          className="relative p-2 text-fg-muted hover:text-fg hover:bg-surface-hover rounded-md transition-colors">
          <Bell size={18} />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-danger text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>

        {open && position && (
          createPortal(
          <div ref={floatRef} style={popoverStyle(position!)} className="ui-popover z-[400] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-line-subtle">
              <h3 className="text-sm font-semibold text-fg">Notifications</h3>
              <div className="flex items-center gap-3">
                {push.isSupported && (
                  <button
                    onClick={() => (push.subscribed ? push.unsubscribe() : push.subscribe())}
                    disabled={push.busy || push.status === 'denied'}
                    title={
                      push.status === 'denied'
                        ? 'Notifications blocked in your browser settings'
                        : push.subscribed
                        ? 'Turn off desktop push notifications'
                        : 'Get desktop push notifications, even when this tab is closed'
                    }
                    className="flex items-center gap-1 text-xs text-fg-subtle hover:text-fg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {push.subscribed ? <BellRing size={13} className="text-accent" /> : <BellOff size={13} />}
                    {push.subscribed ? 'Push on' : push.status === 'denied' ? 'Push blocked' : 'Enable push'}
                  </button>
                )}
                {unread > 0 && (
                  <button onClick={markAllRead} className="text-xs text-accent hover:text-accent-hover font-medium">
                    Mark all read
                  </button>
                )}
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-line-subtle">
              {notifications.length === 0 ? (
                <div className="text-center py-8">
                  <Bell size={28} className="text-fg-subtle/40 mx-auto mb-2" />
                  <p className="text-xs text-fg-subtle">No notifications yet</p>
                </div>
              ) : (
                notifications.slice(0, 20).map(n => (
                  <button key={n.id} onClick={() => markRead(n.id)}
                    className={`w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-surface-hover transition-colors ${!n.readAt ? 'bg-accent-soft/40' : ''}`}>
                    <div className="mt-0.5 flex-shrink-0">{notifIcon(n.type)}</div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium truncate ${!n.readAt ? 'text-fg' : 'text-fg-muted'}`}>{n.title}</p>
                      {n.body && <p className="text-xs text-fg-subtle mt-0.5 line-clamp-2">{n.body}</p>}
                      <p className="text-xs text-fg-subtle mt-1">{time(n.createdAt)}</p>
                    </div>
                    {!n.readAt && <span className="w-1.5 h-1.5 bg-accent rounded-full mt-1.5 flex-shrink-0" />}
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
          )
        )}
      </div>

      <ToastStack toasts={toasts} onDismiss={id => setToasts(prev => prev.filter(t => t.id !== id))} />
    </>
  );
}
