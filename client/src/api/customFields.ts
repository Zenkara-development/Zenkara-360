import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export interface CustomFieldDef {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'BOOLEAN' | 'TEXTAREA' | 'REFERENCE';
  entityType: 'TICKET' | 'CONTACT' | 'DEAL' | 'LEAD';
  required: boolean;
  position: number;
  options: string[] | null;
  /** Prefilled into CREATE forms only; never applied to existing records. */
  defaultValue?: string | null;
  /** When set, this field only shows while the parent's value is in dependsOnValues. */
  dependsOnFieldId?: string | null;
  dependsOnValues?: string[] | null;
}

/**
 * Is this field currently visible, given the values entered so far?
 *
 * Shared by the form (which inputs to render) and the read-only display (which
 * values to show), so the two can never disagree about whether a field applies.
 * A field with no rule is always visible; a rule naming a parent that has since
 * been deleted is treated as no rule, matching the ON DELETE SET NULL on the
 * column.
 */
export function isFieldVisible(def: CustomFieldDef, values: Record<string, any>, defs: CustomFieldDef[]): boolean {
  if (!def.dependsOnFieldId) return true;
  const parent = defs.find(d => d.id === def.dependsOnFieldId);
  if (!parent) return true;
  // A parent that is itself hidden cannot be satisfied, so its children stay
  // hidden too — otherwise a two-level rule would reveal a grandchild whose
  // own trigger is invisible.
  if (!isFieldVisible(parent, values, defs)) return false;
  const current = values[parent.fieldKey];
  if (current === undefined || current === null || current === '') return false;
  return (def.dependsOnValues ?? []).includes(String(current));
}

/** The { [fieldKey]: value } map a fresh create form should start from. */
export function defaultsFor(defs: CustomFieldDef[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  (defs ?? []).forEach(d => {
    if (d.defaultValue !== null && d.defaultValue !== undefined && d.defaultValue !== '') {
      out[d.fieldKey] = d.defaultValue;
    }
  });
  return out;
}

export interface CustomFieldValueRecord {
  id: string;
  customFieldId: string;
  entityId: string;
  value: string | null;
  field: CustomFieldDef;
}

const unwrap = (r: any) => (Array.isArray(r.data) ? r.data : (r.data?.data ?? r.data));

/** Admin-defined field definitions for one entity type (TICKET/CONTACT/DEAL/LEAD). */
export const useCustomFieldDefs = (entityType: string) =>
  useQuery<CustomFieldDef[]>({
    queryKey: ['custom-fields', entityType],
    queryFn: () => api.get('/custom-fields', { params: { entityType } }).then(unwrap),
    enabled: !!entityType,
  });

/** Saved values for one specific entity record (a ticket, contact, deal or lead).
 *  The values endpoint is ALL_STAFF-only (definitions above are ALL_USERS), so
 *  callers rendered in views an EMPLOYEE can open pass
 *  `can.readStaffRecords(role)`. */
export const useCustomFieldValues = (entityId?: string, enabled = true) =>
  useQuery<CustomFieldValueRecord[]>({
    queryKey: ['custom-field-values', entityId],
    queryFn: () => api.get(`/custom-fields/values/${entityId}`).then(unwrap),
    enabled: !!entityId && enabled,
  });

export const useSaveCustomFieldValues = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entityId, values }: { entityId: string; values: { customFieldId: string; value: string | null }[] }) =>
      api.post(`/custom-fields/values/${entityId}`, { values }).then(r => r.data),
    onSuccess: (_data, { entityId }) => {
      qc.invalidateQueries({ queryKey: ['custom-field-values', entityId] });
    },
  });
};

/**
 * Converts a { [fieldKey]: rawValue } map (as edited in a form) into the
 * { customFieldId, value }[] payload the /values endpoint expects, using the
 * field definitions to look up each key's id and to stringify non-string
 * values (BOOLEAN/NUMBER) consistently.
 */
export function toValuesPayload(defs: CustomFieldDef[], formValues: Record<string, any>) {
  return defs
    .filter(d => formValues[d.fieldKey] !== undefined)
    .map(d => {
      const raw = formValues[d.fieldKey];
      const value = raw === '' || raw === null || raw === undefined ? null : String(raw);
      return { customFieldId: d.id, value };
    });
}

/** Builds the { [fieldKey]: value } map used as form state from saved value records. */
export function fromValueRecords(records: CustomFieldValueRecord[] | undefined) {
  const out: Record<string, string> = {};
  (records ?? []).forEach(r => {
    if (r.field?.fieldKey) out[r.field.fieldKey] = r.value ?? '';
  });
  return out;
}
