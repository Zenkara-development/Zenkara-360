import { useState } from 'react';
import { LayoutTemplate } from 'lucide-react';
import { useRecordTemplates, RecordTemplate } from '../../api/templates';
import { SearchableSelect } from './SearchableSelect';
import { useAuth } from '../../contexts/AuthContext';
import { can } from '../permissions';

interface Props {
  entityType: string;
  onApply: (template: RecordTemplate) => void;
}

/**
 * "Start from a template" picker shown on Ticket/Contact/Deal/Lead create
 * forms. Selecting a template merges its default field + custom field
 * values into the form — it does not submit anything, so the user can still
 * edit before saving.
 */
export function RecordTemplatePicker({ entityType, onApply }: Props) {
  /* GET /templates/records is ALL_STAFF, and this picker sits on the ticket
     create form that an EMPLOYEE uses to file their own ticket — so for them
     it asks for nothing and renders nothing (same as having no templates). */
  const { user } = useAuth();
  const canReadTemplates = can.readStaffRecords(user?.role);
  const { data: templates } = useRecordTemplates(entityType, canReadTemplates);
  const [selected, setSelected] = useState('');

  if (!canReadTemplates) return null;
  if (!templates || templates.length === 0) return null;

  return (
    <div className="form-section">
      <p className="form-section-title flex items-center gap-1.5">
        <LayoutTemplate size={13} /> Start from a template
      </p>
      <SearchableSelect
        ariaLabel="Template"
        value={selected}
        onChange={val => {
          setSelected(val);
          const template = templates.find(t => t.id === val);
          if (template) onApply(template);
        }}
        options={templates.map(t => ({ value: t.id, label: t.name }))}
        placeholder="— none, start blank —"
      />
    </div>
  );
}
