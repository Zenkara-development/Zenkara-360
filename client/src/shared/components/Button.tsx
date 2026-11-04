/**
 * Button.
 *
 * Roughly 200 raw `<button>` elements across the app collapsed into these six
 * variants. The divergences they carried were almost entirely accidental:
 * `font-medium` vs `font-semibold`, `rounded-lg` vs `rounded-xl`,
 * `disabled:opacity-40` vs `disabled:opacity-50`, and seven different padding
 * combinations for what was meant to be the same primary action.
 *
 * Heights and colours come from theme tokens rather than fixed pixels, so
 * Classic really is denser and Friendly really is airier — previously the
 * hardcoded `h-[34px]` meant every theme produced an identical button.
 */

import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline' | 'subtle';
type Size = 'xs' | 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center font-medium whitespace-nowrap ' +
  'transition-all duration-150 rounded-btn ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-1 ' +
  'focus-visible:ring-offset-surface ' +
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 select-none';

const variants: Record<Variant, string> = {
  /* Linear-style primary: flat accent with an inset top sheen and a
     slightly darker 1px edge — reads as a physical key, not a flat slab. */
  primary:
    'bg-accent text-accent-fg border border-accent-active/50 ' +
    'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14),0_1px_2px_rgba(16,17,20,0.10)] ' +
    'hover:bg-accent-hover active:bg-accent-active active:shadow-none active:scale-[0.985]',
  secondary:
    'bg-surface text-fg border border-line shadow-ui-sm ' +
    'hover:bg-surface-hover hover:border-line-strong active:scale-[0.985]',
  danger:
    'bg-danger text-white border border-black/10 ' +
    'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12),0_1px_2px_rgba(16,17,20,0.10)] ' +
    'hover:brightness-110 active:brightness-95 active:scale-[0.985]',
  ghost:
    'text-fg-muted hover:bg-surface-hover hover:text-fg active:scale-[0.985]',
  outline:
    'border border-accent/40 text-accent ' +
    'hover:bg-accent-soft hover:border-accent active:scale-[0.985]',
  /** Tinted, low-emphasis. Replaces the ad-hoc `bg-green-50 text-green-700` action chips. */
  subtle:
    'bg-accent-soft text-accent-soft-fg hover:brightness-95 active:scale-[0.985]',
};

/* Horizontal padding and type scale stay fixed; height follows the theme so a
   row of buttons still lines up with inputs of the same size. */
const sizes: Record<Size, string> = {
  xs: 'px-2.5 text-[11.5px] gap-1   h-ctl-xs',
  sm: 'px-3   text-[12.5px] gap-1.5 h-ctl-sm',
  md: 'px-3.5 text-[13px]   gap-1.5 h-ctl-md',
  lg: 'px-4   text-[13.5px] gap-2   h-ctl-lg',
};

const spinnerSize: Record<Size, number> = { xs: 11, sm: 12, md: 13, lg: 14 };

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  /** Stretch to the container width. */
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading,
    icon,
    iconRight,
    block,
    children,
    disabled,
    type = 'button',
    className = '',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        base,
        variants[variant],
        sizes[size],
        block ? 'w-full' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      {loading
        ? <Loader2 size={spinnerSize[size]} className="animate-spin shrink-0" />
        : icon && <span className="shrink-0 inline-flex">{icon}</span>}
      {children}
      {iconRight && !loading && <span className="shrink-0 inline-flex">{iconRight}</span>}
    </button>
  );
});
