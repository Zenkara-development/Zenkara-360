import { useState } from 'react';
import {
  Zap, Plus, Trash2, ToggleLeft, ToggleRight,
  Play, Clock, CheckCircle, XCircle,
  Eye, Edit2
} from 'lucide-react';
import {
  PageHeader, PageBody, Card, StatTile, Modal, Button, IconButton, Badge,
  Field, Input, Select, Textarea, Checkbox, EmptyState,
  SearchableSelect, RowActions, SkeletonCard, AccessDenied,
} from '../../shared/components';
import {
  useWorkflows, useWorkflowLogs, useCreateWorkflow, useUpdateWorkflow,
  useDeleteWorkflow, useToggleWorkflow, useRunDateRule,
  type WorkflowRule, type Condition, type Action, type DateConfig,
} from '../../api/workflows';
import { useCustomModules, useCustomModule } from '../../api/customModules';
import { useCustomFieldDefs } from '../../api/customFields';
import { useUsers } from '../../api/users';
import { useFormat } from '../../hooks/useFormat';
import { addToast } from '../../shared/components/toastStore';
import { useAuth } from '../../contexts/AuthContext';
import { can } from '../../shared/permissions';

// ─── Config maps ──────────────────────────────────────────────────────────────

const TRIGGERS = [
  { value: 'TICKET_CREATED',       label: 'Ticket Created',        entity: 'TICKET' },
  { value: 'TICKET_STATUS_CHANGED',label: 'Ticket Status Changed', entity: 'TICKET' },
  { value: 'TICKET_UPDATED',       label: 'Ticket Updated',        entity: 'TICKET' },
  { value: 'LEAD_CREATED',         label: 'Lead Created',          entity: 'LEAD' },
  { value: 'LEAD_STATUS_CHANGED',  label: 'Lead Status Changed',   entity: 'LEAD' },
  { value: 'LEAD_ACTIVITY_COMPLETED', label: 'Lead Follow-up Completed', entity: 'LEAD' },
  { value: 'DEAL_STAGE_CHANGED',   label: 'Deal Stage Changed',    entity: 'DEAL' },
  { value: 'DEAL_WON',             label: 'Deal Won',              entity: 'DEAL' },
  { value: 'DEAL_LOST',            label: 'Deal Lost',             entity: 'DEAL' },
  { value: 'SLA_BREACH',           label: 'SLA Breach',            entity: 'TICKET' },
  // "entity" here is only the *default* — DATE_FIELD_REACHED's actual
  // entity depends on the rule's own dateConfig.entityType (Contact vs a
  // specific Custom Module), resolved by getEntityForTrigger() below.
  { value: 'DATE_FIELD_REACHED',   label: 'Date Reached (birthday, reminder, renewal…)', entity: 'CONTACT' },
  // Newer-module coverage — keep in step with the trigger enum in
  // server workflows.controller.ts and WorkflowTrigger in workflow-engine.ts.
  { value: 'CUSTOM_RECORD_CREATED',  label: 'Custom Module Record Created', entity: 'CUSTOM_MODULE_RECORD' },
  { value: 'CUSTOM_RECORD_STAGE_CHANGED', label: 'Custom Module Stage Changed (board move)', entity: 'CUSTOM_MODULE_RECORD' },
  { value: 'INVOICE_STATUS_CHANGED', label: 'Invoice Status Changed (paid, overdue…)', entity: 'INVOICE' },
  { value: 'QUOTE_STATUS_CHANGED',   label: 'Quote Status Changed (sent, accepted…)', entity: 'QUOTE' },
  { value: 'CSAT_RECEIVED',          label: 'Feedback Rating Received', entity: 'TICKET' },
  { value: 'APPROVAL_DECIDED',       label: 'Approval Request Decided', entity: 'APPROVAL' },
  { value: 'LEAVE_REQUESTED',        label: 'Leave Requested', entity: 'LEAVE' },
];

const CONDITION_FIELDS: Record<string, { value: string; label: string }[]> = {
  TICKET: [
    { value: 'priority', label: 'Priority' },
    { value: 'status', label: 'Status' },
    { value: 'assignedTo', label: 'Assigned To (User ID)' },
    // Flattened onto the workflow entity by tickets.controller — matches the
    // department's display name, so "departmentName equals IT" reads sanely.
    { value: 'departmentName', label: 'Department (name, e.g. IT)' },
  ],
  LEAD: [
    { value: 'status', label: 'Status' },
    { value: 'source', label: 'Source' },
    { value: 'departmentName', label: 'Department (name)' },
  ],
  DEAL: [
    { value: 'stage', label: 'Stage' },
    { value: 'status', label: 'Status' },
    { value: 'departmentName', label: 'Department (name)' },
  ],
  CONTACT: [
    { value: 'source', label: 'Source' },
  ],
  INVOICE: [
    { value: 'status', label: 'Status (DRAFT/SENT/PAID/OVERDUE/VOID)' },
    { value: 'invoiceNumber', label: 'Invoice number' },
  ],
  QUOTE: [
    { value: 'status', label: 'Status (DRAFT/SENT/ACCEPTED/REJECTED)' },
  ],
  APPROVAL: [
    { value: 'status', label: 'Final status (APPROVED/REJECTED)' },
    { value: 'entityType', label: 'What was approved (entity type)' },
  ],
  LEAVE: [
    { value: 'days', label: 'Days requested' },
    { value: 'leaveType', label: 'Leave type name' },
  ],
  // CUSTOM_MODULE_RECORD's fields are module-specific, so there's no fixed
  // list here besides moduleSlug (scopes a rule to one module) — other field
  // names can be typed in as free text via the condition value input.
  CUSTOM_MODULE_RECORD: [
    { value: 'moduleSlug', label: 'Module (slug, e.g. erp-work-orders)' },
    // Stage-change events carry both sides of the move.
    { value: 'stage', label: 'Stage (new stage key)' },
    { value: 'previousStage', label: 'Previous stage key' },
  ],
};

const OPERATORS = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'gt', label: 'greater than' },
  { value: 'lt', label: 'less than' },
  { value: 'contains', label: 'contains' },
];

const ACTION_TYPES = [
  { value: 'ASSIGN_TO',     label: 'Assign to User' },
  { value: 'SET_PRIORITY',  label: 'Set Priority' },
  { value: 'SET_STATUS',    label: 'Set Status' },
  { value: 'SEND_EMAIL',    label: 'Send Email' },
  { value: 'SEND_WHATSAPP', label: 'Send WhatsApp (not for Leads)' },
  { value: 'ADD_NOTE',      label: 'Add Note' },
  { value: 'SEND_WEBHOOK',  label: 'Send Webhook' },
  { value: 'CREATE_NOTIFICATION', label: 'Create In-App Notification' },
  { value: 'CREATE_TICKET', label: 'Create Follow-up Ticket' },
  { value: 'SCORE_LEAD',    label: 'AI-Score Lead (Lead only)' },
  // The AI dispatcher: reads the new ticket/lead and fills in department +
  // owner, balancing topical fit against each teammate's live workload.
  // Fill-only — it never overwrites a human's choice. No params needed.
  { value: 'AI_AUTO_ASSIGN', label: 'AI Auto-Assign owner + department (Ticket/Lead)' },
  { value: 'SEND_CSAT_SURVEY', label: 'Send Feedback Survey (Ticket only)' },
];

const PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(v => ({ value: v, label: v }));

// Mirrors the RECIPIENT_OPTIONS in ScheduleReminderPanel — same four
// recipient types, same restriction that "Deal's contact" only makes sense
// for DEAL-triggered rules (tickets have no linked CRM Contact).
const WHATSAPP_RECIPIENT_OPTIONS: Record<string, { value: string; label: string }[]> = {
  DEAL: [
    { value: 'CONTACT', label: "Deal's contact" },
    { value: 'ASSIGNEE', label: 'Assigned rep' },
    { value: 'CUSTOM_NUMBER', label: 'Custom number' },
    { value: 'ORG_DEFAULT', label: 'Org default number' },
  ],
  TICKET: [
    // "Linked contact" only resolves if the ticket was filed "on behalf of"
    // a Contact (Ticket.contactId, set from the New Ticket form's "Filing
    // For" picker) — otherwise this fails cleanly at send time, same as any
    // other recipient option with nothing on file. See notification-recipient.ts.
    { value: 'CONTACT', label: 'Linked contact (if filed on behalf of one)' },
    { value: 'ASSIGNEE', label: 'Assigned agent' },
    { value: 'CUSTOM_NUMBER', label: 'Custom number' },
    { value: 'ORG_DEFAULT', label: 'Org default number' },
  ],
  CONTACT: [
    { value: 'CONTACT', label: "Contact's own number" },
    { value: 'ASSIGNEE', label: 'Contact owner' },
    { value: 'CUSTOM_NUMBER', label: 'Custom number' },
    { value: 'ORG_DEFAULT', label: 'Org default number' },
  ],
  // CUSTOM_MODULE_RECORD falls back to the TICKET set below (ASSIGNEE will
  // just fail cleanly at send time — see notification-recipient.ts) — set
  // recipient to "Custom number" with a {{fieldKey}} template pointing at
  // whichever of the module's own fields holds a phone number.
};

// Appended to whichever entity's option list above whenever that entity has
// at least one REFERENCE custom field defined (see customfields.controller.ts's
// FIELD_TYPES) — lets a rule notify whoever a *specific* field points at,
// not just the record's built-in requester/assignee/contact.
const REFERENCE_FIELD_OPTION = { value: 'REFERENCE_FIELD', label: 'A "Reference" custom field…' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_DATE_CONFIG: DateConfig = {
  entityType: 'CONTACT',
  dateField: 'dateOfBirth',
  offsetDays: 0,
  recurrence: 'YEARLY',
};

const empty = (): Omit<WorkflowRule, 'id' | 'createdAt' | 'runCount' | '_count'> => ({
  name: '',
  description: '',
  trigger: 'TICKET_CREATED',
  conditions: [],
  actions: [{ type: 'ASSIGN_TO', params: { userId: '' } }],
  isActive: true,
});

// DATE_FIELD_REACHED's real entity depends on the rule's own dateConfig
// (Contact vs a specific Custom Module's records), unlike every other
// trigger which maps 1:1 to a fixed entity.
function getEntityForTrigger(trigger: string, dateConfig?: DateConfig | null): string {
  if (trigger === 'DATE_FIELD_REACHED') {
    if (dateConfig?.entityType === 'CUSTOM_MODULE') return 'CUSTOM_MODULE_RECORD';
    return dateConfig?.entityType || 'CONTACT';
  }
  return TRIGGERS.find(t => t.value === trigger)?.entity || 'TICKET';
}

/** Every action parameter control is compact — one wrapper so the grid of
 *  fields lines up whether an action needs one control or four. */
function ParamStack({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 min-w-0 space-y-1">{children}</div>;
}

function ActionParamsEditor({ action, onChange, entity }: { action: Action; onChange: (a: Action) => void; entity: string }) {
  const p = action.params;
  const set = (k: string, v: string) => onChange({ ...action, params: { ...p, [k]: v } });
  // Only standard entities (not CUSTOM_MODULE_RECORD) can carry REFERENCE
  // custom fields today — see customfields.controller.ts's ENTITY_TYPES.
  const isStandardEntity = ['TICKET', 'CONTACT', 'DEAL', 'LEAD'].includes(entity);
  const { data: entityFieldDefs } = useCustomFieldDefs(isStandardEntity ? entity : '');
  const referenceFields = (entityFieldDefs || []).filter(d => d.fieldType === 'REFERENCE');
  const { data: orgUsers } = useUsers();

  switch (action.type) {
    case 'ASSIGN_TO':
      return <ParamStack>
        <Select selectSize="sm" aria-label="Assign to" value={String(p.userId || '')} onChange={e => set('userId', e.target.value)}>
          <option value="">— select a teammate —</option>
          {(orgUsers ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
      </ParamStack>;
    case 'SET_PRIORITY':
      return <ParamStack>
        <Select selectSize="sm" aria-label="Priority" value={String(p.priority || 'MEDIUM')}
          onChange={e => set('priority', e.target.value)} options={PRIORITY_OPTIONS} />
      </ParamStack>;
    case 'SET_STATUS':
      return <ParamStack>
        <Input inputSize="sm" aria-label="Status" value={String(p.status || '')} onChange={e => set('status', e.target.value)}
          placeholder="OPEN / RESOLVED / etc." />
      </ParamStack>;
    case 'SEND_EMAIL':
      return <ParamStack>
        <Input inputSize="sm" aria-label="To email" value={String(p.to || '')} onChange={e => set('to', e.target.value)}
          placeholder="To email (use {{contact.email}})" />
        <Input inputSize="sm" aria-label="Subject" value={String(p.subject || '')} onChange={e => set('subject', e.target.value)}
          placeholder="Subject" />
        <Textarea className="text-[12.5px] !py-1.5" aria-label="Body" value={String(p.body || '')} onChange={e => set('body', e.target.value)}
          placeholder="Body (use {{title}}, {{priority}}, {{status}})" rows={2} />
      </ParamStack>;
    case 'SEND_WHATSAPP': {
      const baseOptions = WHATSAPP_RECIPIENT_OPTIONS[entity] || WHATSAPP_RECIPIENT_OPTIONS.TICKET;
      const recipientOptions = referenceFields.length ? [...baseOptions, REFERENCE_FIELD_OPTION] : baseOptions;
      const recipientType = String(p.recipientType || 'ASSIGNEE');
      return <ParamStack>
        {entity === 'LEAD' && (
          <p className="text-[11px] text-warning">SEND_WHATSAPP isn't supported for leads — this action will be skipped when it runs.</p>
        )}
        <Select selectSize="sm" aria-label="Recipient" value={recipientType} onChange={e => set('recipientType', e.target.value)}
          options={recipientOptions} />
        {recipientType === 'CUSTOM_NUMBER' && (
          <Input inputSize="sm" aria-label="Custom number" value={String(p.customNumber || '')} onChange={e => set('customNumber', e.target.value)}
            placeholder="+14155551234" />
        )}
        {recipientType === 'REFERENCE_FIELD' && (
          <Select selectSize="sm" aria-label="Reference field" value={String(p.referenceFieldId || '')} onChange={e => set('referenceFieldId', e.target.value)}>
            <option value="">— select a reference field —</option>
            {referenceFields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </Select>
        )}
        <Textarea className="text-[12.5px] !py-1.5" aria-label="Message" value={String(p.message || '')} onChange={e => set('message', e.target.value)}
          placeholder="Message (use {{title}}, {{priority}}, {{status}})" rows={2} />
      </ParamStack>;
    }
    case 'ADD_NOTE':
      return <ParamStack>
        <Textarea className="text-[12.5px] !py-1.5" aria-label="Note body" value={String(p.body || '')} onChange={e => set('body', e.target.value)}
          placeholder="Note body" rows={2} />
      </ParamStack>;
    case 'SEND_WEBHOOK':
      return <ParamStack>
        <Input inputSize="sm" aria-label="Webhook URL" value={String(p.url || '')} onChange={e => set('url', e.target.value)}
          placeholder="https://hooks.example.com/crm" />
      </ParamStack>;
    case 'CREATE_NOTIFICATION': {
      const recipientType = String(p.recipientType || 'ASSIGNEE');
      return <ParamStack>
        <Input inputSize="sm" aria-label="Notification title" value={String(p.title || '')} onChange={e => set('title', e.target.value)}
          placeholder="Notification title" />
        <Textarea className="text-[12.5px] !py-1.5" aria-label="Notification body" value={String(p.body || '')} onChange={e => set('body', e.target.value)}
          placeholder="Body (use {{title}}, {{priority}}, {{status}})" rows={2} />
        <Select selectSize="sm" aria-label="Recipient" value={recipientType} onChange={e => set('recipientType', e.target.value)}>
          <option value="ASSIGNEE">Assignee / owner</option>
          <option value="USER">Specific user</option>
        </Select>
        {recipientType === 'USER' && (
          <Select selectSize="sm" aria-label="User" value={String(p.userId || '')} onChange={e => set('userId', e.target.value)}>
            <option value="">— select a teammate —</option>
            {(orgUsers ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        )}
      </ParamStack>;
    }
    case 'CREATE_TICKET':
      return <ParamStack>
        <Input inputSize="sm" aria-label="Ticket title" value={String(p.title || '')} onChange={e => set('title', e.target.value)}
          placeholder="Ticket title (use {{title}})" />
        <Textarea className="text-[12.5px] !py-1.5" aria-label="Description" value={String(p.body || '')} onChange={e => set('body', e.target.value)}
          placeholder="Description" rows={2} />
        <Select selectSize="sm" aria-label="Priority" value={String(p.priority || 'MEDIUM')} onChange={e => set('priority', e.target.value)}
          options={PRIORITY_OPTIONS} />
      </ParamStack>;
    case 'SCORE_LEAD':
      return <p className="flex-1 text-[11px] text-fg-subtle italic px-1 py-1.5">No parameters — uses AI to score the lead and stores the result on the lead record.</p>;
    case 'AI_AUTO_ASSIGN':
      return <p className="flex-1 text-[11px] text-fg-subtle italic px-1 py-1.5">No parameters — AI picks the department and the least-loaded suitable teammate, and only fills fields that are still empty (a human's choice is never overwritten).</p>;
    case 'SEND_CSAT_SURVEY': {
      if (entity !== 'TICKET') {
        return <p className="flex-1 text-[11px] text-warning italic px-1 py-1.5">Only applies to Ticket-triggered rules — this action will be skipped otherwise.</p>;
      }
      const recipientType = String(p.recipientType || 'REQUESTER');
      return <ParamStack>
        <Select selectSize="sm" aria-label="Recipient" value={recipientType} onChange={e => set('recipientType', e.target.value)}>
          <option value="REQUESTER">Whoever filed the ticket</option>
          <option value="CONTACT">Linked contact (if filed on behalf of one)</option>
          {referenceFields.length > 0 && <option value="REFERENCE_FIELD">A "Reference" custom field…</option>}
        </Select>
        {recipientType === 'REFERENCE_FIELD' && (
          <Select selectSize="sm" aria-label="Reference field" value={String(p.referenceFieldId || '')} onChange={e => set('referenceFieldId', e.target.value)}>
            <option value="">— select a reference field —</option>
            {referenceFields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </Select>
        )}
        <p className="text-[11px] text-fg-subtle italic">Emails a 1–5 star rating link to whoever is selected above.</p>
      </ParamStack>;
    }
    default:
      return null;
  }
}

// ─── Date-config sub-form (only for trigger === 'DATE_FIELD_REACHED') ─────────

// Built-in date columns every "default module" (standard entity) exposes
// without needing a custom field — mirrors server/src/utils/dateAutomation.ts's
// BUILTIN_DATE_FIELDS exactly (see that file's comment for why these two
// lists have to agree). createdAt/updatedAt are universal; dateOfBirth is
// Contact-only.
const BUILTIN_DATE_FIELDS: Record<string, { value: string; label: string }[]> = {
  CONTACT: [
    { value: 'dateOfBirth', label: 'Date of Birth' },
    { value: 'createdAt', label: 'Created' },
    { value: 'updatedAt', label: 'Last Updated' },
  ],
  DEAL: [
    { value: 'createdAt', label: 'Created' },
    { value: 'updatedAt', label: 'Last Updated' },
  ],
  TICKET: [
    { value: 'createdAt', label: 'Created' },
    { value: 'updatedAt', label: 'Last Updated' },
  ],
  LEAD: [
    { value: 'createdAt', label: 'Created' },
    { value: 'updatedAt', label: 'Last Updated' },
  ],
};

const STANDARD_ENTITY_LABELS: Record<string, string> = {
  CONTACT: 'Contacts',
  DEAL: 'Deals',
  TICKET: 'Tickets',
  LEAD: 'Leads',
};

function DateConfigEditor({ config, onChange }: { config: DateConfig; onChange: (c: DateConfig) => void }) {
  const { data: modules = [] } = useCustomModules();
  const { data: selectedModule } = useCustomModule(config.entityType === 'CUSTOM_MODULE' ? config.moduleId : undefined);
  const moduleDateFields = (selectedModule?.fields || []).filter((f: any) => f.fieldType === 'DATE');

  const isStandardEntity = config.entityType !== 'CUSTOM_MODULE';
  // Org-defined custom fields (Settings → Custom Fields) of type DATE for
  // whichever standard entity is selected — the "if there are any custom
  // date fields they also need to be displayed" half of this feature.
  const { data: customFieldDefs = [] } = useCustomFieldDefs(isStandardEntity ? config.entityType : '');
  const customDateFields = customFieldDefs.filter(f => f.fieldType === 'DATE');
  const builtinFields = isStandardEntity ? (BUILTIN_DATE_FIELDS[config.entityType] || []) : [];

  const isBefore = config.offsetDays < 0;
  const dayCount = Math.abs(config.offsetDays);

  return (
    <div className="space-y-3 bg-accent-soft border border-accent/25 rounded-card p-3">
      <Field label="Watch this date on…">
        <Select
          value={config.entityType}
          onChange={e => {
            const entityType = e.target.value as DateConfig['entityType'];
            const defaultField = entityType === 'CONTACT' ? 'dateOfBirth' : entityType === 'CUSTOM_MODULE' ? '' : 'createdAt';
            onChange({ ...config, entityType, dateField: defaultField, moduleId: undefined });
          }}
        >
          <option value="CONTACT">Contacts</option>
          <option value="DEAL">Deals</option>
          <option value="TICKET">Tickets</option>
          <option value="LEAD">Leads</option>
          <option value="CUSTOM_MODULE">A Custom Module's date field</option>
        </Select>
      </Field>

      {isStandardEntity && (
        <Field
          label="Date Field"
          hint={customDateFields.length === 0
            ? `Add a custom Date field to ${STANDARD_ENTITY_LABELS[config.entityType]} under Settings → Custom Fields to see more options here.`
            : undefined}
        >
          <Select
            value={config.dateField}
            onChange={e => onChange({ ...config, dateField: e.target.value })}
          >
            <option value="">— select a field —</option>
            {builtinFields.length > 0 && (
              <optgroup label="Built-in">
                {builtinFields.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </optgroup>
            )}
            {customDateFields.length > 0 && (
              <optgroup label="Custom fields">
                {customDateFields.map(f => <option key={f.fieldKey} value={f.fieldKey}>{f.label}</option>)}
              </optgroup>
            )}
          </Select>
        </Field>
      )}

      {config.entityType === 'CUSTOM_MODULE' && (
        <>
          <Field label="Custom Module">
            <Select
              value={config.moduleId || ''}
              onChange={e => onChange({ ...config, moduleId: e.target.value, dateField: '' })}
            >
              <option value="">— select a module —</option>
              {modules.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
          {config.moduleId && (
            <Field label="Date Field">
              {moduleDateFields.length === 0 ? (
                <p className="text-xs text-warning">This module has no Date-type field yet — add one on the module's Fields tab first.</p>
              ) : (
                <Select
                  value={config.dateField}
                  onChange={e => onChange({ ...config, dateField: e.target.value })}
                >
                  <option value="">— select a field —</option>
                  {moduleDateFields.map((f: any) => <option key={f.fieldKey} value={f.fieldKey}>{f.label}</option>)}
                </Select>
              )}
            </Field>
          )}
        </>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="When">
          <div className="flex items-center flex-wrap gap-2">
            <div className="w-24 shrink-0">
              <Select
                aria-label="Before or after"
                value={isBefore ? 'BEFORE' : 'AFTER'}
                onChange={e => onChange({ ...config, offsetDays: e.target.value === 'BEFORE' ? -dayCount : dayCount })}
              >
                <option value="BEFORE">Before</option>
                <option value="AFTER">After / On</option>
              </Select>
            </div>
            <Input
              className="w-20"
              aria-label="Days"
              type="number" min={0}
              value={dayCount}
              onChange={e => { const n = Math.max(0, Number(e.target.value)); onChange({ ...config, offsetDays: isBefore ? -n : n }); }}
            />
            <span className="text-xs text-fg-muted">day(s)</span>
          </div>
        </Field>
        <Field label="Repeats">
          <Select
            value={config.recurrence}
            onChange={e => onChange({ ...config, recurrence: e.target.value as DateConfig['recurrence'] })}
          >
            <option value="YEARLY">Every year (birthdays, anniversaries)</option>
            <option value="ONCE">Once (a specific appointment/visit date)</option>
          </Select>
        </Field>
      </div>
      <p className="text-xs text-fg-muted">
        {dayCount === 0
          ? 'Fires on the date itself.'
          : `Fires ${dayCount} day${dayCount === 1 ? '' : 's'} ${isBefore ? 'before' : 'after'} the date.`}
      </p>
    </div>
  );
}

// ─── Rule Editor Modal ────────────────────────────────────────────────────────

function RuleEditor({
  initial,
  onSave,
  onClose,
  saving,
}: {
  initial: Omit<WorkflowRule, 'id' | 'createdAt' | 'runCount' | '_count'>;
  onSave: (rule: typeof initial) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState(initial);
  const { data: orgUsers } = useUsers();

  const entity = getEntityForTrigger(form.trigger, form.dateConfig);
  const condFields = CONDITION_FIELDS[entity] || [];

  const dateConfigIncomplete = form.trigger === 'DATE_FIELD_REACHED' && (
    !form.dateConfig?.dateField || (form.dateConfig.entityType === 'CUSTOM_MODULE' && !form.dateConfig.moduleId)
  );

  function addCondition() {
    setForm(f => ({ ...f, conditions: [...f.conditions, { field: condFields[0]?.value || 'priority', operator: 'eq', value: '' }] }));
  }
  function updateCondition(i: number, patch: Partial<Condition>) {
    setForm(f => ({ ...f, conditions: f.conditions.map((c, idx) => idx === i ? { ...c, ...patch } : c) }));
  }
  function removeCondition(i: number) {
    setForm(f => ({ ...f, conditions: f.conditions.filter((_, idx) => idx !== i) }));
  }

  function addAction() {
    setForm(f => ({ ...f, actions: [...f.actions, { type: 'ADD_NOTE', params: { body: '' } }] }));
  }
  function updateAction(i: number, patch: Partial<Action>) {
    setForm(f => ({ ...f, actions: f.actions.map((a, idx) => idx === i ? { ...a, ...patch } as Action : a) }));
  }
  function removeAction(i: number) {
    setForm(f => ({ ...f, actions: f.actions.filter((_, idx) => idx !== i) }));
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={initial.name ? `Edit: ${initial.name}` : 'New Automation Rule'}
      icon={<Zap size={16} />}
      size="lg"
      footer={
        <>
          <Checkbox
            className="mr-auto"
            label="Active"
            checked={form.isActive}
            onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
          />
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onSave(form)}
            loading={saving}
            disabled={!form.name || form.actions.length === 0 || dateConfigIncomplete}
          >
            Save Rule
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {/* Name + Description */}
        <div className="form-section">
          <p className="form-section-title">Rule Details</p>
          <div className="space-y-4">
            <Field label="Rule Name" required>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                aria-label="Rule Name" placeholder="e.g. Auto-assign CRITICAL tickets" />
            </Field>
            <Field label="Description">
              <Input value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="What does this automation do?" />
            </Field>
          </div>
        </div>

        {/* Trigger */}
        <div className="form-section">
          <p className="form-section-title">① When this happens (Trigger)</p>
          <SearchableSelect ariaLabel="Trigger" value={form.trigger} onChange={val => setForm(f => ({
            ...f,
            trigger: val,
            conditions: [],
            dateConfig: val === 'DATE_FIELD_REACHED' ? (f.dateConfig || DEFAULT_DATE_CONFIG) : f.dateConfig,
          }))} required options={TRIGGERS.map(t => ({ value: t.value, label: t.label }))} />
          {form.trigger === 'DATE_FIELD_REACHED' && (
            <div className="mt-3">
              <DateConfigEditor
                config={form.dateConfig || DEFAULT_DATE_CONFIG}
                onChange={dateConfig => setForm(f => ({ ...f, dateConfig }))}
              />
            </div>
          )}
        </div>

        {/* Conditions */}
        <div className="form-section">
          <div className="flex items-center justify-between mb-3">
            <p className="form-section-title" style={{ marginBottom: 0 }}>② Conditions (optional)</p>
            <Button size="xs" variant="subtle" icon={<Plus size={12} />} onClick={addCondition}>Add</Button>
          </div>
          {form.conditions.length === 0 ? (
            <p className="text-xs text-fg-subtle italic">No conditions — rule runs for every {form.trigger.toLowerCase()} event</p>
          ) : (
            <div className="space-y-2">
              {form.conditions.map((cond, i) => (
                // Stacks to full-width rows on mobile instead of squeezing
                // three controls + a delete button onto one line — with
                // fixed-width selects and a flex-1 value input, the value
                // field used to get crushed down to almost nothing on
                // narrow screens before wrapping ever kicked in.
                <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-2 bg-surface-sunken sm:bg-transparent border border-line-subtle sm:border-0 rounded-card p-2 sm:p-0">
                  <div className="w-full sm:w-36 sm:shrink-0">
                    <Select selectSize="sm" aria-label="Condition field" value={cond.field} onChange={e => updateCondition(i, { field: e.target.value })}
                      options={condFields} />
                  </div>
                  <div className="w-full sm:w-28 sm:shrink-0">
                    <Select selectSize="sm" aria-label="Operator" value={cond.operator} onChange={e => updateCondition(i, { operator: e.target.value as any })}
                      options={OPERATORS} />
                  </div>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className="flex-1 min-w-0">
                      {cond.field === 'assignedTo' ? (
                        <Select selectSize="sm" aria-label="Value" value={String(cond.value)} onChange={e => updateCondition(i, { value: e.target.value })}>
                          <option value="">— select a teammate —</option>
                          {(orgUsers ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </Select>
                      ) : (
                        <Input inputSize="sm" aria-label="Value" value={String(cond.value)} onChange={e => updateCondition(i, { value: e.target.value })}
                          placeholder="Value" />
                      )}
                    </div>
                    <IconButton label="Remove condition" icon={<Trash2 size={13} />} tone="danger" onClick={() => removeCondition(i)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="form-section">
          <div className="flex items-center justify-between mb-3">
            <p className="form-section-title" style={{ marginBottom: 0 }}>③ Actions</p>
            <Button size="xs" variant="subtle" icon={<Plus size={12} />} onClick={addAction}>Add</Button>
          </div>
          <div className="space-y-3">
            {form.actions.map((action, i) => (
              <div key={i} className="flex flex-col sm:flex-row sm:items-start gap-2 bg-surface border border-line-subtle rounded-card p-3">
                <div className="flex items-center gap-2">
                  <div className="w-full sm:w-40 sm:shrink-0">
                    <Select selectSize="sm" aria-label="Action type" value={action.type}
                      onChange={e => updateAction(i, { type: e.target.value as any, params: {} })}
                      options={ACTION_TYPES} />
                  </div>
                  <IconButton className="sm:hidden" label="Remove action" icon={<Trash2 size={13} />} tone="danger" onClick={() => removeAction(i)} />
                </div>
                <div className="flex-1 min-w-0 flex items-start gap-2">
                  <ActionParamsEditor action={action} onChange={a => updateAction(i, a)} entity={entity} />
                  <IconButton className="hidden sm:inline-flex" label="Remove action" icon={<Trash2 size={13} />} tone="danger" onClick={() => removeAction(i)} />
                </div>
              </div>
            ))}
            {form.actions.length === 0 && (
              <p className="text-xs text-fg-subtle italic">Add at least one action</p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

function LogsDrawer({ ruleId, ruleName, onClose }: { ruleId: string; ruleName: string; onClose: () => void }) {
  const { dateTime } = useFormat();
  // /workflows/:id/logs carries the same MANAGERS guard as the rules list.
  const { user } = useAuth();
  const { data: logs, isLoading } = useWorkflowLogs(ruleId, can.readWorkflows(user?.role));

  const icon = (result: string) => result === 'SUCCESS' ? <CheckCircle size={13} className="text-success" />
    : result === 'SKIPPED' ? <Clock size={13} className="text-fg-subtle" />
    : <XCircle size={13} className="text-danger" />;

  return (
    <Modal open onClose={onClose} title="Execution Log" subtitle={ruleName} icon={<Eye size={16} />}>
      {isLoading ? (
        <div className="space-y-2" aria-hidden="true">
          <div className="skeleton h-16 w-full" />
          <div className="skeleton h-16 w-full opacity-70" />
          <div className="skeleton h-16 w-full opacity-40" />
        </div>
      )
        : !logs?.length ? (
          <EmptyState
            icon={<Play />}
            title="No executions yet"
            description="Each time this rule fires, the outcome is recorded here."
            compact
          />
        ) : (
          <div className="space-y-2">
            {logs.map(log => (
              <div key={log.id} className="flex items-start gap-2.5 p-3 bg-surface-sunken rounded-card">
                <div className="mt-0.5 shrink-0">{icon(log.result)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${log.result === 'SUCCESS' ? 'text-success' : log.result === 'SKIPPED' ? 'text-fg-muted' : 'text-danger'}`}>
                      {log.result}
                    </span>
                    <span className="text-xs text-fg-subtle">{log.entityType} · {log.entityId.slice(0, 8)}…</span>
                  </div>
                  {log.detail && <p className="text-xs text-fg-muted mt-0.5 truncate">{log.detail}</p>}
                  <p className="text-xs text-fg-subtle mt-0.5">{dateTime(log.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function WorkflowsPage() {
  /* /workflows and /workflows/:id/logs are MANAGERS-only, as is every mutation
     on this screen. For anyone else the page could only ever render an empty
     "no rules yet" state above buttons whose one possible outcome is a refusal. */
  const { user } = useAuth();
  const canReadWorkflows = can.readWorkflows(user?.role);
  const { data: rules = [], isLoading } = useWorkflows(canReadWorkflows);
  const createRule = useCreateWorkflow();
  const updateRule = useUpdateWorkflow();
  const deleteRule = useDeleteWorkflow();
  const toggleRule = useToggleWorkflow();

  const [showEditor, setShowEditor] = useState(false);
  const [editingRule, setEditingRule] = useState<WorkflowRule | null>(null);
  const [logsFor, setLogsFor] = useState<{ id: string; name: string } | null>(null);
  const runDateRule = useRunDateRule();

  function handleSave(data: Omit<WorkflowRule, 'id' | 'createdAt' | 'runCount' | '_count'>) {
    if (editingRule) {
      updateRule.mutate({ id: editingRule.id, ...data }, { onSuccess: () => { setShowEditor(false); setEditingRule(null); } });
    } else {
      createRule.mutate(data, { onSuccess: () => setShowEditor(false) });
    }
  }

  if (!canReadWorkflows) return <AccessDenied />;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Workflow Automation"
        subtitle="Automate repetitive tasks — assign tickets, send emails, update statuses, and more."
        actions={
          <Button icon={<Plus size={15} />} onClick={() => { setEditingRule(null); setShowEditor(true); }}>
            New Rule
          </Button>
        }
      />

      <div className="flex-1 overflow-auto">
        <PageBody>
          {/* Stats bar */}
          {rules.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: 'Total Rules', value: rules.length, tone: 'text-fg' },
                { label: 'Active', value: rules.filter(r => r.isActive).length, tone: 'text-success' },
                { label: 'Total Runs', value: rules.reduce((s, r) => s + r.runCount, 0), tone: 'text-accent' },
              ].map(stat => (
                <StatTile key={stat.label} label={stat.label} value={<span className={`tabular-nums ${stat.tone}`}>{stat.value}</span>} />
              ))}
            </div>
          )}

          {/* Rules list */}
          {isLoading ? (
            <div className="space-y-3" aria-hidden="true">
              <SkeletonCard lines={3} /><SkeletonCard lines={3} /><SkeletonCard lines={3} />
            </div>
          ) : rules.length === 0 ? (
            <EmptyState
              icon={<Zap />}
              title="No automation rules yet"
              description="Create your first rule to automatically assign tickets, send follow-up emails, or update record statuses."
              action={{ label: 'Create first rule', onClick: () => { setEditingRule(null); setShowEditor(true); } }}
            />
          ) : (
            <div className="space-y-3">
              {rules.map(rule => (
                <Card key={rule.id} data-testid="workflow-rule" padding="sm" className="hover:border-accent/40 transition-colors overflow-hidden">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {/* Active toggle */}
                      <IconButton
                        size="md"
                        className="mt-0.5"
                        label={rule.isActive ? 'Deactivate rule' : 'Activate rule'}
                        icon={rule.isActive
                          ? <ToggleRight size={22} className="text-accent" />
                          : <ToggleLeft size={22} className="text-fg-subtle" />}
                        onClick={() => toggleRule.mutate(rule.id)}
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-medium text-sm truncate max-w-full ${rule.isActive ? 'text-fg' : 'text-fg-subtle'}`}>
                            {rule.name}
                          </span>
                          <Badge variant="purple" className="shrink-0">
                            {TRIGGERS.find(t => t.value === rule.trigger)?.label || rule.trigger}
                          </Badge>
                        </div>
                        {rule.description && (
                          <p className="text-xs text-fg-subtle mt-0.5 truncate">{rule.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                          <span className="text-xs text-fg-subtle tabular-nums">{rule.conditions.length} condition{rule.conditions.length !== 1 ? 's' : ''}</span>
                          <span className="text-line-strong">·</span>
                          <span className="text-xs text-fg-subtle tabular-nums">{rule.actions.length} action{rule.actions.length !== 1 ? 's' : ''}</span>
                          <span className="text-line-strong">·</span>
                          <span className="text-xs text-fg-subtle tabular-nums">{rule.runCount} run{rule.runCount !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                    </div>

                    <RowActions items={[
                      ...(rule.trigger === 'DATE_FIELD_REACHED' ? [{
                        label: 'Preview matches', icon: <Play size={14} />,
                        // Two steps on purpose. This used to be one click
                        // labelled "Run now (test)" that sent real emails and
                        // WhatsApp messages to every matching record.
                        onClick: () => runDateRule.mutate({ id: rule.id, dryRun: true }, {
                          onSuccess: (res: any) => {
                            if (!res.matched) return addToast(res.message, 'info');
                            const go = window.confirm(
                              `${res.matched} record(s) match "${rule.name}".\n\n` +
                              'Running it now will send this rule\'s real emails, WhatsApp messages and notifications ' +
                              'to those records immediately.\n\nSend them now?'
                            );
                            if (!go) return addToast(`${res.matched} match — nothing sent`, 'info');
                            runDateRule.mutate({ id: rule.id, dryRun: false }, {
                              onSuccess: (r2: any) => addToast(r2.message, 'success'),
                              onError: (err: any) => addToast(err?.response?.data?.error || 'Failed to run rule', 'error'),
                            });
                          },
                          onError: (err: any) => addToast(err?.response?.data?.error || 'Failed to run rule', 'error'),
                        }),
                      }] : []),
                      { label: 'View logs', icon: <Eye size={14} />, onClick: () => setLogsFor({ id: rule.id, name: rule.name }) },
                      { label: 'Edit', icon: <Edit2 size={14} />, onClick: () => { setEditingRule(rule); setShowEditor(true); } },
                      { label: 'Delete', icon: <Trash2 size={14} />, onClick: () => { if (confirm('Delete this rule?')) deleteRule.mutate(rule.id); }, variant: 'danger' },
                    ]} />
                  </div>

                  {/* Conditions + Actions preview */}
                  {(rule.conditions.length > 0 || rule.actions.length > 0) && (
                    <div className="mt-3 flex flex-wrap gap-1.5 sm:pl-9">
                      {rule.conditions.map((c, i) => (
                        <Badge key={i} variant="blue" className="max-w-full truncate">
                          {c.field} {c.operator} "{c.value}"
                        </Badge>
                      ))}
                      {rule.actions.map((a, i) => (
                        <Badge key={i} variant="green">
                          → {ACTION_TYPES.find(t => t.value === a.type)?.label || a.type}
                        </Badge>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </PageBody>
      </div>

      {showEditor && (
        <RuleEditor
          initial={editingRule ? {
            name: editingRule.name,
            description: editingRule.description,
            trigger: editingRule.trigger,
            conditions: editingRule.conditions,
            actions: editingRule.actions,
            isActive: editingRule.isActive,
            dateConfig: editingRule.dateConfig,
          } : empty()}
          onSave={handleSave}
          onClose={() => { setShowEditor(false); setEditingRule(null); }}
          saving={createRule.isPending || updateRule.isPending}
        />
      )}

      {logsFor && <LogsDrawer ruleId={logsFor.id} ruleName={logsFor.name} onClose={() => setLogsFor(null)} />}
    </div>
  );
}
