/**
 * Org-specific currency/time-zone formatting. Every $ amount and date/time
 * in the app should go through these rather than a bare `.toLocaleString()`
 * or a hardcoded `$${value}` template, both of which silently assumed USD
 * and the viewer's own browser time zone regardless of what org they're in.
 * Stored dates stay UTC in Postgres either way — this only ever affects
 * display formatting, never what's persisted.
 *
 * Prefer the useFormat() hook (hooks/useFormat.ts) over calling these
 * directly — it already knows the current org's currency/timezone, so call
 * sites don't each need their own useOrgSettings() + fallback boilerplate.
 * These are exported directly for the few places (PDF generation, printable
 * pages) that already have an explicit currency/timezone value in hand and
 * don't want the extra query.
 */

export function formatCurrency(value: number | string | null | undefined, currency = 'USD'): string {
  const n = Number(value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(safe);
  } catch {
    // An org setting that somehow isn't a currency Intl recognizes
    // shouldn't take the whole page down — fall back to a plain number
    // prefixed with the code instead of a formatted symbol.
    return `${currency} ${safe.toLocaleString()}`;
  }
}

/** Just the currency symbol/prefix (e.g. "$", "€", "₹") — for the rare
 *  layout that builds its own structure around a bare number rather than
 *  calling formatCurrency for the whole string. Prefer formatCurrency. */
export function currencySymbol(currency = 'USD'): string {
  try {
    const parts = new Intl.NumberFormat(undefined, { style: 'currency', currency }).formatToParts(0);
    return parts.find(p => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "UTC+5:30" / "UTC-8" / "UTC" for the given zone at the given instant —
 *  computed from the zone itself so it's correct for zones with DST
 *  (e.g. America/New_York is UTC-5 in winter, UTC-4 in summer) rather than
 *  a fixed offset that would go stale half the year. Used to suffix every
 *  time-of-day value so it's never ambiguous which zone a time is in,
 *  on top of the value actually being converted into that zone below. */
function utcOffsetLabel(timezone: string, at: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' }).formatToParts(at);
    const raw = parts.find(p => p.type === 'timeZoneName')?.value ?? '';
    return raw.replace(/^GMT/, 'UTC') || 'UTC';
  } catch {
    return '';
  }
}

// Every date/time below is a genuine conversion, not a label swap: passing
// `timeZone: timezone` to Intl.DateTimeFormat computes the actual wall-clock
// date/time in that zone from the stored UTC instant (the stored value never
// changes — only what's rendered here does). formatDateTime/formatTime also
// append the UTC offset so a displayed time is self-describing regardless of
// which org's zone the viewer happens to be looking at.

export function formatDate(value: string | number | Date | null | undefined, timezone = 'UTC'): string {
  const d = toDate(value);
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: timezone, year: 'numeric', month: 'short', day: 'numeric' }).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

export function formatDateTime(value: string | number | Date | null | undefined, timezone = 'UTC'): string {
  const d = toDate(value);
  if (!d) return '—';
  try {
    const base = new Intl.DateTimeFormat(undefined, {
      timeZone: timezone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(d);
    const offset = utcOffsetLabel(timezone, d);
    return offset ? `${base} (${offset})` : base;
  } catch {
    return d.toLocaleString();
  }
}

export function formatTime(value: string | number | Date | null | undefined, timezone = 'UTC'): string {
  const d = toDate(value);
  if (!d) return '—';
  try {
    const base = new Intl.DateTimeFormat(undefined, { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(d);
    const offset = utcOffsetLabel(timezone, d);
    return offset ? `${base} (${offset})` : base;
  } catch {
    return d.toLocaleTimeString();
  }
}
