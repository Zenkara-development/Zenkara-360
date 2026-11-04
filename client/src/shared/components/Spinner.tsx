import { Loader2 } from 'lucide-react';

export function Spinner({
  label = 'Loading…',
  compact = false,
}: {
  label?: string | null;
  compact?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center text-fg-subtle ${compact ? 'py-8 gap-2' : 'py-20 gap-3'}`}
    >
      <Loader2 size={compact ? 20 : 28} className="animate-spin" />
      {label && <p className="text-[13px]">{label}</p>}
    </div>
  );
}

/** Inline spinner for buttons and tight spaces. */
export function InlineSpinner({ size = 13, className = '' }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={`animate-spin shrink-0 ${className}`} aria-hidden="true" />;
}
