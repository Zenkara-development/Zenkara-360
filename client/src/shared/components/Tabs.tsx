/**
 * Tabs — one component, three visual variants.
 *
 * The app had five hand-rolled tab strips that could not be told apart in
 * intent, only in styling: an underline strip (TicketsPage), a full-width
 * underline strip (InboxPage), a bordered segmented control (Deals, People,
 * Employees, Approvals, OrgStructure), a pill-in-tray (Payroll, Attendance,
 * Leave, Profile, AIStudio) and a rounded-full chip row (CustomFields, Jobs,
 * Templates). Three of them had no dark-mode branch.
 *
 * Rather than force one look everywhere, the three that carry real meaning
 * are kept as variants:
 *   • `underline` — page-level sections inside a detail view
 *   • `segmented` — a small set of mutually exclusive views (2–4 items)
 *   • `pill`      — filter chips, often many and often scrollable
 */

export interface TabItem<K extends string = string> {
  key: K;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Rendered as a count bubble after the label. */
  count?: number;
  disabled?: boolean;
}

export interface TabsProps<K extends string = string> {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  variant?: 'underline' | 'segmented' | 'pill';
  /** Stretch items to fill the available width. */
  fill?: boolean;
  className?: string;
  'aria-label'?: string;
}

export function Tabs<K extends string = string>({
  items,
  value,
  onChange,
  variant = 'segmented',
  fill = false,
  className = '',
  'aria-label': ariaLabel = 'Tabs',
}: TabsProps<K>) {
  const containers: Record<string, string> = {
    underline: 'flex gap-1 border-b border-line-subtle overflow-x-auto',
    /* Linear-style segmented control: recessed tray, floating active chip. */
    segmented: 'inline-flex items-center gap-0.5 rounded-btn border border-line-subtle bg-surface-sunken p-0.5',
    pill: 'flex gap-1.5 flex-wrap',
  };

  function itemCls(active: boolean, disabled?: boolean) {
    const base = 'relative inline-flex items-center gap-1.5 font-medium transition-all whitespace-nowrap ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-inset';
    const off = disabled ? 'opacity-40 cursor-not-allowed' : '';

    if (variant === 'underline') {
      return `${base} ${off} px-3 py-2.5 text-[13px] border-b-2 -mb-px ${
        active
          ? 'border-accent text-fg font-semibold'
          : 'border-transparent text-fg-muted hover:text-fg hover:border-line-strong'
      }`;
    }
    if (variant === 'pill') {
      /* Quiet tinted chips instead of solid accent slabs — the accent is
         reserved for actions, so an active filter reads as "selected",
         not as a button begging to be pressed. */
      return `${base} ${off} ui-tab-pill ${active ? 'is-active' : ''} px-3 py-1.5 text-[12.5px] rounded-badge border ${
        active
          ? 'bg-accent-soft text-accent-soft-fg border-accent/35 font-semibold'
          : 'bg-surface text-fg-muted border-line hover:border-line-strong hover:text-fg'
      }`;
    }
    // segmented — active chip floats on the recessed tray
    return `${base} ${off} px-3 py-1 text-[12.5px] rounded-[calc(var(--ui-btn-radius)-2px)] ${
      active
        ? 'bg-surface text-fg font-semibold shadow-ui-sm border border-line'
        : 'text-fg-muted hover:text-fg border border-transparent'
    }`;
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`${containers[variant]} ${fill ? 'w-full' : ''} ${className}`}
    >
      {items.map(t => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={t.disabled}
            onClick={() => !t.disabled && onChange(t.key)}
            className={`${itemCls(active, t.disabled)} ${fill ? 'flex-1 justify-center' : ''}`}
          >
            {t.icon}
            {t.label}
            {t.count != null && t.count > 0 && (
              <span
                className={`ml-0.5 px-1.5 min-w-[18px] text-center rounded-full text-[10px] font-semibold leading-[16px] ${
                  active
                    ? variant === 'underline'
                      ? 'bg-accent text-accent-fg'
                      : 'bg-accent/15 text-current'
                    : 'bg-surface-sunken text-fg-muted'
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
