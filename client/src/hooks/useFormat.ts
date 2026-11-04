import { useOrgSettings } from '../api/org';
import { formatCurrency, formatDate, formatDateTime, formatTime, currencySymbol } from '../utils/format';

/**
 * The one-stop hook for org-aware formatting — wraps useOrgSettings() so
 * call sites don't each need their own query + "what if it hasn't loaded
 * yet" fallback. Defaults to USD/UTC while the org settings query is still
 * in flight (its own staleTime is generous, so in practice this only ever
 * shows briefly on a hard page reload) rather than showing nothing.
 */
export function useFormat() {
  const { data: org } = useOrgSettings();
  const currency = org?.currency || 'USD';
  const timezone = org?.timezone || 'UTC';

  return {
    currency,
    timezone,
    symbol: currencySymbol(currency),
    money: (value: number | string | null | undefined) => formatCurrency(value, currency),
    date: (value: string | number | Date | null | undefined) => formatDate(value, timezone),
    dateTime: (value: string | number | Date | null | undefined) => formatDateTime(value, timezone),
    time: (value: string | number | Date | null | undefined) => formatTime(value, timezone),
  };
}
