import { useEffect, useState } from 'react';
import { X, AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';
import { subscribe, removeToast, Toast } from './toastStore';

const CONFIG: Record<Toast['type'], { icon: React.ReactNode; bg: string; bar: string }> = {
  error:   { icon: <AlertCircle size={17} />,   bg: 'bg-red-50 border-red-200 text-red-800 dark:bg-red-500/10 dark:border-red-800/50 dark:text-red-300',     bar: 'bg-red-400' },
  success: { icon: <CheckCircle size={17} />,   bg: 'bg-green-50 border-green-200 text-green-800 dark:bg-green-500/10 dark:border-green-800/50 dark:text-green-300', bar: 'bg-green-400' },
  warning: { icon: <AlertTriangle size={17} />, bg: 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-500/10 dark:border-amber-800/50 dark:text-amber-300', bar: 'bg-amber-400' },
  info:    { icon: <Info size={17} />,           bg: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-500/10 dark:border-blue-800/50 dark:text-blue-300',   bar: 'bg-blue-400' },
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => subscribe(setToasts), []);

  if (!toasts.length) return null;

  return (
    <div role="region" aria-label="Notifications" aria-live="polite" className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 w-96 max-w-[calc(100vw-2rem)] pointer-events-none">
      {toasts.map(t => {
        const { icon, bg, bar } = CONFIG[t.type];
        return (
          <div
            key={t.id}
            className={`flex items-start gap-3 p-3 rounded-card border shadow-ui-lg pointer-events-auto overflow-hidden relative animate-slide-in ${bg}`}
          >
            {/* colour bar on left */}
            <span className={`absolute left-0 top-0 bottom-0 w-1 ${bar}`} />
            <span className="shrink-0 mt-0.5 ml-2">{icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm leading-snug">{t.message}</p>
              {t.actionHref && (
                <a href={t.actionHref} className="inline-block mt-1 text-sm font-semibold underline underline-offset-2 hover:opacity-80">
                  {t.actionLabel || 'View'}
                </a>
              )}
            </div>
            <button
              onClick={() => removeToast(t.id)}
              className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
