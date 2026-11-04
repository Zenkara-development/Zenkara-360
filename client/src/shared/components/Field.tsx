/**
 * Form primitives.
 *
 * Before this file the app had five parallel input systems: the `.ui-input`
 * CSS class (201 uses), a legacy `.inp` alias, a `field` Tailwind const
 * copy-pasted into five module files, an `inputCls` const in PlatformAdminPage,
 * and ~35 fully hand-rolled `border border-gray-200 … rounded-lg px-2 py-1.5`
 * inputs. They rendered at three different heights and two different radii.
 *
 * `.ui-input` won — it was already the most used and the only theme-aware one.
 * These components wrap it so that labels, hints, errors and required markers
 * are consistent too, and so density follows the theme tokens.
 */

import { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';

type Size = 'sm' | 'md';

const sizeCls: Record<Size, string> = {
  // `.ui-input` already supplies padding/type from --ui-ctl-*; sm just tightens it.
  sm: 'text-[12.5px] !py-1.5',
  md: '',
};

/* ── Label ─────────────────────────────────────────────────────────── */

export function Label({
  children,
  required,
  htmlFor,
  className = '',
}: {
  children: React.ReactNode;
  required?: boolean;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={`form-label ${className}`}>
      {children}
      {required && <span className="req" aria-hidden="true">*</span>}
    </label>
  );
}

/* ── Field wrapper ─────────────────────────────────────────────────── */

export interface FieldProps {
  label?: React.ReactNode;
  required?: boolean;
  /** Validation message. Takes precedence over `hint` when both are set. */
  error?: string | null;
  hint?: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}

export function Field({ label, required, error, hint, htmlFor, className = '', children }: FieldProps) {
  return (
    <div className={`form-field ${className}`}>
      {label && <Label htmlFor={htmlFor} required={required}>{label}</Label>}
      {children}
      {error
        ? <p className="form-hint error" role="alert">{error}</p>
        : hint ? <p className="form-hint">{hint}</p> : null}
    </div>
  );
}

/* ── Input ─────────────────────────────────────────────────────────── */

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  inputSize?: Size;
  invalid?: boolean;
  /** Rendered inside the field on the left; padding is adjusted automatically. */
  icon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { inputSize = 'md', invalid, icon, className = '', ...props }, ref,
) {
  const input = (
    <input
      ref={ref}
      {...props}
      aria-invalid={invalid || undefined}
      className={[
        'ui-input',
        sizeCls[inputSize],
        icon ? 'pl-9' : '',
        invalid ? '!border-danger focus:!border-danger' : '',
        className,
      ].filter(Boolean).join(' ')}
    />
  );

  if (!icon) return input;
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none flex items-center">
        {icon}
      </span>
      {input}
    </div>
  );
});

/* ── Textarea ──────────────────────────────────────────────────────── */

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className = '', rows = 3, ...props }, ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      {...props}
      aria-invalid={invalid || undefined}
      className={[
        'ui-input resize-y',
        invalid ? '!border-danger focus:!border-danger' : '',
        className,
      ].filter(Boolean).join(' ')}
    />
  );
});

/* ── Select ────────────────────────────────────────────────────────── */

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  selectSize?: Size;
  invalid?: boolean;
  /** Convenience: pass options instead of children. */
  options?: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { selectSize = 'md', invalid, options, placeholder, className = '', children, ...props }, ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        {...props}
        aria-invalid={invalid || undefined}
        className={[
          // appearance-none + our own chevron, so the control looks the same
          // in Safari, Firefox and Chrome rather than three different ways.
          'ui-input appearance-none pr-9',
          sizeCls[selectSize],
          invalid ? '!border-danger focus:!border-danger' : '',
          className,
        ].filter(Boolean).join(' ')}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options?.map(o => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
        {children}
      </select>
      <ChevronDown
        size={14}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none"
      />
    </div>
  );
});

/* ── Checkbox / Toggle ─────────────────────────────────────────────── */

export function Checkbox({
  label,
  hint,
  className = '',
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label?: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className={`flex items-start gap-2.5 cursor-pointer select-none ${className}`}>
      <input
        type="checkbox"
        {...props}
        className="mt-0.5 w-4 h-4 rounded-[4px] border-line-strong shrink-0 cursor-pointer"
      />
      {(label || hint) && (
        <span className="min-w-0">
          {label && <span className="block text-[13px] text-fg leading-snug">{label}</span>}
          {hint && <span className="block text-[11.5px] text-fg-muted mt-0.5 leading-relaxed">{hint}</span>}
        </span>
      )}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
  className = '',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: React.ReactNode;
  hint?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={`flex items-start justify-between gap-4 ${disabled ? 'opacity-50' : 'cursor-pointer'} ${className}`}>
      {(label || hint) && (
        <span className="min-w-0">
          {label && <span className="block text-[13px] font-medium text-fg leading-snug">{label}</span>}
          {hint && <span className="block text-[11.5px] text-fg-muted mt-0.5 leading-relaxed">{hint}</span>}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === 'string' ? label : 'Toggle'}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={[
          'relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-2',
          checked ? 'bg-accent' : 'bg-line-strong',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        ].join(' ')}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  );
}

/* ── Layout helpers ────────────────────────────────────────────────── */

/** Responsive form grid. `grid grid-cols-2 gap-4` appeared 13 times and broke on mobile. */
export function FormGrid({
  cols = 2,
  children,
  className = '',
}: {
  cols?: 1 | 2 | 3;
  children: React.ReactNode;
  className?: string;
}) {
  const map = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3' } as const;
  return <div className={`grid grid-cols-1 ${map[cols]} gap-4 ${className}`}>{children}</div>;
}

/** Right-aligned action row for form footers. */
export function FormActions({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex items-center justify-end gap-2.5 pt-1 ${className}`}>{children}</div>;
}
