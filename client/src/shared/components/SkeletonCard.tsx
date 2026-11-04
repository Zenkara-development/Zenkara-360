export interface SkeletonCardProps {
  lines?: number;
  className?: string;
}

export function SkeletonCard({ lines = 3, className = '' }: SkeletonCardProps) {
  return (
    <div className={`rounded-card border border-line bg-surface p-card space-y-3 ${className}`}>
      <div className="skeleton h-4 w-2/3" />
      {Array.from({ length: Math.max(0, lines - 1) }).map((_, i) => (
        <div key={i} className={`skeleton h-3 ${i === lines - 2 ? 'w-1/2' : 'w-full'}`} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      <div className="skeleton h-10 w-full rounded-card" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-14 w-full rounded-card" style={{ opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  );
}

/** Grid of stat-tile placeholders, for dashboard headers. */
export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton h-[68px] w-full rounded-card" />
      ))}
    </div>
  );
}
