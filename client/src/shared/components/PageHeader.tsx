/**
 * PageHeader, and the page-level layout helpers that go with it.
 *
 * `<main>` in AppLayout is a bare scroll container with no padding, so every
 * page invented its own — `p-6`, `p-4 sm:p-6`, `px-6 py-5`, or none at all.
 * `PageBody` makes that one decision in one place.
 */

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  breadcrumb?: string;
  /** Tabs or filters pinned directly beneath the title. */
  below?: React.ReactNode;
  /** Lucide icon component shown beside the title, in the accent colour. */
  icon?: React.ElementType;
}

export function PageHeader({ title, subtitle, actions, breadcrumb, below, icon: Icon }: PageHeaderProps) {
  return (
    <div className="page-header px-card py-4 border-b border-line-subtle bg-surface/90 backdrop-blur-sm sticky top-0 z-20">
      {breadcrumb && (
        <p className="text-[11px] font-semibold text-fg-subtle uppercase tracking-widest mb-1.5">
          {breadcrumb}
        </p>
      )}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex items-center gap-3.5">
          {Icon && <Icon size={40} strokeWidth={1.9} className="page-header-icon shrink-0 text-accent" aria-hidden="true" />}
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold text-fg leading-tight tracking-tight truncate">
              {title}
            </h1>
            {subtitle && (
              <p className="text-[13px] text-fg-muted mt-0.5 leading-relaxed">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
      {below && <div className="mt-3.5">{below}</div>}
    </div>
  );
}

/**
 * Standard page content wrapper: consistent padding, vertical rhythm and a
 * readable maximum width.
 */
export function PageBody({
  children,
  width = 'wide',
  className = '',
}: {
  children: React.ReactNode;
  /** `narrow` suits settings and forms; `wide` suits tables and dashboards. */
  width?: 'narrow' | 'wide' | 'full';
  className?: string;
}) {
  const widths = {
    narrow: 'max-w-3xl',
    wide: 'max-w-[1400px]',
    full: '',
  } as const;

  return (
    <div className={`p-card space-y-section ${widths[width]} ${width !== 'full' ? 'mx-auto' : ''} ${className}`}>
      {children}
    </div>
  );
}

/**
 * A filter/action bar that sits above a table or list. Wraps sanely on
 * mobile instead of overflowing, which several hand-rolled versions did.
 */
export function Toolbar({
  children,
  right,
  className = '',
}: {
  children?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">{children}</div>
      {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
    </div>
  );
}

/** Small heading for a group of content inside a page. */
export function SectionHeader({
  title,
  subtitle,
  actions,
  className = '',
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-end justify-between gap-3 flex-wrap ${className}`}>
      <div className="min-w-0">
        <h2 className="text-[14px] font-semibold text-fg tracking-tight">{title}</h2>
        {subtitle && <p className="text-[12px] text-fg-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
