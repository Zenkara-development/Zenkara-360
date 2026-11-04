import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';

const ENTITY_TYPES = ['TICKET', 'CONTACT', 'DEAL', 'LEAD'] as const;
// NOTE: 'TEXTAREA' added — the admin UI (CustomFieldsPage.tsx) has offered a
// "Long Text" (TEXTAREA) option since it was built, but this enum never
// included it, so creating a TEXTAREA field always failed Zod validation.
// 'REFERENCE' — a field whose value is another record's id rather than a
// plain string; currently always points at a Contact (see
// CustomFieldsFormFields.tsx's contact picker and CustomFieldsDisplay.tsx's
// name lookup). Stored the same way as every other field type — a plain
// string in CustomFieldValue.value — so no schema change was needed, only
// how the client renders/resolves it.
const FIELD_TYPES  = ['TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN', 'TEXTAREA', 'REFERENCE'] as const;

// Maps entityType -> the Prisma model used to verify an entityId actually
// belongs to the caller's org before reading/writing custom field values.
// Mirrors the assertEntityInOrg pattern used in comments.controller.ts.
const ENTITY_MODEL: Record<string, { findFirst: (args: any) => Promise<any> }> = {
  TICKET:  prisma.ticket,
  CONTACT: prisma.contact,
  DEAL:    prisma.deal,
  LEAD:    prisma.lead,
};

async function findEntityInOrg(entityId: string, orgId: string) {
  for (const model of Object.values(ENTITY_MODEL)) {
    const record = await model.findFirst({ where: { id: entityId, orgId }, select: { id: true } });
    if (record) return true;
  }
  return false;
}

// Only SELECT and BOOLEAN can act as a parent in a visibility rule: a rule is
// "parent's value is one of these", which needs a knowable set of values to
// choose from. A free-text parent would mean asking an admin to type values
// that must match user input exactly — a rule that silently never fires.
const PARENT_FIELD_TYPES = ['SELECT', 'BOOLEAN'] as const;
const BOOLEAN_VALUES = ['true', 'false'];

const FieldSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  label:      z.string().min(1).max(100),
  fieldKey:   z.string().min(1).max(50).regex(/^[a-z0-9_]+$/, 'Only lowercase letters, numbers, underscores'),
  fieldType:  z.enum(FIELD_TYPES),
  options:    z.array(z.string()).optional(),
  required:   z.boolean().default(false),
  position:   z.number().int().default(0),
  /** Prefilled into create forms. Validated against fieldType below. */
  defaultValue: z.string().max(500).nullable().optional(),
  /** Conditional visibility: both set together, or both null. */
  dependsOnFieldId: z.string().nullable().optional(),
  dependsOnValues:  z.array(z.string()).nullable().optional(),
});

/**
 * Checks a default value actually makes sense for the field's own type, so a
 * misconfiguration surfaces here rather than as an unparseable string sitting
 * in every new record's form.
 */
function assertValidDefault(fieldType: string, options: string[] | undefined, value: string | null | undefined) {
  if (value === null || value === undefined || value === '') return;
  if (fieldType === 'SELECT') {
    if (!options?.includes(value)) {
      throw new AppError(400, `Default value "${value}" is not one of this field's options.`);
    }
  } else if (fieldType === 'BOOLEAN') {
    if (!BOOLEAN_VALUES.includes(value)) {
      throw new AppError(400, 'Default value for a Yes/No field must be "true" or "false".');
    }
  } else if (fieldType === 'NUMBER') {
    if (Number.isNaN(Number(value))) {
      throw new AppError(400, `Default value "${value}" is not a number.`);
    }
  } else if (fieldType === 'DATE') {
    if (Number.isNaN(Date.parse(value))) {
      throw new AppError(400, `Default value "${value}" is not a valid date (expected YYYY-MM-DD).`);
    }
  }
  // TEXT / TEXTAREA / REFERENCE accept any string.
}

/**
 * Validates a visibility rule against the parent it names.
 *
 * `selfId` is the field being edited, so a field cannot depend on itself, and
 * so a chain that loops back round to it is rejected. Without the loop check,
 * A-shows-when-B and B-shows-when-A would leave both fields permanently
 * invisible with no way to fix them from the UI — each one's editor would be
 * hidden behind the other.
 */
async function assertValidDependency(
  orgId: string,
  entityType: string,
  selfId: string | null,
  dependsOnFieldId: string | null | undefined,
  dependsOnValues: string[] | null | undefined,
) {
  if (!dependsOnFieldId) {
    if (dependsOnValues && dependsOnValues.length) {
      throw new AppError(400, 'Pick the field this one depends on before choosing which values reveal it.');
    }
    return;
  }
  if (selfId && dependsOnFieldId === selfId) {
    throw new AppError(400, 'A field cannot depend on itself.');
  }
  if (!dependsOnValues || dependsOnValues.length === 0) {
    throw new AppError(400, 'Choose at least one value that reveals this field.');
  }

  const parent = await prisma.customField.findFirst({
    where: { id: dependsOnFieldId, orgId },
  });
  if (!parent) throw new AppError(404, 'The field this one depends on no longer exists.');

  // Cross-entity rules can never be satisfied — the two fields never appear on
  // the same form.
  if (parent.entityType !== entityType) {
    throw new AppError(400, `"${parent.label}" belongs to a different record type, so it can never control this field.`);
  }
  if (!PARENT_FIELD_TYPES.includes(parent.fieldType as any)) {
    throw new AppError(400, `"${parent.label}" is a ${parent.fieldType.toLowerCase()} field. Only dropdown and Yes/No fields can control another field.`);
  }

  const allowed = parent.fieldType === 'BOOLEAN'
    ? BOOLEAN_VALUES
    : ((parent.options as string[] | null) ?? []);
  const unknown = dependsOnValues.filter(v => !allowed.includes(v));
  if (unknown.length) {
    throw new AppError(400, `"${parent.label}" has no option ${unknown.map(u => `"${u}"`).join(', ')}.`);
  }

  // Walk up the chain from the parent. Any revisit is a loop; the selfId check
  // above covers the direct case, this covers A -> B -> A and longer.
  if (selfId) {
    const seen = new Set<string>([selfId]);
    let cursor: string | null = parent.id;
    while (cursor) {
      if (seen.has(cursor)) {
        throw new AppError(400, 'That would create a loop — these fields would end up hiding each other.');
      }
      seen.add(cursor);
      const next: { dependsOnFieldId: string | null } | null = await prisma.customField.findUnique({
        where: { id: cursor },
        select: { dependsOnFieldId: true },
      });
      cursor = next?.dependsOnFieldId ?? null;
    }
  }
}

// ─── Field definitions (admin) ────────────────────────────────────────────────

export async function listFields(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { entityType } = req.query as { entityType?: string };
    const where: any = { orgId: req.user!.orgId };
    if (entityType) where.entityType = entityType;
    const fields = await prisma.customField.findMany({
      where, orderBy: [{ entityType: 'asc' }, { position: 'asc' }],
    });
    res.json({ data: fields });
  } catch (err) { next(err); }
}

export async function createField(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = FieldSchema.parse(req.body);
    assertValidDefault(data.fieldType, data.options, data.defaultValue);
    await assertValidDependency(orgId, data.entityType, null, data.dependsOnFieldId, data.dependsOnValues);
    const field = await prisma.customField.create({
      data: {
        ...data,
        orgId,
        options: data.options ? data.options : undefined,
        // A rule is stored as a pair; clearing one clears the other, so a
        // half-rule can never reach the database.
        dependsOnFieldId: data.dependsOnFieldId ?? null,
        dependsOnValues: data.dependsOnFieldId ? (data.dependsOnValues ?? []) : Prisma.DbNull,
      },
    });
    res.status(201).json(field);
  } catch (err) { next(err); }
}

export async function updateField(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = FieldSchema.partial().omit({ entityType: true, fieldKey: true }).parse(req.body);
    const field = await prisma.customField.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
    });
    if (!field) throw new AppError(404, 'Custom field not found');

    // Validate against the field as it will be AFTER this patch, not as it is
    // now — otherwise changing type and default in one request checks the new
    // default against the old type.
    const nextType    = data.fieldType ?? field.fieldType;
    const nextOptions = data.options ?? ((field.options as string[] | null) ?? undefined);
    if (data.defaultValue !== undefined) {
      assertValidDefault(nextType, nextOptions, data.defaultValue);
    }
    if (data.dependsOnFieldId !== undefined || data.dependsOnValues !== undefined) {
      await assertValidDependency(
        req.user!.orgId,
        field.entityType,
        field.id,
        data.dependsOnFieldId !== undefined ? data.dependsOnFieldId : field.dependsOnFieldId,
        data.dependsOnValues !== undefined ? data.dependsOnValues : (field.dependsOnValues as string[] | null),
      );
    }

    // Narrowing a dropdown's options can strip a value that some child field's
    // rule refers to, leaving a rule that can never fire. Prune those rules to
    // whatever options survive rather than leaving a silently dead condition.
    if (data.options && (field.fieldType === 'SELECT' || nextType === 'SELECT')) {
      const surviving = new Set(data.options);
      const children = await prisma.customField.findMany({ where: { dependsOnFieldId: field.id } });
      for (const child of children) {
        const vals = ((child.dependsOnValues as string[] | null) ?? []).filter(v => surviving.has(v));
        if (vals.length !== ((child.dependsOnValues as string[] | null) ?? []).length) {
          // A rule with nothing left to match on would hide the child forever,
          // so it reverts to unconditional instead.
          const pruned: Prisma.CustomFieldUncheckedUpdateInput = vals.length
            ? { dependsOnValues: vals }
            : { dependsOnFieldId: null, dependsOnValues: Prisma.DbNull };
          await prisma.customField.update({ where: { id: child.id }, data: pruned });
        }
      }
    }

    /* Built key by key against one concrete Prisma input type rather than
       spreading the parsed body.
       `dependsOnFieldId` only exists on the *unchecked* update input (declaring
       the `dependsOn` relation moves it there), while a plain `null` is not a
       legal value for a Json column — those want Prisma.DbNull. Spreading the
       Zod output offered TypeScript a shape that matched neither branch of the
       union, so it rejected both. Naming the type makes the compiler check
       against exactly one shape, and makes "unset" vs "leave alone" explicit
       for every column. */
    const updateData: Prisma.CustomFieldUncheckedUpdateInput = {};
    if (data.label !== undefined)        updateData.label = data.label;
    if (data.fieldType !== undefined)    updateData.fieldType = data.fieldType;
    if (data.required !== undefined)     updateData.required = data.required;
    if (data.position !== undefined)     updateData.position = data.position;
    if (data.options !== undefined)      updateData.options = data.options;
    if (data.defaultValue !== undefined) updateData.defaultValue = data.defaultValue;

    if (data.dependsOnFieldId !== undefined) {
      // A rule is a pair: choosing a parent sets both halves, clearing the
      // parent clears both. Json columns take Prisma.DbNull, never null.
      updateData.dependsOnFieldId = data.dependsOnFieldId ?? null;
      updateData.dependsOnValues  = data.dependsOnFieldId
        ? (data.dependsOnValues ?? [])
        : Prisma.DbNull;
    } else if (data.dependsOnValues !== undefined) {
      // Trigger values changed while keeping the same parent.
      updateData.dependsOnValues = data.dependsOnValues ?? Prisma.DbNull;
    }

    const updated = await prisma.customField.update({
      where: { id: req.params.id },
      data: updateData,
    });
    res.json(updated);
  } catch (err) { next(err); }
}

export async function deleteField(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.customField.deleteMany({ where: { id: req.params.id, orgId: req.user!.orgId } });
    res.json({ message: 'Field deleted' });
  } catch (err) { next(err); }
}

// ─── Field values (per entity) ────────────────────────────────────────────────

export async function getValues(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { entityId } = req.params;
    const orgId = req.user!.orgId;
    // entityId is polymorphic (ticket/contact/deal/lead) — verify it belongs
    // to *some* record in the caller's org before returning anything, so a
    // user can't probe another org's entities by guessing/enumerating ids.
    const inOrg = await findEntityInOrg(entityId, orgId);
    if (!inOrg) throw new AppError(404, 'Not found');

    const values = await prisma.customFieldValue.findMany({
      where: { entityId, field: { orgId } },
      include: { field: true },
    });
    res.json({ data: values });
  } catch (err) { next(err); }
}

export async function setValues(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { entityId } = req.params;
    const orgId = req.user!.orgId;
    const { values } = z.object({
      values: z.array(z.object({ customFieldId: z.string(), value: z.string().nullable() })),
    }).parse(req.body);

    const inOrg = await findEntityInOrg(entityId, orgId);
    if (!inOrg) throw new AppError(404, 'Not found');

    // Verify every referenced field definition belongs to the caller's org
    // before writing — otherwise a user could attach values to another
    // org's field definitions (or to arbitrary customFieldIds).
    const fieldIds = values.map(v => v.customFieldId);
    const ownedFields = await prisma.customField.findMany({
      where: { id: { in: fieldIds }, orgId },
      select: { id: true },
    });
    const ownedIds = new Set(ownedFields.map(f => f.id));
    const filtered = values.filter(v => ownedIds.has(v.customFieldId));

    await Promise.all(filtered.map(v =>
      prisma.customFieldValue.upsert({
        where: { customFieldId_entityId: { customFieldId: v.customFieldId, entityId } },
        create: { customFieldId: v.customFieldId, entityId, value: v.value },
        update: { value: v.value },
      })
    ));

    res.json({ message: 'Values saved' });
  } catch (err) { next(err); }
}
