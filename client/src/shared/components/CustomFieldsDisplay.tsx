import { useCustomFieldDefs, useCustomFieldValues, fromValueRecords, isFieldVisible } from '../../api/customFields';
import { useContacts } from '../../api/crm';
import { Card } from './Card';
import { useAuth } from '../../contexts/AuthContext';
import { can } from '../permissions';

interface Props {
  entityType: string;
  entityId: string;
  /** Wrap in the standard bordered white card used by sibling detail-page sections. */
  card?: boolean;
}

function displayValue(fieldType: string, raw: string | undefined, contactNameById?: Map<string, string>) {
  if (raw === undefined || raw === '') return '--';
  if (fieldType === 'BOOLEAN') return raw === 'true' ? 'Yes' : raw === 'false' ? 'No' : '--';
  // REFERENCE stores the linked Contact's id — resolve it to a name rather
  // than showing the raw id (see customfields.controller.ts's FIELD_TYPES
  // comment on why REFERENCE always points at Contact today).
  if (fieldType === 'REFERENCE') return contactNameById?.get(raw) || '--';
  return raw;
}

/** Read-only custom field values for an entity detail view (e.g. Contact detail page). */
export function CustomFieldsDisplay({ entityType, entityId, card }: Props) {
  /* The definitions endpoint is ALL_USERS, but the *values* one
     (/custom-fields/values/:id) is ALL_STAFF and /crm/contacts — used to
     resolve REFERENCE values to a contact name — is CRM_STAFF. This block sits
     on record detail views an EMPLOYEE (own ticket) and IT staff (no CRM
     access) both open, so each read is asked for only when it can succeed. */
  const { user } = useAuth();
  const role = user?.role;
  const canReadValues = can.readStaffRecords(role);
  const { data: defs } = useCustomFieldDefs(entityType);
  const { data: records } = useCustomFieldValues(entityId, canReadValues);
  const hasReferenceField = !!defs?.some(d => d.fieldType === 'REFERENCE');
  const { data: contacts } = useContacts(undefined, hasReferenceField && can.readCrm(role));
  // Explicit <string, string> on the constructor itself — relying on
  // inference from the .map() callback's return type wasn't enough (still
  // widened to Map<unknown, unknown> and failed the build), since `contacts`
  // comes back untyped (any) from useContacts, so give the Map its type
  // directly instead of hoping TS infers it from the array.
  const contactNameById = new Map<string, string>((contacts ?? []).map((c: any) => [c.id, c.name]));
  const valueMap = fromValueRecords(records);

  // Without the values there is nothing to display but a grid of "--".
  if (!canReadValues) return null;
  if (!defs || defs.length === 0) return null;

  /* Conditional fields that don't apply to this record are left out entirely
     rather than shown as "--": a row reading "Escalation reason: --" on a
     low-priority ticket implies someone forgot to fill it in, when in fact the
     question was never asked. Evaluated against the record's own saved values,
     using the same rule the form used when capturing them. */
  const applicable = defs.filter(def => isFieldVisible(def, valueMap, defs));
  if (applicable.length === 0) return null;

  const grid = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
      {applicable.map(def => (
        <Card key={def.id} padding="sm" tone="sunken" flat>
          <p className="text-fg-subtle text-xs mb-1">{def.label}</p>
          <p className="font-medium text-fg">{displayValue(def.fieldType, valueMap[def.fieldKey], contactNameById)}</p>
        </Card>
      ))}
    </div>
  );

  if (!card) return grid;

  return (
    <Card>
      <p className="text-sm font-medium text-fg mb-3">Custom Fields</p>
      {grid}
    </Card>
  );
}
