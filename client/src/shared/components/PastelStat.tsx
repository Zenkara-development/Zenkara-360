/**
 * PastelStatCard — headline number on a pastel tile with a round icon chip.
 * The shared look for top-of-page KPI rows (dashboard overview, attendance
 * totals, people counts, …). Colours come from the `.tile-*` palette in
 * index.css, which also handles dark mode.
 *
 * Two arrangements, both from the reference screens:
 *  - `solid` (default): solid colour chip, big number, label underneath.
 *  - `soft`: pale chip with a coloured icon, small uppercase label above
 *    the number.
 */

export type PastelTone = 'blue' | 'green' | 'orange' | 'purple' | 'teal' | 'pink' | 'red' | 'slate';

export function PastelStatCard({ label, value, icon: Icon, tone, onClick, variant = 'solid', className = '' }: {
  label: React.ReactNode;
  value: React.ReactNode;
  icon: React.ElementType;
  tone: PastelTone;
  /** Makes the whole card a button. */
  onClick?: () => void;
  variant?: 'solid' | 'soft';
  className?: string;
}) {
  const classes = `tile-${tone} tile-surface group flex items-center gap-4 p-4 sm:p-5 rounded-card border border-transparent text-left shadow-ui-sm ${
    onClick ? 'hover:shadow-ui-md hover:-translate-y-0.5 transition-all duration-150' : ''
  } ${className}`;
  const body = variant === 'soft' ? (
    <>
      <span className="tile-text w-12 h-12 xl:w-14 xl:h-14 rounded-full bg-surface/70 flex items-center justify-center shrink-0 shadow-ui-sm">
        <Icon size={26} />
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] font-semibold uppercase tracking-wider text-fg-muted leading-snug">{label}</span>
        <span className="block text-[28px] font-extrabold text-fg leading-tight tracking-tight tabular-nums truncate mt-0.5">{value}</span>
      </span>
    </>
  ) : (
    <>
      <span className="tile-chip w-12 h-12 rounded-full flex items-center justify-center shrink-0 shadow-ui-sm">
        <Icon size={22} />
      </span>
      <span className="min-w-0">
        <span className="block text-[26px] font-extrabold text-fg leading-none tracking-tight tabular-nums truncate">{value}</span>
        <span className="block text-[13px] font-semibold text-fg-muted mt-1.5 leading-snug line-clamp-2">{label}</span>
      </span>
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} className={classes}>{body}</button>
    : <div className={classes}>{body}</div>;
}
