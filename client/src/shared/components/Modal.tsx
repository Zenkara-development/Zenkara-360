import { X } from 'lucide-react';
import { useEffect } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizes: Record<string, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export function Modal({
  open, onClose, title, subtitle, icon, children, footer, size = 'md',
}: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (open) { document.body.style.overflow = 'hidden'; }
    else       { document.body.style.overflow = ''; }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      aria-modal="true"
      role="dialog"
      aria-labelledby="modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 animate-fade-in"
        style={{
          background: 'var(--ui-backdrop-color, rgba(15,23,42,0.45))',
          backdropFilter: 'blur(var(--ui-backdrop-blur, 8px))',
          WebkitBackdropFilter: 'blur(var(--ui-backdrop-blur, 8px))',
        }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`relative w-full sm:mx-4 ${sizes[size]} max-h-[92vh] sm:max-h-[88vh] flex flex-col animate-scale-in`}
        style={{
          background:   'rgb(var(--ui-modal-bg))',
          borderRadius: 'var(--ui-modal-radius, 18px)',
          boxShadow:    'var(--ui-shadow-modal)',
          border:       '1px solid var(--ui-modal-border, rgba(0,0,0,0.06))',
        }}
      >
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-line-strong" />
        </div>

        {/* Theme accent bar */}
        <div className="modal-accent-bar shrink-0" aria-hidden="true" />

        {/* Header */}
        <div
          className="flex items-start gap-3 px-6 py-4 shrink-0"
          style={{
            background:   'rgb(var(--ui-modal-header-bg))',
            borderBottom: '1px solid var(--ui-modal-header-border, rgba(0,0,0,0.06))',
          }}
        >
          {icon && (
            <div className="shrink-0 w-9 h-9 rounded-card bg-accent-soft border border-accent/20 flex items-center justify-center text-accent-soft-fg mt-0.5">
              {icon}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2
              id="modal-title"
              className="text-[15px] font-semibold text-fg leading-snug tracking-tight"
            >
              {title}
            </h2>
            {subtitle && (
              <p className="text-[13px] text-fg-muted mt-0.5 leading-relaxed">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 ml-1 -mt-0.5 w-8 h-8 flex items-center justify-center rounded-btn text-fg-subtle hover:text-fg hover:bg-surface-hover transition-all"
            aria-label="Close"
          >
            <X size={16} strokeWidth={2.25} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            className="px-6 py-4 shrink-0 flex items-center justify-end gap-2.5"
            style={{
              borderTop:    '1px solid var(--ui-modal-header-border, rgba(0,0,0,0.06))',
              background:   'var(--ui-modal-footer-bg, rgba(248,250,252,0.8))',
              borderRadius: '0 0 var(--ui-modal-radius, 18px) var(--ui-modal-radius, 18px)',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
