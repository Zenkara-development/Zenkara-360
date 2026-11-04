import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { logAction } from '../../utils/auditLog';
import { runWorkflows } from '../../utils/workflow-engine';
import { parsePagination, paginate } from '../../utils/pagination';
import { FIELD_TYPES, slugify, validateRecordData, recordTitle, MODULE_TEMPLATES, getModuleTemplate } from './customModules.service';

const NAV_SECTIONS = ['CRM', 'IT_DESK', 'HR', 'ADMIN'] as const;

const ModuleSchema = z.object({
  name: z.string().min(1).max(80),
  icon: z.string().max(40).optional(),
  description: z.string().max(500).optional(),
  // Deliberately .optional() with NO .default() here, even though every
  // create ends up with a real value — this schema is reused via
  // ModuleSchema.partial() for updateModule, and Zod's `.default()` still
  // fires on a key that's entirely absent even after `.partial()`, which
  // would silently reset an existing module's section back to CRM on any
  // partial update that doesn't happen to touch navSection. Falling back to
  // 'CRM' is instead done explicitly in createModule; updateModule passes
  // `undefined` straight through to Prisma, which leaves the column alone.
  navSection: z.enum(NAV_SECTIONS).optional(),
});

// Only used by createModule — templateId doesn't belong on ModuleSchema
// itself since updateModule reuses ModuleSchema.partial() and applying a
// template is strictly a one-time, create-time convenience (see the
// transaction in createModule below).
const CreateModuleSchema = ModuleSchema.extend({
  templateId: z.string().optional(),
});

const FieldSchema = z.object({
  label: z.string().min(1).max(80),
  fieldKey: z.string().min(1).max(50).regex(/^[a-z0-9_]+$/, 'Only lowercase letters, numbers, underscores').optional(),
  fieldType: z.enum(FIELD_TYPES),
  options: z.array(z.string()).optional(),
  required: z.boolean().default(false),
  isPrimary: z.boolean().default(false),
  position: z.number().int().default(0),
  // RELATION fields only: the CustomModule this field points at (must be in
  // the same org — checked in addField, since it needs a DB lookup)…
  relationModuleId: z.string().optional(),
  // …OR a core entity target. Exactly one of the two for RELATION fields.
  relationEntity: z.enum(['CONTACT', 'ACCOUNT', 'DEAL', 'TICKET']).optional(),
});

// Core-entity relation plumbing — one place that knows, per entity, how to
// check existence and how to read a display title, shared by field
// validation, title resolution, and the universal related view.
export const CORE_RELATION_TARGETS = {
  CONTACT: {
    label: 'Contact',
    find: (id: string, orgId: string) => prisma.contact.findFirst({ where: { id, orgId }, select: { id: true, name: true } }),
    findMany: (ids: string[], orgId: string) => prisma.contact.findMany({ where: { id: { in: ids }, orgId }, select: { id: true, name: true } }),
    titleOf: (r: any) => r.name as string,
  },
  ACCOUNT: {
    label: 'Account',
    find: (id: string, orgId: string) => prisma.account.findFirst({ where: { id, orgId }, select: { id: true, name: true } }),
    findMany: (ids: string[], orgId: string) => prisma.account.findMany({ where: { id: { in: ids }, orgId }, select: { id: true, name: true } }),
    titleOf: (r: any) => r.name as string,
  },
  DEAL: {
    label: 'Deal',
    find: (id: string, orgId: string) => prisma.deal.findFirst({ where: { id, orgId }, select: { id: true, title: true } }),
    findMany: (ids: string[], orgId: string) => prisma.deal.findMany({ where: { id: { in: ids }, orgId }, select: { id: true, title: true } }),
    titleOf: (r: any) => r.title as string,
  },
  TICKET: {
    label: 'Ticket',
    find: (id: string, orgId: string) => prisma.ticket.findFirst({ where: { id, orgId }, select: { id: true, title: true } }),
    findMany: (ids: string[], orgId: string) => prisma.ticket.findMany({ where: { id: { in: ids }, orgId }, select: { id: true, title: true } }),
    titleOf: (r: any) => r.title as string,
  },
} as const;
export type CoreRelationEntity = keyof typeof CORE_RELATION_TARGETS;

// Pipeline stages (Phase 2) — ordered, small, and keyed. Keys are what
// records store; labels/colors are presentation. Colors are named tokens the
// client maps to its theme palette, never raw hex, so boards stay legible in
// dark mode.
const STAGE_COLORS = ['slate', 'blue', 'cyan', 'teal', 'emerald', 'amber', 'orange', 'rose', 'violet', 'indigo'] as const;
const StagesSchema = z.array(z.object({
  key: z.string().min(1).max(40).regex(/^[a-z0-9_-]+$/, 'Stage keys: lowercase letters, numbers, - and _'),
  label: z.string().trim().min(1).max(40),
  color: z.enum(STAGE_COLORS).optional(),
})).max(12)
  .refine(st => new Set(st.map(s => s.key)).size === st.length, 'Stage keys must be unique');

type Stage = z.infer<typeof StagesSchema>[number];
const moduleStages = (m: { stages?: unknown } | null | undefined): Stage[] =>
  Array.isArray((m as any)?.stages) ? ((m as any).stages as Stage[]) : [];

// ─── Modules (admin) ────────────────────────────────────────────────────────

export async function listModules(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const modules = await prisma.customModule.findMany({
      where: { orgId: req.user!.orgId },
      include: { _count: { select: { fields: true, records: true } }, syncConfig: { select: { isActive: true, lastSyncAt: true, lastStatus: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json(modules);
  } catch (err) { next(err); }
}

/** GET /custom-modules/templates — starter templates for the "New Module" picker. */
export async function listModuleTemplates(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(MODULE_TEMPLATES.map(t => ({
      id: t.id, name: t.name, description: t.description, icon: t.icon,
      navSection: t.navSection, fieldCount: t.fields.length,
    })));
  } catch (err) { next(err); }
}

export async function createModule(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = CreateModuleSchema.parse(req.body);
    let slug = slugify(data.name);
    let suffix = 0;
    // slug must be unique per org — append -2, -3, ... on collision rather
    // than erroring, since two orgs (or two admins) independently naming a
    // module "Warranty Claims" shouldn't require them to pick a slug by hand.
    while (await prisma.customModule.findFirst({ where: { orgId, slug: suffix ? `${slug}-${suffix}` : slug } })) {
      suffix += 1;
    }
    if (suffix) slug = `${slug}-${suffix}`;

    const template = data.templateId ? getModuleTemplate(data.templateId) : undefined;
    if (data.templateId && !template) throw new AppError(400, 'Unknown template');

    // Module + its starter fields are created together — a template that
    // succeeded at creating the module but silently dropped half its fields
    // (e.g. a mid-request failure) would be a confusing, hard-to-notice
    // partial state, so this is one transaction rather than a create()
    // followed by a loop of separate field creates.
    const module_ = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.customModule.create({
        data: {
          orgId, name: data.name, slug, description: data.description, createdBy: req.user!.id,
          icon: data.icon || template?.icon || 'Layers',
          // Explicit user choice wins; otherwise fall back to the template's
          // suggested section, then finally CRM — see ModuleSchema's comment
          // on why this default isn't baked into the schema itself.
          navSection: data.navSection || template?.navSection || 'CRM',
        },
      });
      if (template) {
        await tx.customModuleField.createMany({
          data: template.fields.map((f, i) => ({
            moduleId: created.id,
            label: f.label,
            fieldKey: slugify(f.label).replace(/-/g, '_'),
            fieldType: f.fieldType,
            options: f.options,
            required: !!f.required,
            isPrimary: !!f.isPrimary,
            position: i,
          })),
        });
      }
      return created;
    });

    logAction(req.user!.id, 'CREATE', 'CustomModule', module_.id, { name: module_.name, templateId: data.templateId });
    res.status(201).json(module_);
  } catch (err) { next(err); }
}

export async function getModule(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const module_ = await prisma.customModule.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
      include: { fields: { orderBy: { position: 'asc' } }, syncConfig: true, _count: { select: { records: true } } },
    });
    if (!module_) throw new AppError(404, 'Custom module not found');
    res.json(module_);
  } catch (err) { next(err); }
}

export async function updateModule(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = ModuleSchema.partial().extend({
      isActive: z.boolean().optional(),
      // Pipeline config: an array to (re)define stages, or null to remove the
      // pipeline (the board disappears; records keep their stage value inertly).
      stages: StagesSchema.nullable().optional(),
      // Ordered fieldKeys for list-view columns; null = default.
      listColumns: z.array(z.string().max(50)).max(10).nullable().optional(),
    }).parse(req.body);
    const existing = await prisma.customModule.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!existing) throw new AppError(404, 'Custom module not found');
    const { stages, listColumns, ...rest } = data;
    const module_ = await prisma.customModule.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        ...(stages !== undefined && { stages: stages === null ? Prisma.JsonNull : stages }),
        ...(listColumns !== undefined && { listColumns: listColumns === null ? Prisma.JsonNull : listColumns }),
      },
    });
    res.json(module_);
  } catch (err) { next(err); }
}

export async function deleteModule(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.customModule.deleteMany({ where: { id: req.params.id, orgId: req.user!.orgId } });
    logAction(req.user!.id, 'DELETE', 'CustomModule', req.params.id);
    res.json({ message: 'Module deleted' });
  } catch (err) { next(err); }
}

// ─── Fields (schema builder) ──────────────────────────────────────────────────

async function assertModuleInOrg(moduleId: string, orgId: string) {
  const module_ = await prisma.customModule.findFirst({ where: { id: moduleId, orgId } });
  if (!module_) throw new AppError(404, 'Custom module not found');
  return module_;
}

export async function addField(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const module_ = await assertModuleInOrg(req.params.id, orgId);
    const data = FieldSchema.parse(req.body);
    const fieldKey = data.fieldKey || slugify(data.label).replace(/-/g, '_');

    const existing = await prisma.customModuleField.findUnique({ where: { moduleId_fieldKey: { moduleId: module_.id, fieldKey } } });
    if (existing) throw new AppError(400, `A field with key "${fieldKey}" already exists on this module`);

    // RELATION fields must point at exactly one target: a module in the same
    // org (the same module is fine — parent/child links) OR a core entity.
    // Non-RELATION fields never carry a target, whatever the client sent.
    let relationModuleId: string | null = null;
    let relationEntity: string | null = null;
    if (data.fieldType === 'RELATION') {
      if (data.relationEntity) {
        relationEntity = data.relationEntity;
      } else if (data.relationModuleId) {
        const target = await prisma.customModule.findFirst({ where: { id: data.relationModuleId, orgId } });
        if (!target) throw new AppError(400, 'Relation target module not found in this organization');
        relationModuleId = target.id;
      } else {
        throw new AppError(400, 'Relation fields need a target — another module, or a core record type (contact, account, deal, ticket)');
      }
    }

    if (data.isPrimary) {
      await prisma.customModuleField.updateMany({ where: { moduleId: module_.id, isPrimary: true }, data: { isPrimary: false } });
    }

    const field = await prisma.customModuleField.create({
      data: { moduleId: module_.id, label: data.label, fieldKey, fieldType: data.fieldType, options: data.options, required: data.required, isPrimary: data.isPrimary, position: data.position, relationModuleId, relationEntity },
    });
    res.status(201).json(field);
  } catch (err) { next(err); }
}

export async function updateField(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const module_ = await assertModuleInOrg(req.params.id, orgId);
    // fieldKey is immutable (records key their data by it); relationModuleId
    // too — retargeting an existing relation field would silently turn every
    // stored id into a dangling pointer. Delete + recreate is the honest path.
    const data = FieldSchema.partial().omit({ fieldKey: true, relationModuleId: true, relationEntity: true }).parse(req.body);
    const field = await prisma.customModuleField.findFirst({ where: { id: req.params.fieldId, moduleId: module_.id } });
    if (!field) throw new AppError(404, 'Field not found');

    if (data.isPrimary) {
      await prisma.customModuleField.updateMany({ where: { moduleId: module_.id, isPrimary: true, id: { not: field.id } }, data: { isPrimary: false } });
    }

    const updated = await prisma.customModuleField.update({ where: { id: field.id }, data });
    res.json(updated);
  } catch (err) { next(err); }
}

export async function removeField(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const module_ = await assertModuleInOrg(req.params.id, req.user!.orgId);
    await prisma.customModuleField.deleteMany({ where: { id: req.params.fieldId, moduleId: module_.id } });
    res.json({ message: 'Field deleted' });
  } catch (err) { next(err); }
}

// ─── Records ───────────────────────────────────────────────────────────────────

/**
 * RELATION integrity — every relation value in `data` must be the id of a
 * live record in that field's target module (same org). Batched per field.
 * Runs after validateRecordData, which has already stringified the ids.
 */
async function verifyRelations(fields: { fieldKey: string; fieldType: string; label: string; relationModuleId: string | null; relationEntity?: string | null }[], data: Record<string, unknown>, orgId: string) {
  for (const f of fields) {
    if (f.fieldType !== 'RELATION') continue;
    const v = data[f.fieldKey];
    if (v === null || v === undefined || v === '') continue;
    let target: { id: string } | null = null;
    if (f.relationModuleId) {
      target = await prisma.customModuleRecord.findFirst({
        where: { id: String(v), moduleId: f.relationModuleId, orgId }, select: { id: true },
      });
    } else if (f.relationEntity && (f.relationEntity in CORE_RELATION_TARGETS)) {
      target = await CORE_RELATION_TARGETS[f.relationEntity as CoreRelationEntity].find(String(v), orgId);
    } else {
      continue;
    }
    if (!target) throw new AppError(400, `"${f.label}" points at a record that doesn't exist`);
  }
}

/**
 * Resolve relation ids → display titles for a page of records, so list views
 * and boards show "2024 Honda Civic", not a cuid. One batched query per
 * distinct target module, not per record.
 */
async function resolveRelationTitles(fields: any[], records: { data: unknown }[], orgId?: string) {
  const relFields = fields.filter(f => f.fieldType === 'RELATION' && (f.relationModuleId || f.relationEntity));
  if (!relFields.length) return {};
  const idsByModule = new Map<string, Set<string>>();
  const idsByEntity = new Map<string, Set<string>>();
  for (const f of relFields) {
    const bucket = f.relationModuleId ? idsByModule : idsByEntity;
    const key = f.relationModuleId ?? f.relationEntity;
    const set = bucket.get(key) ?? new Set<string>();
    for (const r of records) {
      const v = (r.data as any)?.[f.fieldKey];
      if (v) set.add(String(v));
    }
    bucket.set(key, set);
  }
  const titles: Record<string, string> = {};
  for (const [moduleId, ids] of idsByModule) {
    if (!ids.size) continue;
    const [targetFields, targets] = await Promise.all([
      prisma.customModuleField.findMany({ where: { moduleId }, orderBy: { position: 'asc' } }),
      prisma.customModuleRecord.findMany({ where: { id: { in: [...ids] }, moduleId }, select: { id: true, data: true } }),
    ]);
    for (const t of targets) titles[t.id] = recordTitle(targetFields, t.data as Record<string, unknown>, t.id);
  }
  // Core-entity targets: contacts/accounts by name, deals/tickets by title.
  for (const [entity, ids] of idsByEntity) {
    if (!ids.size || !orgId || !(entity in CORE_RELATION_TARGETS)) continue;
    const def = CORE_RELATION_TARGETS[entity as CoreRelationEntity];
    const targets = await def.findMany([...ids], orgId);
    for (const t of targets) titles[t.id] = def.titleOf(t);
  }
  return titles;
}

export async function listRecords(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const module_ = await assertModuleInOrg(req.params.id, orgId);
    const fields = await prisma.customModuleField.findMany({ where: { moduleId: module_.id }, orderBy: { position: 'asc' } });
    const pag = parsePagination(req);
    // Optional ?stage= filter so the board can lazily fetch one column if it
    // ever needs to; the default board just buckets the normal page client-side.
    const stageFilter = typeof req.query.stage === 'string' && req.query.stage ? { stage: req.query.stage } : {};
    const where = { moduleId: module_.id, orgId, ...stageFilter };
    const [records, total] = await Promise.all([
      prisma.customModuleRecord.findMany({ where, orderBy: { createdAt: 'desc' }, take: pag.limit, skip: pag.skip }),
      prisma.customModuleRecord.count({ where }),
    ]);
    const relationTitles = await resolveRelationTitles(fields, records, orgId);
    const withTitle = records.map(r => ({ ...r, title: recordTitle(fields, r.data as Record<string, unknown>, r.id) }));
    res.json({ ...paginate(withTitle, total, pag), relationTitles });
  } catch (err) { next(err); }
}

export async function getRecord(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const module_ = await assertModuleInOrg(req.params.id, req.user!.orgId);
    const record = await prisma.customModuleRecord.findFirst({ where: { id: req.params.recordId, moduleId: module_.id } });
    if (!record) throw new AppError(404, 'Record not found');
    res.json(record);
  } catch (err) { next(err); }
}

export async function createRecord(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const module_ = await assertModuleInOrg(req.params.id, orgId);
    const fields = await prisma.customModuleField.findMany({ where: { moduleId: module_.id } });
    const data = validateRecordData(fields, req.body?.data ?? req.body ?? {});
    await verifyRelations(fields as any, data, orgId);
    // Stage: explicit value must be one of the module's stage keys; otherwise
    // new records land in the first stage (or null for stage-less modules).
    const stages = moduleStages(module_);
    let stage: string | null = null;
    if (stages.length) {
      const requested = typeof req.body?.stage === 'string' ? req.body.stage : undefined;
      if (requested && !stages.some(s => s.key === requested)) throw new AppError(400, 'Unknown stage');
      stage = requested ?? stages[0].key;
    }
    const record = await prisma.customModuleRecord.create({
      data: { moduleId: module_.id, orgId, data: data as Prisma.InputJsonValue, stage, source: 'MANUAL', createdBy: req.user!.id },
    });
    logAction(req.user!.id, 'CREATE', module_.name, record.id, { moduleId: module_.id });
    /* Automation hook — the record's own fields are spread flat so rule
       conditions address them directly (e.g. `amount gt 5000`); moduleSlug
       lets one rule scope itself to one module ("moduleSlug eq erp-work-orders")
       since CUSTOM_RECORD_CREATED fires for every module in the org. */
    runWorkflows({
      trigger: 'CUSTOM_RECORD_CREATED', orgId, entityType: 'CUSTOM_MODULE_RECORD', entityId: record.id,
      entity: { ...(data as any), id: record.id, moduleId: module_.id, moduleSlug: module_.slug, moduleName: module_.name },
    }).catch(() => {});
    res.status(201).json(record);
  } catch (err) { next(err); }
}

export async function updateRecord(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const module_ = await assertModuleInOrg(req.params.id, orgId);
    const existing = await prisma.customModuleRecord.findFirst({ where: { id: req.params.recordId, moduleId: module_.id } });
    if (!existing) throw new AppError(404, 'Record not found');
    const fields = await prisma.customModuleField.findMany({ where: { moduleId: module_.id } });
    const partialData = validateRecordData(fields, req.body?.data ?? req.body ?? {}, { partial: true });
    await verifyRelations(fields as any, partialData, orgId);
    const record = await prisma.customModuleRecord.update({
      where: { id: existing.id },
      data: { data: { ...(existing.data as object), ...partialData } as Prisma.InputJsonValue },
    });
    res.json(record);
  } catch (err) { next(err); }
}

/**
 * PATCH /custom-modules/:id/records/:recordId/stage — the kanban drag.
 * Its own endpoint (rather than a field on updateRecord) because it's the
 * automation-bearing action: CUSTOM_RECORD_STAGE_CHANGED fires here with
 * both the old and new stage, so rules like "when a Vehicle reaches
 * `delivered`, create a follow-up service job" hang off the move itself.
 */
export async function setRecordStage(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const module_ = await assertModuleInOrg(req.params.id, orgId);
    const stages = moduleStages(module_);
    if (!stages.length) throw new AppError(400, 'This module has no pipeline stages');
    const stage = z.string().parse(req.body?.stage);
    if (!stages.some(s => s.key === stage)) throw new AppError(400, 'Unknown stage');
    const existing = await prisma.customModuleRecord.findFirst({ where: { id: req.params.recordId, moduleId: module_.id } });
    if (!existing) throw new AppError(404, 'Record not found');
    if (existing.stage === stage) return res.json(existing);

    const record = await prisma.customModuleRecord.update({ where: { id: existing.id }, data: { stage } });
    logAction(req.user!.id, 'UPDATE', module_.name, record.id, { stage, previousStage: existing.stage });
    runWorkflows({
      trigger: 'CUSTOM_RECORD_STAGE_CHANGED', orgId, entityType: 'CUSTOM_MODULE_RECORD', entityId: record.id,
      entity: {
        ...(record.data as any), id: record.id, moduleId: module_.id, moduleSlug: module_.slug, moduleName: module_.name,
        stage, previousStage: existing.stage,
      },
    }).catch(() => {});
    res.json(record);
  } catch (err) { next(err); }
}

/**
 * GET /custom-modules/:id/records/:recordId/related — everything that points
 * AT this record: for each RELATION field on any module in the org whose
 * target is this module, the records holding this record's id. Grouped per
 * (module, field) so the client can render "Service Jobs — via Vehicle".
 */
export async function relatedRecords(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const module_ = await assertModuleInOrg(req.params.id, orgId);
    const record = await prisma.customModuleRecord.findFirst({ where: { id: req.params.recordId, moduleId: module_.id } });
    if (!record) throw new AppError(404, 'Record not found');

    const inbound = await prisma.customModuleField.findMany({
      where: { relationModuleId: module_.id, module: { orgId, isActive: true } },
      include: { module: { select: { id: true, name: true, slug: true, stages: true } } },
    });

    const groups = [];
    for (const f of inbound) {
      // Json path filter: records of f's module whose data[f.fieldKey] equals this id.
      const rows = await prisma.customModuleRecord.findMany({
        where: { moduleId: f.moduleId, orgId, data: { path: [f.fieldKey], equals: record.id } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      if (!rows.length) continue;
      const fields = await prisma.customModuleField.findMany({ where: { moduleId: f.moduleId }, orderBy: { position: 'asc' } });
      groups.push({
        module: { id: f.module.id, name: f.module.name, slug: f.module.slug },
        viaField: f.label,
        records: rows.map(r => ({ id: r.id, stage: r.stage, title: recordTitle(fields, r.data as Record<string, unknown>, r.id) })),
      });
    }
    res.json({ groups });
  } catch (err) { next(err); }
}

export async function removeRecord(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const module_ = await assertModuleInOrg(req.params.id, req.user!.orgId);
    await prisma.customModuleRecord.deleteMany({ where: { id: req.params.recordId, moduleId: module_.id } });
    res.json({ message: 'Record deleted' });
  } catch (err) { next(err); }
}

// ─── Module stats (platform Phase 5) ─────────────────────────────────────────

/**
 * GET /custom-modules/:id/stats — the numbers behind a module's dashboard
 * row: total records, how many arrived in the last 7 days, the per-stage
 * distribution (for pipeline modules), and a sum for each CURRENCY field.
 * Sums are computed in JS over a bounded fetch — record data lives in JSON,
 * and modules are org-scale (hundreds, not millions), so this stays cheap
 * without needing raw SQL over jsonb.
 */
export async function moduleStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const module_ = await assertModuleInOrg(req.params.id, orgId);
    const fields = await prisma.customModuleField.findMany({ where: { moduleId: module_.id }, orderBy: { position: 'asc' } });
    const stages = moduleStages(module_);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [total, createdLast7d, stageCounts, records] = await Promise.all([
      prisma.customModuleRecord.count({ where: { moduleId: module_.id, orgId } }),
      prisma.customModuleRecord.count({ where: { moduleId: module_.id, orgId, createdAt: { gte: weekAgo } } }),
      stages.length
        ? prisma.customModuleRecord.groupBy({ by: ['stage'], where: { moduleId: module_.id, orgId }, _count: { _all: true } })
        : Promise.resolve([] as any[]),
      prisma.customModuleRecord.findMany({
        where: { moduleId: module_.id, orgId }, select: { data: true }, take: 1000,
      }),
    ]);

    const countByKey: Record<string, number> = {};
    for (const row of stageCounts as any[]) {
      // Records from before stages existed (stage null) belong to the first
      // stage — same bucketing the kanban board uses.
      const key = row.stage && stages.some(s => s.key === row.stage) ? row.stage : stages[0]?.key;
      if (key) countByKey[key] = (countByKey[key] ?? 0) + row._count._all;
    }

    const currencyFields = fields.filter(f => f.fieldType === 'CURRENCY');
    const currencySums = currencyFields.map(f => ({
      fieldKey: f.fieldKey, label: f.label,
      sum: records.reduce((acc, r) => {
        const v = Number((r.data as any)?.[f.fieldKey]);
        return acc + (Number.isFinite(v) ? v : 0);
      }, 0),
    }));

    res.json({
      total,
      createdLast7d,
      byStage: stages.map(s => ({ key: s.key, label: s.label, color: s.color, count: countByKey[s.key] ?? 0 })),
      currencySums,
    });
  } catch (err) { next(err); }
}
