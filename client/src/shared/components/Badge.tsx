/**
 * Badge — status pills.
 *
 * Five files carried their own colour map for what is the same set of states
 * (`sentimentConfig`, `STATUS_COLOR`, `scoreColor`, `statusColor`,
 * `StatusBadge.styles`), duplicating the maps already exported here. The
 * semantic helpers at the bottom of this file are the ones to use.
 *
 * Status hues stay on the fixed Tailwind palette rather than theme tokens:
 * "red means bad" should not become "amber means bad" because someone picked
 * the Friendly theme. Only the radius follows the theme.
 */

type Variant = 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'orange' | 'indigo' | 'teal' | 'accent';

const styles: Record<Variant, string> = {
  gray:   'bg-gray-100   text-gray-700    ring-gray-200/70    dark:bg-gray-500/15   dark:text-gray-300    dark:ring-gray-400/25',
  blue:   'bg-blue-50    text-blue-700    ring-blue-200/70    dark:bg-blue-500/15   dark:text-blue-300    dark:ring-blue-400/25',
  green:  'bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25',
  yellow: 'bg-amber-50   text-amber-800   ring-amber-200/70   dark:bg-amber-500/15  dark:text-amber-300   dark:ring-amber-400/25',
  red:    'bg-red-50     text-red-700     ring-red-200/70     dark:bg-red-500/15    dark:text-red-300     dark:ring-red-400/25',
  purple: 'bg-violet-50  text-violet-700  ring-violet-200/70  dark:bg-violet-500/15 dark:text-violet-300  dark:ring-violet-400/25',
  orange: 'bg-orange-50  text-orange-700  ring-orange-200/70  dark:bg-orange-500/15 dark:text-orange-300  dark:ring-orange-400/25',
  indigo: 'bg-indigo-50  text-indigo-700  ring-indigo-200/70  dark:bg-indigo-500/15 dark:text-indigo-300  dark:ring-indigo-400/25',
  teal:   'bg-teal-50    text-teal-700    ring-teal-200/70    dark:bg-teal-500/15   dark:text-teal-300    dark:ring-teal-400/25',
  /** Follows the active theme's accent — for "current"/"selected", not status. */
  accent: 'bg-accent-soft text-accent-soft-fg ring-accent/25',
};

const dots: Record<Variant, string> = {
  gray:   'bg-gray-400',
  blue:   'bg-blue-500',
  green:  'bg-emerald-500',
  yellow: 'bg-amber-500',
  red:    'bg-red-500',
  purple: 'bg-violet-500',
  orange: 'bg-orange-500',
  indigo: 'bg-indigo-500',
  teal:   'bg-teal-500',
  accent: 'bg-accent',
};

export interface BadgeProps {
  children: React.ReactNode;
  variant?: Variant;
  dot?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export function Badge({ children, variant = 'gray', dot = false, size = 'md', className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'badge inline-flex items-center gap-1.5 ring-1 ring-inset rounded-badge font-medium',
        size === 'sm' ? 'px-1.5 py-0 text-[10.5px]' : 'px-2 py-0.5 text-[11.5px]',
        styles[variant],
        className,
      ].join(' ')}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dots[variant]}`} />}
      {children}
    </span>
  );
}

/**
 * Renders an enum value as a badge with sensible defaults: looks up the
 * variant, and turns SCREAMING_SNAKE_CASE into "Screaming snake case".
 */
export function StatusBadge({
  value,
  map,
  fallback = 'gray',
  dot,
  size,
  className,
}: {
  value?: string | null;
  map?: Record<string, Variant>;
  fallback?: Variant;
  dot?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  if (!value) return null;
  const variant = map?.[value] ?? fallback;
  return (
    <Badge variant={variant} dot={dot} size={size} className={className}>
      {humanise(value)}
    </Badge>
  );
}

export function humanise(value: string): string {
  const s = value.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Semantic maps ──────────────────────────────────────────────────────
export const leadStatusVariant: Record<string, Variant> = {
  NEW: 'blue', CONTACTED: 'yellow', QUALIFIED: 'green', UNQUALIFIED: 'red', CONVERTED: 'purple',
};
export const dealStatusVariant: Record<string, Variant> = {
  OPEN: 'blue', WON: 'green', LOST: 'red',
};
export const ticketStatusVariant: Record<string, Variant> = {
  OPEN: 'blue', IN_PROGRESS: 'yellow', PENDING: 'orange', RESOLVED: 'green', CLOSED: 'gray',
};
export const priorityVariant: Record<string, Variant> = {
  LOW: 'gray', MEDIUM: 'blue', HIGH: 'orange', CRITICAL: 'red',
};
export const articleStatusVariant: Record<string, Variant> = {
  DRAFT: 'gray', PUBLISHED: 'green', ARCHIVED: 'yellow',
};
export const invoiceStatusVariant: Record<string, Variant> = {
  DRAFT: 'gray', SENT: 'blue', PAID: 'green', OVERDUE: 'red', CANCELLED: 'gray', VOID: 'gray',
};
export const approvalStatusVariant: Record<string, Variant> = {
  PENDING: 'yellow', APPROVED: 'green', REJECTED: 'red', CANCELLED: 'gray', EXPIRED: 'orange',
};
