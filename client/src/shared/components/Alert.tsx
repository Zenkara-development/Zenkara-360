/**
 * Alert / Callout — tinted information panels.
 *
 * The audit counted ~30 hand-rolled variants of
 * `bg-{colour}-50 dark:bg-{c}-500/10 border border-{c}-100 dark:border-{c}-500/{20|30} rounded-xl p-3`
 * across seven colours and two competing dark-border opacity conventions.
 * Same idea every time: a tinted box carrying a short message.
 */

import { Info, CheckCircle2, AlertTriangle, XCircle, Sparkles, X } from 'lucide-react';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger' | 'accent' | 'neutral';

const tones: Record<AlertTone, { box: string; icon: string; defaultIcon: React.ReactNode }> = {
  info:    { box: 'bg-info-soft border-info/25 text-info-fg',       icon: 'text-info',    defaultIcon: <Info size={15} /> },
  success: { box: 'bg-success-soft border-success/25 text-success-fg', icon: 'text-success', defaultIcon: <CheckCircle2 size={15} /> },
  warning: { box: 'bg-warning-soft border-warning/30 text-warning-fg', icon: 'text-warning', defaultIcon: <AlertTriangle size={15} /> },
  danger:  { box: 'bg-danger-soft border-danger/25 text-danger-fg',  icon: 'text-danger',  defaultIcon: <XCircle size={15} /> },
  accent:  { box: 'bg-accent-soft border-accent/25 text-accent-soft-fg', icon: 'text-accent', defaultIcon: <Sparkles size={15} /> },
  neutral: { box: 'bg-surface-sunken border-line text-fg',          icon: 'text-fg-muted', defaultIcon: <Info size={15} /> },
};

export interface AlertProps {
  tone?: AlertTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  /** Pass `null` to suppress the icon entirely. */
  icon?: React.ReactNode | null;
  actions?: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
}

export function Alert({
  tone = 'info',
  title,
  children,
  icon,
  actions,
  onDismiss,
  className = '',
}: AlertProps) {
  const t = tones[tone];
  const showIcon = icon !== null;
  const node = icon ?? t.defaultIcon;

  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-card border px-3.5 py-3 text-[12.5px] leading-relaxed ${t.box} ${className}`}
    >
      {showIcon && <span className={`shrink-0 mt-px ${t.icon}`}>{node}</span>}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold mb-0.5">{title}</p>}
        {children}
      </div>
      {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 -mr-1 -mt-0.5 p-1 rounded-btn opacity-60 hover:opacity-100 transition-opacity"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

/**
 * Inline form-level error. Replaces the `text-[12.5px] text-red-600
 * dark:text-red-400` string that appeared nine times and the six-times
 * repeated red banner.
 */
export function FormError({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <p role="alert" className={`text-[12.5px] text-danger ${className}`}>
      {children}
    </p>
  );
}
