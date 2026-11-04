import { CustomModuleField } from '@prisma/client';
import { AppError } from '../../middleware/errorHandler';

export const FIELD_TYPES = [
  'TEXT', 'TEXTAREA', 'NUMBER', 'CURRENCY', 'DATE', 'BOOLEAN', 'DROPDOWN', 'EMAIL', 'PHONE', 'URL',
  // Phase 2: points at a record of another (or the same) custom module —
  // the field's relationModuleId names the target module, and the record
  // stores the target record's id in data[fieldKey]. Existence of the target
  // record is checked in the controller (needs DB access), not here.
  'RELATION',
] as const;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60) || 'module';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Coerces + validates a raw record payload against a module's field schema,
 * used by both the manual record-create/update endpoints and the external
 * polling sync (customModuleSync.ts) — "getting and validating the data" is
 * the same code path either way, so a synced record can't skip checks a
 * manually-entered one would hit. Returns only known fieldKeys (strips
 * anything not defined on the module) and throws AppError(400) with every
 * problem found, not just the first, so a sync job can log one useful error
 * instead of retrying field-by-field.
 */
export function validateRecordData(
  fields: CustomModuleField[],
  raw: Record<string, unknown>,
  opts: { partial?: boolean } = {}
): Record<string, unknown> {
  const errors: string[] = [];
  const out: Record<string, unknown> = {};

  for (const field of fields) {
    const has = Object.prototype.hasOwnProperty.call(raw, field.fieldKey);
    if (!has) {
      if (field.required && !opts.partial) errors.push(`"${field.label}" is required`);
      continue;
    }
    const value = raw[field.fieldKey];
    if (value === null || value === undefined || value === '') {
      if (field.required) errors.push(`"${field.label}" is required`);
      out[field.fieldKey] = null;
      continue;
    }

    switch (field.fieldType) {
      case 'NUMBER':
      case 'CURRENCY': {
        const n = typeof value === 'number' ? value : Number(value);
        if (Number.isNaN(n)) { errors.push(`"${field.label}" must be a number`); break; }
        out[field.fieldKey] = n;
        break;
      }
      case 'BOOLEAN': {
        if (typeof value === 'boolean') { out[field.fieldKey] = value; break; }
        if (value === 'true' || value === 'false') { out[field.fieldKey] = value === 'true'; break; }
        errors.push(`"${field.label}" must be true/false`);
        break;
      }
      case 'DATE': {
        const d = new Date(value as any);
        if (Number.isNaN(d.getTime())) { errors.push(`"${field.label}" must be a valid date`); break; }
        out[field.fieldKey] = d.toISOString();
        break;
      }
      case 'EMAIL': {
        if (typeof value !== 'string' || !EMAIL_RE.test(value)) { errors.push(`"${field.label}" must be a valid email`); break; }
        out[field.fieldKey] = value;
        break;
      }
      case 'DROPDOWN': {
        const options = Array.isArray(field.options) ? (field.options as unknown[]).map(String) : [];
        if (options.length && !options.includes(String(value))) {
          errors.push(`"${field.label}" must be one of: ${options.join(', ')}`);
          break;
        }
        out[field.fieldKey] = String(value);
        break;
      }
      default: // TEXT, TEXTAREA, PHONE, URL, RELATION — stored as-is (stringified;
        // RELATION holds the target record's id, verified in the controller)
        out[field.fieldKey] = String(value);
    }
  }

  if (errors.length) throw new AppError(400, errors.join('; '));
  return out;
}

/** The record's display title in list views — the primary field's value, falling back to the record id. */
export function recordTitle(fields: CustomModuleField[], data: Record<string, unknown>, fallbackId: string): string {
  const primary = fields.find(f => f.isPrimary) || fields[0];
  if (!primary) return fallbackId;
  const v = data[primary.fieldKey];
  return v === null || v === undefined || v === '' ? fallbackId : String(v);
}

// ─── Starter templates ──────────────────────────────────────────────────────
//
// Pre-built field sets an admin can start a new module from instead of
// adding every field by hand — purely a convenience layer over the same
// CustomModule/CustomModuleField creation the manual flow already does (see
// createModule() in customModules.controller.ts, which creates all of a
// template's fields in one transaction). Hardcoded here rather than stored
// per-org, since these are meant as generic starting points every org gets,
// not something an org customizes — "save a module as a reusable template"
// is a different feature this doesn't attempt.

export interface ModuleTemplateField {
  label: string;
  fieldType: (typeof FIELD_TYPES)[number];
  options?: string[];
  required?: boolean;
  isPrimary?: boolean;
}

export interface ModuleTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  navSection: 'CRM' | 'IT_DESK' | 'HR' | 'ADMIN';
  fields: ModuleTemplateField[];
}

export const MODULE_TEMPLATES: ModuleTemplate[] = [
  {
    id: 'vendor-contracts',
    name: 'Vendor Contracts',
    description: 'Track vendor agreements, renewal dates, and contract value.',
    icon: 'Briefcase',
    navSection: 'ADMIN',
    fields: [
      { label: 'Vendor Name', fieldType: 'TEXT', required: true, isPrimary: true },
      { label: 'Contract Value', fieldType: 'CURRENCY' },
      { label: 'Start Date', fieldType: 'DATE' },
      { label: 'End Date', fieldType: 'DATE' },
      { label: 'Status', fieldType: 'DROPDOWN', options: ['Active', 'Pending Renewal', 'Expired'] },
    ],
  },
  {
    id: 'asset-registry',
    name: 'Asset Registry',
    description: 'A lightweight equipment/asset log with serial numbers and warranty dates.',
    icon: 'Boxes',
    navSection: 'IT_DESK',
    fields: [
      { label: 'Asset Name', fieldType: 'TEXT', required: true, isPrimary: true },
      { label: 'Serial Number', fieldType: 'TEXT' },
      { label: 'Purchase Date', fieldType: 'DATE' },
      { label: 'Warranty Expiry', fieldType: 'DATE' },
      { label: 'Status', fieldType: 'DROPDOWN', options: ['In Use', 'In Storage', 'Retired'] },
    ],
  },
  {
    id: 'warranty-claims',
    name: 'Warranty Claims',
    description: 'Log warranty claims against products, with amount and outcome.',
    icon: 'ClipboardList',
    navSection: 'IT_DESK',
    fields: [
      { label: 'Claim Title', fieldType: 'TEXT', required: true, isPrimary: true },
      { label: 'Product', fieldType: 'TEXT' },
      { label: 'Claim Amount', fieldType: 'CURRENCY' },
      { label: 'Filed Date', fieldType: 'DATE' },
      { label: 'Status', fieldType: 'DROPDOWN', options: ['Open', 'Approved', 'Rejected'] },
    ],
  },
  {
    id: 'employee-equipment',
    name: 'Employee Equipment',
    description: 'Track which equipment has been issued to which employee.',
    icon: 'Tag',
    navSection: 'HR',
    fields: [
      { label: 'Employee Name', fieldType: 'TEXT', required: true, isPrimary: true },
      { label: 'Equipment', fieldType: 'TEXT', required: true },
      { label: 'Issued Date', fieldType: 'DATE' },
      { label: 'Returned', fieldType: 'BOOLEAN' },
    ],
  },
];

export function getModuleTemplate(id: string): ModuleTemplate | undefined {
  return MODULE_TEMPLATES.find(t => t.id === id);
}
