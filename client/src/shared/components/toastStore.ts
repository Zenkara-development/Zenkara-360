// Pure TS module — no React. Can be imported by axios interceptors.

export type ToastType = 'error' | 'success' | 'warning' | 'info';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  actionLabel?: string;
  actionHref?: string;
}

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
const listeners = new Set<Listener>();

function notify() {
  const snapshot = [...toasts];
  listeners.forEach(l => l(snapshot));
}

export interface ToastOptions {
  duration?: number;
  actionLabel?: string;
  actionHref?: string;
}

export function addToast(message: string, type: ToastType = 'error', durationOrOptions: number | ToastOptions = 6000): string {
  const opts: ToastOptions = typeof durationOrOptions === 'number' ? { duration: durationOrOptions } : durationOrOptions;
  const duration = opts.duration ?? 6000;

  /* A screen that fires several requests at once can fail several times at
     once — a bulk action rejected per-row, or one click that triggers two
     mutations. Three identical stacked copies of the same sentence reads as
     the app malfunctioning rather than as one clear answer, so an identical
     message that is already on screen is reused instead of duplicated. */
  const duplicate = toasts.find(t => t.message === message && t.type === type);
  if (duplicate) return duplicate.id;

  const id = Math.random().toString(36).slice(2, 9);
  toasts = [...toasts, { id, message, type, actionLabel: opts.actionLabel, actionHref: opts.actionHref }];
  notify();
  if (duration > 0) setTimeout(() => removeToast(id), duration);
  return id;
}

export function removeToast(id: string) {
  toasts = toasts.filter(t => t.id !== id);
  notify();
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  fn([...toasts]); // emit current state immediately
  return () => listeners.delete(fn);
}
