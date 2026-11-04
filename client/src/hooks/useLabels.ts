import { useLabelOverrides } from '../api/aiStudio';

export type LabelEntityKey = 'ticket' | 'deal' | 'lead' | 'contact';

/**
 * Reads the org's AI-generated (or hand-edited) label overrides and exposes
 * two small lookup helpers. Always falls back to the given default when no
 * override exists — every call site works exactly as before for orgs that
 * haven't set anything up, so adopting this is a pure additive change, not
 * a rewrite of existing copy.
 *
 * `useLabelOverrides()` hits a dedicated ALL_STAFF endpoint (not the
 * MANAGERS-only /studio/context) since every staff member needs to see
 * relabeled terminology, not just whoever configured it — see
 * getLabelOverrides in aiStudio.controller.ts for why that split exists.
 */
export function useLabels() {
  const { data } = useLabelOverrides();
  const overrides = data?.labelOverrides;

  /** e.g. entityLabel('ticket', 'plural', 'Tickets') -> "Cases" if overridden */
  function entityLabel(key: LabelEntityKey, form: 'singular' | 'plural', fallback: string): string {
    return overrides?.entities?.[key]?.[form] || fallback;
  }

  /** e.g. fieldLabel('deal', 'value', 'Value') -> "Premium" if overridden */
  function fieldLabel(key: LabelEntityKey, fieldKey: string, fallback: string): string {
    return overrides?.fields?.[key]?.[fieldKey] || fallback;
  }

  return { entityLabel, fieldLabel };
}
