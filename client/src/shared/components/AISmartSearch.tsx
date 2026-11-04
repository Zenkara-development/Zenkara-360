import { useState, useCallback, useRef } from 'react';
import { Search, Sparkles, X, Loader2, User, Ticket, TrendingUp, Handshake, BookOpen, Monitor, Receipt } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useDebounce } from '../../hooks/useDebounce';
import { useFormat } from '../../hooks/useFormat';
import { AiInfo } from './AiInfo';

interface SearchResult {
  id: string;
  type: 'contact' | 'ticket' | 'lead' | 'deal' | 'article' | 'asset' | 'invoice';
  title: string;
  subtitle?: string;
  url: string;
}

const ICONS: Record<string, any> = {
  contact: User,
  ticket: Ticket,
  lead: TrendingUp,
  deal: Handshake,
  article: BookOpen,
  asset: Monitor,
  invoice: Receipt,
};

const TYPE_COLORS: Record<string, string> = {
  contact: 'text-blue-500 bg-blue-50 dark:bg-blue-500/10',
  ticket: 'text-orange-500 bg-orange-50 dark:bg-orange-500/10',
  lead: 'text-purple-500 bg-purple-50 dark:bg-purple-500/10',
  deal: 'text-green-500 bg-green-50 dark:bg-green-500/10',
  article: 'text-teal-500 bg-teal-50 dark:bg-teal-500/10',
  asset: 'text-slate-500 bg-slate-50 dark:bg-slate-500/10',
  invoice: 'text-pink-500 bg-pink-50 dark:bg-pink-500/10',
};

function useSearch(query: string) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  // Whether the last response actually came back through the AI query
  // interpreter (server/src/utils/ai.ts's interpretSearchQuery) or fell back
  // to plain substring matching — search.controller.ts reports this
  // honestly rather than the "Smart search" label always claiming AI
  // regardless of whether a GROQ/OPENAI key is even configured.
  const [aiPowered, setAiPowered] = useState(false);
  // A failed request used to be indistinguishable from "no matches" — the
  // dropdown just came up empty. Keep the failure so the UI can say so.
  const [failed, setFailed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const { money } = useFormat();

  const search = useCallback(async (q: string) => {
    if (!q.trim() || q.length < 2) { setResults([]); setFailed(false); return; }
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setFailed(false);
    try {
      // Use the shared, pre-configured `api` client (correct baseURL, and the
      // 'accessToken' key AuthContext actually stores — this previously read
      // a nonexistent 'crm_token' key via a standalone axios call, so every
      // request went out unauthenticated, silently 401'd, and the dropdown
      // never had results to show.
      const { data } = await api.get(
        `/search?q=${encodeURIComponent(q)}&limit=8`,
        { signal: abortRef.current.signal }
      );
      // Normalize to SearchResult array
      const mapped: SearchResult[] = [
        ...(data.contacts ?? []).map((c: any) => ({ id: c.id, type: 'contact', title: c.name, subtitle: c.email, url: `/crm/contacts/${c.id}` })),
        ...(data.tickets ?? []).map((t: any) => ({ id: t.id, type: 'ticket', title: t.title, subtitle: t.status, url: `/itdesk/tickets/${t.id}` })),
        ...(data.leads ?? []).map((l: any) => ({ id: l.id, type: 'lead', title: l.contact?.name ?? l.id, subtitle: l.status, url: `/crm/leads` })),
        ...(data.deals ?? []).map((d: any) => ({ id: d.id, type: 'deal', title: d.title, subtitle: money(Number(d.value ?? 0)), url: `/crm/deals` })),
        ...(data.articles ?? []).map((a: any) => ({ id: a.id, type: 'article', title: a.title, subtitle: 'Knowledge base', url: `/itdesk/articles` })),
        ...(data.assets ?? []).map((a: any) => ({ id: a.id, type: 'asset', title: a.name, subtitle: a.serialNumber ?? a.type, url: `/itdesk/assets` })),
        ...(data.invoices ?? []).map((i: any) => ({ id: i.id, type: 'invoice', title: `${i.invoiceNumber} — ${i.title}`, subtitle: i.status, url: `/invoices` })),
      ].slice(0, 8);
      setResults(mapped);
      setAiPowered(!!data.aiPowered);
    } catch (e: any) {
      if (e?.code !== 'ERR_CANCELED') { setResults([]); setFailed(true); }
    } finally {
      setLoading(false);
    }
  }, [money]);

  const debouncedQuery = useDebounce(query, 300);
  useState(() => { search(debouncedQuery); });

  return { results, loading, aiPowered, failed, search };
}

interface AISmartSearchProps {
  placeholder?: string;
  className?: string;
}

export function AISmartSearch({ placeholder = 'Find contacts, tickets, deals…', className = '' }: AISmartSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { results, loading, aiPowered, failed, search } = useSearch(query);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    setOpen(true);
    search(v);
  }

  function handleSelect(r: SearchResult) {
    setQuery('');
    setOpen(false);
    navigate(r.url);
  }

  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none" />
        {loading && <Loader2 size={13} className="absolute right-8 top-1/2 -translate-y-1/2 text-accent animate-spin" />}
        {query && (
          <button onClick={() => { setQuery(''); setOpen(false); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg-muted transition-colors">
            <X size={14} />
          </button>
        )}
        <input
          value={query}
          onChange={handleChange}
          onFocus={() => query && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder={placeholder}
          className="w-full h-8 pl-9 pr-8 text-[13px] text-fg placeholder:text-fg-subtle bg-surface-sunken rounded-btn border border-transparent hover:border-line focus:border-accent/50 focus:bg-surface focus:!shadow-[0_0_0_3px_var(--ui-input-ring)] focus:outline-none transition-all"
        />
      </div>

      {/* overflow is visible so the ⓘ explanation popover isn't clipped by the
          dropdown; the result list keeps its own scroll clipping. */}
      {open && (results.length > 0 || failed) && (
        <div className="absolute top-full mt-1.5 w-full min-w-[320px] ui-popover z-50 animate-scale-in">
          <div
            className="px-3 py-2 border-b border-line-subtle flex items-center gap-1.5"
            // Keep focus in the input so opening the explanation doesn't blur
            // the field and close the dropdown out from under the popover.
            onMouseDown={e => e.preventDefault()}
          >
            {aiPowered
              ? <Sparkles size={11} className="text-accent" />
              : <Search size={11} className="text-fg-subtle" />}
            {/* Honest label: only claims "AI search" when the request actually
                went through interpretSearchQuery() server-side (a GROQ/OPENAI
                key is configured) — otherwise says what it is, a keyword match. */}
            <span className="text-xs text-fg-subtle">{aiPowered ? 'AI search results' : 'Search results'}</span>
            <AiInfo id="search.interpret" />
          </div>

          {failed ? (
            <p className="px-3 py-3 text-xs text-fg-muted">
              Search failed — check your connection and try again.
            </p>
          ) : (
            <ul className="py-1 max-h-72 overflow-y-auto">
              {results.map(r => {
                const Icon = ICONS[r.type];
                const colorClass = TYPE_COLORS[r.type];
                return (
                  <li key={`${r.type}-${r.id}`}>
                    <button
                      onMouseDown={() => handleSelect(r)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-hover transition-colors"
                    >
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${colorClass}`}>
                        <Icon size={13} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-fg truncate">{r.title}</p>
                        {r.subtitle && <p className="text-xs text-fg-muted truncate">{r.subtitle}</p>}
                      </div>
                      <span className="text-xs text-fg-subtle capitalize flex-shrink-0">{r.type}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
