/**
 * IconButton — a square, icon-only control.
 *
 * The audit found ~40 of these hand-rolled across the app, most of them
 * variations on `p-1.5 rounded-lg text-gray-400 hover:text-{brand|indigo|
 * violet|red}-600 transition-colors dark:…`. Two files even contained the
 * same rendering written with the `dark:` classes in a different order, so
 * they did not dedupe in a grep.
 *
 * An icon-only control needs an accessible name, so `label` is required and
 * becomes both `aria-label` and the native tooltip.
 */

import { forwardRef } from 'react';

type Tone = 'default' | 'accent' | 'danger' | 'success';
type Size = 'xs' | 'sm' | 'md';

const tones: Record<Tone, string> = {
  default: 'text-fg-subtle hover:text-fg hover:bg-surface-hover',
  accent:  'text-fg-subtle hover:text-accent hover:bg-accent-soft',
  danger:  'text-fg-subtle hover:text-danger hover:bg-danger-soft',
  success: 'text-fg-subtle hover:text-success hover:bg-success-soft',
};

const sizes: Record<Size, string> = {
  xs: 'w-6 h-6',
  sm: 'w-7 h-7',
  md: 'w-8 h-8',
};

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Required: an icon-only button is unusable by screen reader without it. */
  label: string;
  icon: React.ReactNode;
  tone?: Tone;
  size?: Size;
  /** Fade in only when the containing `.group` is hovered — for row actions. */
  revealOnRowHover?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, tone = 'default', size = 'sm', revealOnRowHover, className = '', ...props }, ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={[
        'inline-flex items-center justify-center shrink-0 rounded-btn transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent',
        sizes[size],
        tones[tone],
        revealOnRowHover ? 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      {icon}
    </button>
  );
});
