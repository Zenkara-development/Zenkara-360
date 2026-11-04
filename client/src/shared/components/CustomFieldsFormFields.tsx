import { useEffect, useRef } from 'react';
import { useCustomFieldDefs, CustomFieldDef, isFieldVisible, defaultsFor } from '../../api/customFields';
import { useContacts } from '../../api/crm';
import { Spinner } from './Spinner';
import { SearchableSelect } from './SearchableSelect';
import { useAuth } from '../../contexts/AuthContext';
import { can } from '../permissions';

// REFERENCE fields always point at a Contact today (see
// customfields.controller.ts's FIELD_TYPES comment) — the value stored is
// just the Contact's id, same as every other field type's plain string.
// Split into its own component (rather than a case inline in FieldInput)
// because it needs its own hook call, which can't live inside a switch case.
function ReferenceFieldInput({ def, value, onChange }: { def: CustomFieldDef; value: string; onChange: (v: string) => void }) {
  /* /crm/contacts is CRM_STAFF-only, but custom fields show up on the ticket
     form that IT staff and employees fill in too. Rather than a picker backed
     by a request that is certain to be refused, they get a plain text input —
     the stored value is just a string either way, so an existing value is
     still visible and editable. */
  const { user } = useAuth();
  const canPickContact = can.readCrm(user?.role);
  const { data: contacts } = useContacts(undefined, canPickContact);

  if (!canPickContact) {
    return (
      <input
        aria-label={def.label}
        type="text"
        className="ui-input"
        required={def.required}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
      />
    );
  }

  return (
    <SearchableSelect
      ariaLabel={def.label}
      value={value ?? ''}
      onChange={onChange}
      required={def.required}
      placeholder="— select a contact —"
      options={(contacts ?? []).map((c: any) => ({ value: c.id, label: c.name }))}
    />
  );
}

interface Props {
  /** TICKET | CONTACT | DEAL | LEAD */
  entityType: string;
  /** { [fieldKey]: stringValue } */
  values: Record<string, string>;
  onChange: (fieldKey: string, value: string) => void;
  /**
   * True while creating a new record. Defaults are prefilled only then — an
   * edit form must show what was actually saved, never a default that would
   * silently rewrite a field the user deliberately left blank.
   */
  isNew?: boolean;
}

function FieldInput({ def, value, onChange }: { def: CustomFieldDef; value: string; onChange: (v: string) => void }) {
  const common = 'ui-input';
  switch (def.fieldType) {
    case 'TEXTAREA':
      return (
        <textarea
          aria-label={def.label}
          rows={3}
          className={common}
          required={def.required}
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
        />
      );
    case 'NUMBER':
      return (
        <input
          aria-label={def.label}
          type="number"
          className={common}
          required={def.required}
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
        />
      );
    case 'DATE':
      return (
        <input
          aria-label={def.label}
          type="date"
          className={common}
          required={def.required}
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
        />
      );
    case 'BOOLEAN':
      return (
        <select aria-label={def.label} className={common} required={def.required} value={value ?? ''} onChange={e => onChange(e.target.value)}>
          <option value="">— none —</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    case 'SELECT':
      return (
        <select aria-label={def.label} className={common} required={def.required} value={value ?? ''} onChange={e => onChange(e.target.value)}>
          <option value="">— none —</option>
          {(def.options ?? []).map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );
    case 'REFERENCE':
      return <ReferenceFieldInput def={def} value={value} onChange={onChange} />;
    case 'TEXT':
    default:
      return (
        <input
          aria-label={def.label}
          type="text"
          className={common}
          required={def.required}
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
        />
      );
  }
}

/**
 * Renders one input per admin-defined custom field for the given entity
 * type, driven entirely by /api/custom-fields definitions. Used inside the
 * Ticket/Contact/Deal/Lead create & edit forms so admin-configured custom
 * fields actually show up where they're supposed to.
 */
export function CustomFieldsFormFields({ entityType, values, onChange, isNew = false }: Props) {
  const { data: defs, isLoading } = useCustomFieldDefs(entityType);

  /* Prefill defaults once, when a create form first receives its definitions.
     Guarded by a ref rather than by "is this value still empty", so a user who
     deliberately clears a defaulted field doesn't have the default put back
     on the next render. */
  const seeded = useRef(false);
  useEffect(() => {
    if (!isNew || seeded.current || !defs?.length) return;
    seeded.current = true;
    const defaults = defaultsFor(defs);
    Object.entries(defaults).forEach(([key, value]) => {
      if (values[key] === undefined || values[key] === '') onChange(key, value);
    });
    // `values`/`onChange` are intentionally omitted: this runs once per form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defs, isNew]);

  const visible = (defs ?? []).filter(def => isFieldVisible(def, values, defs ?? []));

  /* A field that has just been hidden must not keep a value: it would be saved
     against a record the rule says it doesn't apply to, and would reappear as
     a stale answer if the parent were switched back. Clearing here also means
     the submitted payload needs no special-casing at any call site. */
  useEffect(() => {
    if (!defs?.length) return;
    defs.forEach(def => {
      if (!isFieldVisible(def, values, defs) && values[def.fieldKey]) {
        onChange(def.fieldKey, '');
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defs, values]);

  if (isLoading) return <Spinner />;
  if (!defs || defs.length === 0) return null;
  // Every field is currently conditional and unsatisfied — render nothing
  // rather than an empty titled section.
  if (visible.length === 0) return null;

  return (
    <div className="form-section">
      <p className="form-section-title">Custom Fields</p>
      <div className="space-y-4">
        {visible.map(def => (
          <div key={def.id} className="animate-fade-in">
            <label className="form-label">
              {def.label} {def.required && <span className="req">*</span>}
            </label>
            <FieldInput def={def} value={values[def.fieldKey]} onChange={v => onChange(def.fieldKey, v)} />
          </div>
        ))}
      </div>
    </div>
  );
}
