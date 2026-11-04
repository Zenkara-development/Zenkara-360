/**
 * Avatar — initials bubble.
 *
 * Previously written inline at least a dozen times in three different
 * palettes (brand-100/brand-600, indigo-50/indigo-600, and a deterministic
 * hash colour), at five sizes, and one of them was missing its dark variant
 * entirely so it rendered near-white text on near-white in dark mode.
 */

type Size = 'xs' | 'sm' | 'md' | 'lg';

const sizes: Record<Size, string> = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-[11.5px]',
  md: 'w-10 h-10 text-[13px]',
  lg: 'w-14 h-14 text-[17px]',
};

/* Deterministic tint so the same person keeps the same colour across screens.
   All six pairs are token-based, so they follow the theme and stay legible in
   both colour modes. */
const palette = [
  'bg-accent-soft text-accent-soft-fg',
  'bg-info-soft text-info-fg',
  'bg-success-soft text-success-fg',
  'bg-warning-soft text-warning-fg',
  'bg-danger-soft text-danger-fg',
  'bg-surface-sunken text-fg-muted',
];

function hashIndex(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % palette.length;
}

export function initialsOf(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export interface AvatarProps {
  name?: string | null;
  src?: string | null;
  size?: Size;
  /** Fixed tint instead of the name-derived one. */
  tone?: 'accent' | 'auto';
  className?: string;
}

export function Avatar({ name, src, size = 'sm', tone = 'auto', className = '' }: AvatarProps) {
  const label = name || 'Unknown';

  if (src) {
    return (
      <img
        src={src}
        alt={label}
        className={`${sizes[size]} rounded-full object-cover shrink-0 ring-1 ring-line ${className}`}
      />
    );
  }

  const colour = tone === 'accent' ? palette[0] : palette[hashIndex(label)];

  return (
    <span
      title={label}
      aria-label={label}
      className={`${sizes[size]} ${colour} rounded-full flex items-center justify-center font-semibold shrink-0 select-none ${className}`}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Overlapping stack, e.g. team members on a card. */
export function AvatarGroup({
  names,
  max = 4,
  size = 'xs',
  className = '',
}: {
  names: (string | null | undefined)[];
  max?: number;
  size?: Size;
  className?: string;
}) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <div className={`flex items-center ${className}`}>
      {shown.map((n, i) => (
        <Avatar
          key={`${n}-${i}`}
          name={n}
          size={size}
          className={i === 0 ? 'ring-2 ring-surface' : '-ml-2 ring-2 ring-surface'}
        />
      ))}
      {extra > 0 && (
        <span
          className={`${sizes[size]} -ml-2 rounded-full ring-2 ring-surface bg-surface-sunken text-fg-muted flex items-center justify-center font-semibold shrink-0`}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}
