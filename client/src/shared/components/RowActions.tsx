import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

export interface RowAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  /** 'danger' renders the item in red */
  variant?: 'default' | 'danger';
  /** When true the item is not shown (useful for conditional actions) */
  hidden?: boolean;
}

interface Props {
  items: RowAction[];
  /** aria-label for the trigger button (default: "Row actions") */
  triggerLabel?: string;
}

const MENU_WIDTH = 192; // w-48

export function RowActions({ items, triggerLabel = 'Row actions' }: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const visible = items.filter(i => !i.hidden);

  // The menu is rendered in a portal (see below) so it can never be clipped
  // or visually trapped by an ancestor's `overflow-hidden`/stacking context
  // (e.g. the app's scrollable main content area) — previously an
  // absolutely-positioned menu nested inside such an ancestor could render
  // underneath the fixed sidebar and swallow clicks meant for its items.
  // Position it relative to the trigger button's live viewport coordinates,
  // clamped so it never runs off the left/right edge of the screen.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    setCoords({ top: rect.bottom + 4, left });
  }, [open]);

  // Close on outside click (trigger button OR the portaled menu)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Close on scroll/resize rather than trying to track the trigger's
  // position live — simpler and avoids the menu drifting from its anchor.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (visible.length === 0) return null;

  return (
    <div className="relative flex-shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label={triggerLabel}
        title="Actions"
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        className="p-1.5 rounded-md text-fg-subtle hover:text-fg hover:bg-surface-hover transition-colors"
      >
        <MoreHorizontal size={15} />
      </button>

      {open && coords && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: MENU_WIDTH }}
          className="z-[300] ui-popover py-1 overflow-hidden"
        >
          {visible.map((item, i) => (
            <button
              key={i}
              type="button"
              aria-label={item.label}
              title={item.label}
              onClick={e => { e.stopPropagation(); item.onClick(); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
                item.variant === 'danger'
                  ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10'
                  : 'text-fg hover:bg-surface-hover'
              }`}
            >
              {item.icon && <span className="flex-shrink-0">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
