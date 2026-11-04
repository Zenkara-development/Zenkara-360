import { Button } from './Button';

export interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
  /** Tighter version for use inside a card or a table body. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  compact = false,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center px-4 text-center ${
        compact ? 'py-10 gap-3' : 'py-20 gap-5'
      } ${className}`}
    >
      <div
        className={`${
          compact ? 'w-11 h-11' : 'w-16 h-16'
        } flex items-center justify-center text-fg-subtle bg-surface-sunken border border-line-subtle rounded-card`}
      >
        <span className={compact ? '[&>svg]:w-5 [&>svg]:h-5' : '[&>svg]:w-7 [&>svg]:h-7'}>{icon}</span>
      </div>
      <div className="max-w-[300px]">
        <p className={`font-semibold text-fg tracking-tight ${compact ? 'text-[13px]' : 'text-[14px]'}`}>
          {title}
        </p>
        {description && (
          <p className="text-[13px] text-fg-muted mt-1.5 leading-relaxed">{description}</p>
        )}
      </div>
      {(action || secondaryAction) && (
        <div className="flex items-center gap-2">
          {action && <Button size="sm" onClick={action.onClick}>{action.label}</Button>}
          {secondaryAction && (
            <Button size="sm" variant="secondary" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
