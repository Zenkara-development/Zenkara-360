import { Sparkles, Check } from 'lucide-react';
import { useState } from 'react';

interface AISuggestionPillProps {
  suggestion: string;
  onApply: (value: string) => void;
  className?: string;
}

export function AISuggestionPill({ suggestion, onApply, className = '' }: AISuggestionPillProps) {
  const [applied, setApplied] = useState(false);

  function handleApply() {
    setApplied(true);
    onApply(suggestion);
    setTimeout(() => setApplied(false), 2000);
  }

  return (
    <button
      onClick={handleApply}
      className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-all
        ${applied
          ? 'bg-success-soft border-success/25 text-success-fg'
          : 'bg-accent-soft border-accent/25 text-accent-soft-fg hover:brightness-95 hover:shadow-ui-sm active:scale-95'
        } ${className}`}
    >
      {applied ? <Check size={11} /> : <Sparkles size={11} />}
      <span className="max-w-[200px] truncate">{suggestion}</span>
    </button>
  );
}

interface AISuggestionListProps {
  suggestions: string[];
  onApply: (value: string) => void;
  label?: string;
  className?: string;
}

export function AISuggestionList({ suggestions, onApply, label = 'AI suggestions', className = '' }: AISuggestionListProps) {
  if (!suggestions.length) return null;
  return (
    <div className={`mt-2 ${className}`}>
      <p className="text-xs text-fg-subtle mb-1.5 flex items-center gap-1">
        <Sparkles size={10} className="text-accent" /> {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((s, i) => (
          <AISuggestionPill key={i} suggestion={s} onApply={onApply} />
        ))}
      </div>
    </div>
  );
}
