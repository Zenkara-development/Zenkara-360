import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tag as TagIcon, Plus, X, Check, Search } from 'lucide-react';
import {
  useRecordTags, useTags, useAttachTag, useDetachTag,
  type TagEntityType, type RecordTag,
} from '../../api/tags';
import { useAnchoredPopover, popoverStyle } from './useAnchoredPopover';
import { Spinner } from './index';
import { useAuth } from '../../contexts/AuthContext';
import { can } from '../permissions';

/**
 * The tag strip for a record — chips plus an inline picker.
 *
 * Drop it under any record's title:
 *
 *     <RecordTags entityType="DEAL" entityId={deal.id} />
 *
 * Design notes:
 *
 * - The picker is a portal-rendered popover, like SearchableSelect, because
 *   record headers frequently sit inside modals and scroll containers with
 *   `overflow: hidden`. An absolutely-positioned list gets clipped there.
 * - Typing a name that does not match anything offers "Create <name>". The
 *   server does the find-or-create, so two people coining the same tag at the
 *   same moment end up on one tag rather than two.
 * - Chips are removable inline. Removing a tag from a record does not delete
 *   the tag itself — that only happens from the tag manager, which shows how
 *   many records would be affected.
 */

export interface RecordTagsProps {
  entityType: TagEntityType;
  entityId: string;
  /** Read-only strip: renders chips with no add button and no remove. */
  readOnly?: boolean;
  /** Render nothing at all when the record has no tags (and readOnly). */
  hideWhenEmpty?: boolean;
  className?: string;
}

/** Chip colours come from the tag itself, so they are inline styles, not
 *  Tailwind classes — the palette is user-defined per org. */
function chipStyle(color: string): React.CSSProperties {
  return {
    // 18%/38% alpha over the tag's own hue reads correctly on both the light
    // and dark canvases without needing two stored colours per tag.
    backgroundColor: `${color}2E`,
    borderColor: `${color}61`,
    color,
  };
}

export function RecordTags({
  entityType,
  entityId,
  readOnly = false,
  hideWhenEmpty = false,
  className = '',
}: RecordTagsProps) {
  /* Both /tags and /tags/record/* are ALL_STAFF on the server, and this strip
     sits on record views an EMPLOYEE can legitimately open (their own ticket).
     They can neither read nor attach tags, so the strip asks for nothing and
     renders nothing for them. */
  const { user } = useAuth();
  const canReadTags = can.readStaffRecords(user?.role);
  const { data: applied = [], isLoading } = useRecordTags(entityType, entityId, { enabled: canReadTags });
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Only fetched once the picker is opened. React Query dedupes on the key,
  // so several strips on one page still make a single request.
  const { data: library } = useTags(undefined, { enabled: open && canReadTags });
  const attach = useAttachTag(entityType, entityId);
  const detach = useDetachTag(entityType, entityId);

  const { triggerRef, panelRef, position } = useAnchoredPopover<HTMLButtonElement>(open, {
    width: 260, align: 'left', estimatedHeight: 300,
  });

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 0);
    else { setSearch(''); setError(''); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, panelRef, triggerRef]);

  const appliedIds = new Set(applied.map((t: RecordTag) => t.id));
  const term = search.trim().toLowerCase();
  const options = (library?.data ?? []).filter(t => !term || t.name.toLowerCase().includes(term));
  // Only offer to create when nothing in the library matches exactly.
  const canCreate = !!term && !(library?.data ?? []).some(t => t.name.toLowerCase() === term);

  async function add(body: { tagId?: string; name?: string }) {
    setError('');
    try {
      await attach.mutateAsync(body);
      setSearch('');
      searchRef.current?.focus();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not add that tag.');
    }
  }

  async function remove(tagId: string) {
    setError('');
    try {
      await detach.mutateAsync(tagId);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not remove that tag.');
    }
  }

  if (!canReadTags) return null;
  if (isLoading) return <Spinner compact />;
  if (hideWhenEmpty && applied.length === 0 && readOnly) return null;

  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className}`}>
      {applied.length === 0 && readOnly && (
        <span className="text-[11px] text-fg-subtle">No tags</span>
      )}

      {applied.map((t: RecordTag) => (
        <span
          key={t.id}
          style={chipStyle(t.color)}
          className="group inline-flex items-center gap-1 rounded-badge border px-2 py-0.5 text-[11.5px] font-medium leading-5 max-w-[200px]"
        >
          <span className="truncate">{t.name}</span>
          {!readOnly && (
            <button
              type="button"
              onClick={() => remove(t.id)}
              aria-label={`Remove tag ${t.name}`}
              title={`Remove ${t.name}`}
              className="opacity-50 hover:opacity-100 transition-opacity shrink-0"
            >
              <X size={11} />
            </button>
          )}
        </span>
      ))}

      {!readOnly && (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-label="Add a tag"
          aria-expanded={open}
          className="inline-flex items-center gap-1 rounded-badge border border-dashed border-line-strong px-2 py-0.5 text-[11.5px] leading-5 text-fg-muted hover:text-fg hover:border-accent transition-colors"
        >
          {applied.length === 0
            ? <><TagIcon size={11} /> Add tag</>
            : <><Plus size={11} /> Tag</>}
        </button>
      )}

      {error && <span className="text-[11px] text-danger">{error}</span>}

      {open && position && createPortal(
        <div ref={panelRef} style={popoverStyle(position)} className="z-[400] ui-popover">
          <div className="p-2 border-b border-line-subtle">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface-sunken rounded-lg border border-line-subtle focus-within:border-brand-300 focus-within:ring-2 focus-within:ring-brand-100 dark:focus-within:ring-brand-500/20 transition-all">
              <Search size={12} className="text-fg-subtle flex-shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  // Enter takes the first match, or coins the typed name.
                  const first = options.find(o => !appliedIds.has(o.id));
                  if (first) add({ tagId: first.id });
                  else if (canCreate) add({ name: search.trim() });
                }}
                placeholder="Find or create a tag…"
                className="text-sm bg-transparent outline-none flex-1 text-fg placeholder:text-fg-subtle min-w-0"
              />
            </div>
          </div>

          <div className="max-h-52 overflow-y-auto py-1">
            {options.length === 0 && !canCreate && (
              <p className="px-3 py-3 text-xs text-fg-subtle text-center">
                {library ? 'No tags yet — type a name to create one.' : 'Loading…'}
              </p>
            )}

            {options.map(t => {
              const on = appliedIds.has(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => (on ? remove(t.id) : add({ tagId: t.id }))}
                  className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-surface-hover transition-colors"
                >
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                  <span className="flex-1 truncate text-fg">{t.name}</span>
                  {t.usageCount > 0 && <span className="text-[11px] text-fg-subtle">{t.usageCount}</span>}
                  {on && <Check size={12} className="text-accent shrink-0" />}
                </button>
              );
            })}

            {canCreate && (
              <button
                type="button"
                onClick={() => add({ name: search.trim() })}
                className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-surface-hover transition-colors border-t border-line-subtle"
              >
                <Plus size={12} className="text-fg-subtle shrink-0" />
                <span className="text-fg truncate">Create “{search.trim()}”</span>
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
