import { Search, X } from 'lucide-react';

export interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  'aria-label'?: string;
}

/**
 * Search field. Now built on `.ui-input` rather than its own hardcoded
 * border/radius/ring, which is why it used to be the one control in the app
 * that ignored the theme's input styling entirely.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className = '',
  autoFocus,
  'aria-label': ariaLabel,
}: SearchInputProps) {
  return (
    <div className={`relative ${className}`}>
      <Search
        size={14}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none"
      />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        aria-label={ariaLabel ?? placeholder}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="ui-input pl-9 pr-8 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg transition-colors"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
