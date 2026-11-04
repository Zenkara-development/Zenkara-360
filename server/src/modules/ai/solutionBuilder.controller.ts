/**
 * AI Solution Builder — platform Phase 3.
 *
 * The ten-minute Salesforce consultant: an admin describes their business in
 * plain language, the SMART model designs a complete workspace blueprint
 * (utils/ai.ts generateSolutionBlueprint), the client previews it, and this
 * file's apply endpoint turns the confirmed blueprint into real Phase 1+2
 * config — workspace skin, custom modules with fields/stages/relations,
 * entity relabels, and notification automations.
 *
 * The blueprint is pure DATA between generate and apply. Everything is
 * re-validated here with the same rules the manual builders enforce, so the
 * model can never create anything an admin couldn't have clicked together —
 * it just does it in seconds instead of an afternoon.
 *
 *   POST /ai/solution/generate  { description }        (MANAGERS)
 *   POST /ai/solution/apply     { blueprint }          (MANAGERS)
 */
import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { logAction } from '../../utils/auditLog';
import { generateSolutionBlueprint } from '../../utils/ai';
import { slugify, FIELD_TYPES } from '../custom-modules/customModules.service';

// ─── Blueprint schema ────────────────────────────────────────────────────────
// Everything optional-with-fallbacks except what would be dangerous to guess:
// unknown enum values are dropped or defaulted, never passed through.

const SECTIONS = ['CRM', 'HR', 'IT Desk', 'Admin', 'Integrations'] as const;
const STAGE_COLORS = ['slate', 'blue', 'cyan', 'teal', 'emerald', 'amber', 'orange', 'rose', 'violet', 'indigo'] as const;
const ICONS = ['Layers', 'Package', 'Boxes', 'Wrench', 'Tag', 'Briefcase', 'ClipboardList', 'FileText', 'Building2', 'Monitor'] as const;
const ENTITY_KEYS = ['ticket', 'deal', 'lead', 'contact'] as const;

const Str = (max: number) => z.string().trim().min(1).max(max);

const WorkspacePart = z.object({
  appName: z.string().trim().max(40).optional(),
  sectionRenames: z.record(Str(40), Str(30)).optional(),
  navRenames: z.record(Str(200), Str(30)).optional(),
  hiddenSections: z.array(z.enum(SECTIONS)).max(4).optional(),
}).partial().optional();

const FieldPart = z.object({
  label: Str(80),
  fieldType: z.enum(FIELD_TYPES).catch('TEXT'),
  options: z.array(Str(60)).max(20).optional(),
  required: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
  relationTo: z.string().trim().max(80).optional(),
});

const ModulePart = z.object({
  name: Str(80),
  icon: z.enum(ICONS).catch('Layers'),
  description: z.string().trim().max(500).optional(),
  navSection: z.enum(['CRM', 'IT_DESK', 'HR', 'ADMIN']).catch('CRM'),
  fields: z.array(FieldPart).min(1).max(15),
  stages: z.array(z.object({
    key: z.string().trim().max(40).regex(/^[a-z0-9_-]+$/).catch(''),
    label: Str(40),
    color: z.enum(STAGE_COLORS).catch('slate'),
  })).max(12).optional(),
  listColumns: z.array(Str(80)).max(10).optional(),
});

const AutomationPart = z.object({
  name: Str(80),
  module: Str(80),
  event: z.enum(['created', 'stage_reached']),
  stage: z.string().trim().max(40).optional(),
  notifyTitle: Str(80),
  notifyBody: Str(300),
});

export const BlueprintSchema = z.object({
  workspace: WorkspacePart,
  labels: z.record(z.enum(ENTITY_KEYS), z.object({ singular: Str(30), plural: Str(30) })).optional(),
  modules: z.array(ModulePart).min(1).max(6),
  automations: z.array(AutomationPart).max(5).optional(),
});

export type Blueprint = z.infer<typeof BlueprintSchema>;

// ─── Generate ────────────────────────────────────────────────────────────────

export async function generateSolutionHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const description = z.string().trim().min(10, 'Describe the business in a sentence or two').max(2000)
      .parse(req.body?.description);
    const raw = await generateSolutionBlueprint(description);
    if (!raw) throw new AppError(503, 'AI is not configured on this server');

    const parsed = BlueprintSchema.safeParse(raw);
    if (!parsed.success) {
      // The model missed the shape — a retry usually lands. Surface it as a
      // clear, retryable condition rather than a stack trace.
      throw new AppError(502, 'The AI returned an unusable blueprint — try Generate again, or rephrase the description.');
    }
    res.json({ blueprint: normalizeBlueprint(parsed.data) });
  } catch (err) { next(err); }
}

/** Cross-references the model can get subtly wrong, fixed deterministically. */
function normalizeBlueprint(bp: Blueprint): Blueprint {
  const moduleNames = new Set(bp.modules.map(m => m.name));
  for (const m of bp.modules) {
    // Exactly one primary field, TEXT-ish and required — first claimed wins,
    // else the first field is drafted in.
    let sawPrimary = false;
    for (const f of m.fields) {
      if (f.relationTo && !moduleNames.has(f.relationTo)) delete f.relationTo;
      if (f.fieldType === 'RELATION' && !f.relationTo) f.fieldType = 'TEXT';
      if (f.relationTo && f.fieldType !== 'RELATION') f.fieldType = 'RELATION';
      if (f.isPrimary) {
        if (sawPrimary) f.isPrimary = false;
        else { sawPrimary = true; f.required = true; }
      }
    }
    if (!sawPrimary && m.fields[0]) { m.fields[0].isPrimary = true; m.fields[0].required = true; }
    // Drop stages whose key was regex-rejected; derive from the label instead.
    if (m.stages) {
      const seen = new Set<string>();
      m.stages = m.stages.map((s, i) => {
        let key = s.key || slugify(s.label) || `stage-${i + 1}`;
        while (seen.has(key)) key = `${key}-2`;
        seen.add(key);
        return { ...s, key };
      });
    }
  }
  // Never let a blueprint hide the section that hosts the undo buttons.
  if (bp.workspace?.hiddenSections) {
    bp.workspace.hiddenSections = bp.workspace.hiddenSections.filter(s => s !== 'Admin');
  }
  // Automations must reference blueprint modules; drop the rest.
  bp.automations = (bp.automations ?? []).filter(a => moduleNames.has(a.module));
  return bp;
}

// ─── Apply ───────────────────────────────────────────────────────────────────

export async function applySolutionHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const bp = normalizeBlueprint(BlueprintSchema.parse(req.body?.blueprint));

    // Pass 1 — modules + their non-relation fields.
    const created: { name: string; id: string; slug: string; stageKeys: Set<string> }[] = [];
    for (const m of bp.modules) {
      let slug = slugify(m.name); let n = 0;
      while (await prisma.customModule.findFirst({ where: { orgId, slug: n ? `${slug}-${n}` : slug } })) n += 1;
      if (n) slug = `${slug}-${n}`;

      const fieldKeyOf = (label: string) => slugify(label).replace(/-/g, '_');
      const stages = (m.stages ?? []).map(s => ({ key: s.key, label: s.label, color: s.color }));
      const listColumns = (m.listColumns ?? [])
        .map(l => fieldKeyOf(l))
        .filter(k => m.fields.some(f => fieldKeyOf(f.label) === k));

      const mod = await prisma.customModule.create({
        data: {
          orgId, name: m.name, slug, icon: m.icon, description: m.description,
          navSection: m.navSection, createdBy: req.user!.id,
          ...(stages.length ? { stages } : {}),
          ...(listColumns.length ? { listColumns } : {}),
        },
      });
      await prisma.customModuleField.createMany({
        data: m.fields
          .filter(f => f.fieldType !== 'RELATION')
          .map((f, i) => ({
            moduleId: mod.id, label: f.label, fieldKey: fieldKeyOf(f.label), fieldType: f.fieldType,
            options: f.options, required: !!f.required, isPrimary: !!f.isPrimary, position: i,
          })),
      });
      created.push({ name: m.name, id: mod.id, slug: mod.slug, stageKeys: new Set(stages.map(s => s.key)) });
    }
    const byName = Object.fromEntries(created.map(c => [c.name, c]));

    // Pass 2 — relation fields, now that every target module exists.
    for (const m of bp.modules) {
      const me = byName[m.name];
      const relFields = m.fields.filter(f => f.fieldType === 'RELATION' && f.relationTo && byName[f.relationTo]);
      let pos = m.fields.length;
      for (const f of relFields) {
        await prisma.customModuleField.create({
          data: {
            moduleId: me.id, label: f.label, fieldKey: slugify(f.label).replace(/-/g, '_'),
            fieldType: 'RELATION', required: !!f.required, isPrimary: false, position: pos++,
            relationModuleId: byName[f.relationTo!].id,
          },
        });
      }
    }

    // Workspace skin (Phase 1 config) — the blueprint replaces what's there;
    // this endpoint is a setup event, and the settings page can adjust after.
    let workspaceApplied = false;
    if (bp.workspace && Object.keys(bp.workspace).length) {
      const config: Record<string, unknown> = {};
      if (bp.workspace.appName) config.appName = bp.workspace.appName;
      if (bp.workspace.navRenames && Object.keys(bp.workspace.navRenames).length) config.navRenames = bp.workspace.navRenames;
      if (bp.workspace.sectionRenames && Object.keys(bp.workspace.sectionRenames).length) config.sectionRenames = bp.workspace.sectionRenames;
      if (bp.workspace.hiddenSections?.length) config.hiddenSections = bp.workspace.hiddenSections;
      await prisma.workspaceConfig.upsert({
        where: { orgId },
        create: { orgId, config: config as Prisma.InputJsonValue },
        update: { config: config as Prisma.InputJsonValue },
      });
      workspaceApplied = true;
    }

    // Entity relabels — merged into BusinessContext.labelOverrides, same slot
    // AI Studio writes, so useLabels() picks them up with zero new plumbing.
    if (bp.labels && Object.keys(bp.labels).length) {
      const existing = await prisma.businessContext.findUnique({ where: { orgId } });
      const prev = ((existing?.labelOverrides as any) || {}) as { entities?: any; fields?: any };
      const merged = { entities: { ...prev.entities, ...bp.labels }, fields: prev.fields ?? {} };
      await prisma.businessContext.upsert({
        where: { orgId },
        create: { orgId, labelOverrides: merged },
        update: { labelOverrides: merged },
      });
    }

    // Automations — declarative shape → real WorkflowRules on the Phase 2
    // triggers. CREATE_NOTIFICATION only: visible, harmless, undoable.
    let workflowsCreated = 0;
    for (const a of bp.automations ?? []) {
      const target = byName[a.module];
      if (!target) continue;
      if (a.event === 'stage_reached' && (!a.stage || !target.stageKeys.has(a.stage))) continue;
      const conditions: any[] = [{ field: 'moduleSlug', operator: 'eq', value: target.slug }];
      if (a.event === 'stage_reached') conditions.push({ field: 'stage', operator: 'eq', value: a.stage });
      await prisma.workflowRule.create({
        data: {
          orgId, name: a.name, description: `Created by the AI Solution Builder`,
          trigger: a.event === 'created' ? 'CUSTOM_RECORD_CREATED' : 'CUSTOM_RECORD_STAGE_CHANGED',
          conditions,
          actions: [{ type: 'CREATE_NOTIFICATION', params: { title: a.notifyTitle, body: a.notifyBody } }],
          isActive: true,
        },
      });
      workflowsCreated++;
    }

    logAction(req.user!.id, 'CREATE', 'SolutionBlueprint', created.map(c => c.slug).join(','), {
      modules: created.length, workflows: workflowsCreated, workspaceApplied,
    });
    res.json({
      modules: created.map(c => ({ id: c.id, name: c.name, slug: c.slug })),
      workflowsCreated,
      workspaceApplied,
      labelsApplied: !!(bp.labels && Object.keys(bp.labels).length),
    });
  } catch (err) { next(err); }
}

// ─── Solution templates (platform Phase 4) ───────────────────────────────────
//
// A template IS a blueprint — the same shape generate emits and apply
// consumes — captured from a real, working org instead of from the model.
// That symmetry is the whole design: the partner flow is "perfect one org by
// hand or with the AI builder, snapshot it, stamp it onto every client org",
// and stamping reuses the exact preview + apply path the AI builder already
// has, validation included.

/** Reads an org's live configuration back into Blueprint form. */
async function snapshotOrgBlueprint(orgId: string): Promise<Blueprint> {
  const [wsRow, bizCtx, modules, rules] = await Promise.all([
    prisma.workspaceConfig.findUnique({ where: { orgId } }),
    prisma.businessContext.findUnique({ where: { orgId } }),
    prisma.customModule.findMany({
      where: { orgId, isActive: true },
      include: { fields: { orderBy: { position: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.workflowRule.findMany({
      where: { orgId, trigger: { in: ['CUSTOM_RECORD_CREATED', 'CUSTOM_RECORD_STAGE_CHANGED'] }, isActive: true },
    }),
  ]);
  if (!modules.length) {
    throw new AppError(400, 'Nothing to save yet — this workspace has no custom modules. Build one (or run the AI Solution Builder) first.');
  }

  const nameById = Object.fromEntries(modules.map(m => [m.id, m.name]));
  const nameBySlug = Object.fromEntries(modules.map(m => [m.slug, m.name]));

  const bpModules = modules.map(m => {
    const labelByKey = Object.fromEntries(m.fields.map(f => [f.fieldKey, f.label]));
    return {
      name: m.name,
      icon: (m.icon || 'Layers') as any,
      description: m.description ?? undefined,
      navSection: (m.navSection || 'CRM') as any,
      fields: m.fields.map(f => ({
        label: f.label,
        fieldType: f.fieldType as any,
        options: Array.isArray(f.options) ? (f.options as string[]) : undefined,
        required: f.required,
        isPrimary: f.isPrimary,
        // Relations survive only when the target module is in the snapshot
        // too — normalizeBlueprint would drop a dangling reference anyway.
        relationTo: f.relationModuleId ? nameById[f.relationModuleId] : undefined,
      })),
      stages: Array.isArray(m.stages) ? (m.stages as any[]) : undefined,
      listColumns: Array.isArray(m.listColumns)
        ? (m.listColumns as string[]).map(k => labelByKey[k]).filter(Boolean)
        : undefined,
    };
  });

  // Declarative automations only — a rule shaped exactly like the ones apply
  // creates (one moduleSlug condition, optional stage condition, one
  // CREATE_NOTIFICATION action). Hand-built rules with richer conditions or
  // other actions stay behind: they may reference org-specific users/ids
  // that would be meaningless in a different org.
  const automations: NonNullable<Blueprint['automations']> = [];
  for (const r of rules) {
    const conds = Array.isArray(r.conditions) ? (r.conditions as any[]) : [];
    const acts = Array.isArray(r.actions) ? (r.actions as any[]) : [];
    const slugCond = conds.find(c => c?.field === 'moduleSlug' && c?.operator === 'eq');
    const stageCond = conds.find(c => c?.field === 'stage' && c?.operator === 'eq');
    const extraConds = conds.filter(c => c !== slugCond && c !== stageCond);
    const notif = acts.length === 1 && acts[0]?.type === 'CREATE_NOTIFICATION' ? acts[0] : null;
    const moduleName = slugCond ? nameBySlug[String(slugCond.value)] : undefined;
    if (!moduleName || !notif || extraConds.length) continue;
    if (r.trigger === 'CUSTOM_RECORD_STAGE_CHANGED' && !stageCond) continue;
    automations.push({
      name: r.name,
      module: moduleName,
      event: r.trigger === 'CUSTOM_RECORD_CREATED' ? 'created' : 'stage_reached',
      stage: stageCond ? String(stageCond.value) : undefined,
      notifyTitle: String(notif.params?.title || 'Workflow automation').slice(0, 80),
      notifyBody: String(notif.params?.body || '').slice(0, 300) || 'Automation fired.',
    });
    if (automations.length >= 5) break;
  }

  const ws = (wsRow?.config ?? {}) as Record<string, any>;
  const entities = ((bizCtx?.labelOverrides as any)?.entities ?? {}) as Record<string, { singular: string; plural: string }>;
  const labels = Object.fromEntries(
    Object.entries(entities).filter(([k, v]) => ENTITY_KEYS.includes(k as any) && v?.singular && v?.plural),
  );

  const raw = {
    workspace: {
      appName: ws.appName, sectionRenames: ws.sectionRenames,
      navRenames: ws.navRenames, hiddenSections: ws.hiddenSections,
    },
    ...(Object.keys(labels).length ? { labels } : {}),
    modules: bpModules,
    ...(automations.length ? { automations } : {}),
  };
  const parsed = BlueprintSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(500, 'This workspace could not be captured as a template — its configuration contains values a fresh org could not recreate.');
  }
  return normalizeBlueprint(parsed.data);
}

const TemplateMetaSchema = z.object({
  name: Str(80),
  description: z.string().trim().max(300).optional(),
  isShared: z.boolean().optional(),
});

/** GET /ai/solution/templates — this org's templates plus shared ones. */
export async function listTemplatesHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const rows = await prisma.solutionTemplate.findMany({
      where: { OR: [{ orgId }, { isShared: true }] },
      orderBy: { createdAt: 'desc' },
      include: { org: { select: { name: true } } },
    });
    res.json(rows.map(t => ({
      id: t.id, name: t.name, description: t.description, isShared: t.isShared,
      mine: t.orgId === orgId, from: t.org.name, createdAt: t.createdAt,
      moduleCount: Array.isArray((t.blueprint as any)?.modules) ? (t.blueprint as any).modules.length : 0,
      appName: (t.blueprint as any)?.workspace?.appName ?? null,
    })));
  } catch (err) { next(err); }
}

/** POST /ai/solution/templates — snapshot the CURRENT workspace as a template. */
export async function saveTemplateHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const meta = TemplateMetaSchema.parse(req.body);
    const count = await prisma.solutionTemplate.count({ where: { orgId } });
    if (count >= 20) throw new AppError(400, 'Template limit reached (20 per organization) — delete one first.');
    const blueprint = await snapshotOrgBlueprint(orgId);
    const t = await prisma.solutionTemplate.create({
      data: {
        orgId, name: meta.name, description: meta.description,
        isShared: !!meta.isShared, blueprint: blueprint as unknown as Prisma.InputJsonValue,
        createdBy: req.user!.id,
      },
    });
    logAction(req.user!.id, 'CREATE', 'SolutionTemplate', t.id, { name: t.name, isShared: t.isShared });
    res.status(201).json({ id: t.id, name: t.name, moduleCount: blueprint.modules.length });
  } catch (err) { next(err); }
}

/** GET /ai/solution/templates/:id — the full blueprint, for preview + apply. */
export async function getTemplateHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const t = await prisma.solutionTemplate.findFirst({
      where: { id: req.params.id, OR: [{ orgId }, { isShared: true }] },
    });
    if (!t) throw new AppError(404, 'Template not found');
    res.json({ id: t.id, name: t.name, description: t.description, blueprint: t.blueprint });
  } catch (err) { next(err); }
}

/** DELETE /ai/solution/templates/:id — creator org only, shared or not. */
export async function deleteTemplateHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const del = await prisma.solutionTemplate.deleteMany({
      where: { id: req.params.id, orgId: req.user!.orgId },
    });
    if (!del.count) throw new AppError(404, 'Template not found (only the workspace that saved a template can delete it)');
    logAction(req.user!.id, 'DELETE', 'SolutionTemplate', req.params.id);
    res.json({ message: 'Template deleted' });
  } catch (err) { next(err); }
}
