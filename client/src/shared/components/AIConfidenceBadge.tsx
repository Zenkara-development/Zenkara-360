import { Sparkles } from 'lucide-react';

interface AIConfidenceBadgeProps {
  score?: number;        // 0-100
  label?: string;        // override text
  size?: 'sm' | 'md';
  className?: string;
}

export function AIConfidenceBadge({ score, label, size = 'sm', className = '' }: AIConfidenceBadgeProps) {
  const pct = score ?? 0;
  const color = pct >= 80 ? 'text-success-fg bg-success-soft border-success/25'
    : pct >= 60 ? 'text-warning-fg bg-warning-soft border-warning/25'
    : 'text-danger-fg bg-danger-soft border-danger/25';
  const text = label ?? (pct >= 80 ? 'High confidence' : pct >= 60 ? 'Medium confidence' : 'Low confidence');
  const sizeClass = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1';

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border font-medium ${color} ${sizeClass} ${className}`}>
      <Sparkles size={size === 'sm' ? 10 : 12} />
      {text}
      {score !== undefined && <span className="opacity-70">({score}%)</span>}
    </span>
  );
}

interface AIRiskBadgeProps {
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  label?: string;
  className?: string;
}

export function AIRiskBadge({ risk, label, className = '' }: AIRiskBadgeProps) {
  const styles = {
    LOW: 'text-success-fg bg-success-soft border-success/25',
    MEDIUM: 'text-warning-fg bg-warning-soft border-warning/25',
    HIGH: 'text-danger-fg bg-danger-soft border-danger/25',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border text-xs font-medium px-2 py-0.5 ${styles[risk]} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${risk === 'LOW' ? 'bg-success' : risk === 'MEDIUM' ? 'bg-warning' : 'bg-danger'}`} />
      {label ?? `${risk} Risk`}
    </span>
  );
}
