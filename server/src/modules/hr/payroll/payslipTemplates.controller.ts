/**
 * Payslip templates (phase 4): several per org, eight layouts, field
 * visibility, assignment by department / location / employment type, and
 * the render endpoints (HTML, PDF, bulk PDF, e-mail) that use them.
 */
import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';
import { AppError } from '../../../middleware/errorHandler';
import { logAction } from '../../../utils/auditLog';
import { sendMail } from '../../../utils/mailer';
import {
  LAYOUTS, PAYSLIP_FIELDS, buildPayslipDoc, samplePayslipDoc, renderPayslipHtml, renderPayslipPdf, renderPayslipBundlePdf, type PayslipDoc,
} from '../../../utils/payslipRender';

const MANAGER_ROLES = ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'];
const emptyToNull = (v: unknown) => (v === '' ? null : v);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const TemplateSchema = z.object({
  name: z.string().min(1).max(80),
  layout: z.enum(['STANDARD', 'MODERN', 'MINIMAL', 'DETAILED', 'COMPACT', 'CORPORATE', 'BRANCH', 'STATEMENT']).default('STANDARD'),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  companyName: z.preprocess(emptyToNull, z.string().nullable().optional()),
  companyAddress: z.preprocess(emptyToNull, z.string().nullable().optional()),
  logoUrl: z.preprocess(emptyToNull, z.string().url().nullable().optional()),
  primaryColor: hexColor.default('#2563eb'),
  accentColor: z.preprocess(emptyToNull, hexColor.nullable().optional()),
  headerTitle: z.string().min(1).max(60).default('Payslip'),
  headerNote: z.preprocess(emptyToNull, z.string().max(500).nullable().optional()),
  footerNote: z.preprocess(emptyToNull, z.string().max(1000).nullable().optional()),
  showSignature: z.boolean().default(true),
  signatureLabel: z.string().max(80).default('Authorized Signatory'),
  signatoryName: z.preprocess(emptyToNull, z.string().max(80).nullable().optional()),
  signatureUrl: z.preprocess(emptyToNull, z.string().url().nullable().optional()),
  showFields: z.record(z.boolean()).nullable().optional(),
  applicability: z.object({
    departmentIds: z.array(z.string()).optional(),
    locationIds: z.array(z.string()).optional(),
    employmentTypes: z.array(z.string()).optional(),
  }).nullable().optional(),
});

/** Every org gets one template row; older orgs already have it (migrated from the single-letterhead model). */
export async function ensureDefaultTemplate(orgId: string) {
  const existing = await prisma.payslipTemplate.findFirst({ where: { orgId, isDefault: true } });
  if (existing) return existing;
  const any = await prisma.payslipTemplate.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' } });
  if (any) return prisma.payslipTemplate.update({ where: { id: any.id }, data: { isDefault: true } });
  return prisma.payslipTemplate.create({ data: { orgId, name: 'Default', layout: 'STANDARD', isDefault: true } });
}

/** Employee context needed for template applicability + the document. */
async function employeeFor(orgId: string, userId: string) {
  return prisma.employee.findFirst({
    where: { orgId, userId },
    include: { department: { select: { name: true } }, location: { select: { name: true, addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true, country: true } } },
  });
}

/** First active non-default template whose applicability matches, else the default. */
export async function resolveTemplate(orgId: string, emp: { departmentId?: string | null; locationId?: string | null; employmentType?: string | null } | null) {
  const templates = await prisma.payslipTemplate.findMany({ where: { orgId, isActive: true }, orderBy: [{ isDefault: 'asc' }, { createdAt: 'asc' }] });
  if (templates.length === 0) return ensureDefaultTemplate(orgId);
  const matches = (t: any) => {
    const a = (t.applicability ?? {}) as { departmentIds?: string[]; locationIds?: string[]; employmentTypes?: string[] };
    const rules = [
      a.departmentIds?.length ? a.departmentIds.includes(emp?.departmentId ?? '') : null,
      a.locationIds?.length ? a.locationIds.includes(emp?.locationId ?? '') : null,
      a.employmentTypes?.length ? a.employmentTypes.includes(emp?.employmentType ?? '') : null,
    ].filter(r => r !== null);
    return rules.length > 0 && rules.every(Boolean);
  };
  return templates.find(t => !t.isDefault && matches(t)) ?? templates.find(t => t.isDefault) ?? templates[0];
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function listTemplates(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    await ensureDefaultTemplate(orgId);
    const [templates, counts] = await Promise.all([
      prisma.payslipTemplate.findMany({ where: { orgId }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
      prisma.payslip.groupBy({ by: ['templateId'], where: { orgId, templateId: { not: null } }, _count: { _all: true } }),
    ]);
    const used = new Map(counts.map(c => [c.templateId, c._count._all]));
    res.json({ templates: templates.map(t => ({ ...t, payslipCount: used.get(t.id) ?? 0 })), layouts: LAYOUTS.map(({ key, name, description, defaults }) => ({ key, name, description, defaults })), fields: PAYSLIP_FIELDS });
  } catch (err) { next(err); }
}

export async function createTemplate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = TemplateSchema.parse(req.body);
    await ensureDefaultTemplate(orgId);
    const t = await prisma.$transaction(async tx => {
      if (data.isDefault) await tx.payslipTemplate.updateMany({ where: { orgId }, data: { isDefault: false } });
      return tx.payslipTemplate.create({ data: { orgId, ...data, isDefault: !!data.isDefault, isActive: data.isActive ?? true, showFields: data.showFields ?? undefined, applicability: data.applicability ?? undefined } });
    });
    logAction(req.user!.id, 'CREATE', 'PayslipTemplate', t.id, { name: t.name, layout: t.layout });
    res.status(201).json(t);
  } catch (err) { next(err); }
}

export async function updateTemplate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const existing = await prisma.payslipTemplate.findFirst({ where: { id: req.params.id, orgId } });
    if (!existing) throw new AppError(404, 'Template not found');
    const data = TemplateSchema.partial().parse(req.body);
    if (existing.isDefault && (data.isDefault === false || data.isActive === false)) throw new AppError(400, 'Make another template the default first');
    const t = await prisma.$transaction(async tx => {
      if (data.isDefault) await tx.payslipTemplate.updateMany({ where: { orgId, id: { not: existing.id } }, data: { isDefault: false } });
      return tx.payslipTemplate.update({ where: { id: existing.id }, data: { ...data, showFields: data.showFields === null ? undefined : data.showFields, applicability: data.applicability === null ? undefined : data.applicability } as any });
    });
    logAction(req.user!.id, 'UPDATE', 'PayslipTemplate', t.id, { name: t.name });
    res.json(t);
  } catch (err) { next(err); }
}

export async function deleteTemplate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const t = await prisma.payslipTemplate.findFirst({ where: { id: req.params.id, orgId } });
    if (!t) throw new AppError(404, 'Template not found');
    if (t.isDefault) throw new AppError(400, 'The default template cannot be deleted — make another one the default first');
    const used = await prisma.payslip.count({ where: { templateId: t.id } });
    if (used > 0) {
      await prisma.payslipTemplate.update({ where: { id: t.id }, data: { isActive: false } });
      logAction(req.user!.id, 'UPDATE', 'PayslipTemplate', t.id, { action: 'deactivated (in use)' });
      return res.json({ ok: true, deactivated: true, message: `${used} issued payslip(s) use this template, so it was deactivated instead of deleted.` });
    }
    await prisma.payslipTemplate.delete({ where: { id: t.id } });
    logAction(req.user!.id, 'DELETE', 'PayslipTemplate', t.id, {});
    res.json({ ok: true });
  } catch (err) { next(err); }
}

/** POST /templates/:id/duplicate */
export async function duplicateTemplate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const t = await prisma.payslipTemplate.findFirst({ where: { id: req.params.id, orgId } });
    if (!t) throw new AppError(404, 'Template not found');
    const { id, createdAt, updatedAt, ...rest } = t as any;
    const copy = await prisma.payslipTemplate.create({ data: { ...rest, name: `${t.name} (copy)`, isDefault: false } });
    res.status(201).json(copy);
  } catch (err) { next(err); }
}

// ─── Rendering ───────────────────────────────────────────────────────────────

const payslipInclude = {
  user: { select: { id: true, name: true, email: true, department: true } },
  org: { select: { name: true, currency: true } },
  lines: { orderBy: { displayOrder: 'asc' as const } },
  payrollRun: { select: { id: true, status: true, periodStart: true, periodEnd: true, payrollCycle: { select: { name: true, frequency: true } } } },
  employeeSalary: { select: { ctcAnnual: true } },
  template: true,
};

async function loadPayslipForRender(req: AuthRequest, id: string, templateOverride?: string) {
  const payslip = await prisma.payslip.findFirst({ where: { id, orgId: req.user!.orgId }, include: payslipInclude });
  if (!payslip) throw new AppError(404, 'Payslip not found');
  const isManager = MANAGER_ROLES.includes(req.user!.role);
  if (!isManager && payslip.userId !== req.user!.id) throw new AppError(403, 'You can only view your own payslips');
  if (!isManager && payslip.status === 'DRAFT') throw new AppError(404, 'Payslip not found');
  return docFor(payslip, isManager && templateOverride ? templateOverride : undefined);
}

export async function docFor(payslip: any, templateOverride?: string): Promise<PayslipDoc> {
  const employee = await employeeFor(payslip.orgId, payslip.userId);
  let template = templateOverride ? await prisma.payslipTemplate.findFirst({ where: { id: templateOverride, orgId: payslip.orgId } }) : payslip.template;
  if (!template) template = await resolveTemplate(payslip.orgId, employee);
  return buildPayslipDoc({ payslip, template, employee, org: payslip.org });
}

/** GET /payslips/:id/html[?templateId&embed=1] */
export async function payslipHtml(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const doc = await loadPayslipForRender(req, req.params.id, typeof req.query.templateId === 'string' ? req.query.templateId : undefined);
    const embed = req.query.embed === '1';
    if (embed) return res.json({ html: renderPayslipHtml(doc, { embed: true }), template: { layout: doc.layout.key } });
    res.type('html').send(renderPayslipHtml(doc));
  } catch (err) { next(err); }
}

/** GET /payslips/:id/pdf[?templateId] */
export async function payslipPdf(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const doc = await loadPayslipForRender(req, req.params.id, typeof req.query.templateId === 'string' ? req.query.templateId : undefined);
    const buf = await renderPayslipPdf(doc);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${doc.payslip.number}.pdf"`);
    res.send(buf);
  } catch (err) { next(err); }
}

/** GET /runs/:id/pdf — every payslip in the run as one PDF (managers) */
export async function runPdf(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const run = await prisma.payrollRun.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId }, include: { payslips: { include: payslipInclude, orderBy: { user: { name: 'asc' } } } } });
    if (!run) throw new AppError(404, 'Payroll run not found');
    const docs: PayslipDoc[] = [];
    for (const p of run.payslips) docs.push(await docFor(p));
    const buf = await renderPayslipBundlePdf(docs);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payslips-${run.year}-${String(run.month).padStart(2, '0')}.pdf"`);
    res.send(buf);
  } catch (err) { next(err); }
}

/** GET /templates/:id/preview[?payslipId] — HTML preview of a template on a real or sample payslip */
export async function previewTemplate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const template = req.params.id === 'draft' ? TemplateSchema.partial().parse({ ...(req.body ?? {}), name: req.body?.name || undefined }) : await prisma.payslipTemplate.findFirst({ where: { id: req.params.id, orgId } });
    if (!template) throw new AppError(404, 'Template not found');
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, currency: true } });
    let doc: PayslipDoc;
    if (typeof req.query.payslipId === 'string') {
      const p = await prisma.payslip.findFirst({ where: { id: req.query.payslipId, orgId }, include: payslipInclude });
      if (!p) throw new AppError(404, 'Payslip not found');
      doc = buildPayslipDoc({ payslip: p, template, employee: await employeeFor(orgId, p.userId), org: p.org });
    } else doc = samplePayslipDoc(template, org!);
    if (req.query.format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      return res.send(await renderPayslipPdf(doc));
    }
    res.json({ html: renderPayslipHtml(doc, { embed: true }) });
  } catch (err) { next(err); }
}

/** POST /templates/preview — preview an unsaved template (body = template fields) */
export async function previewDraftTemplate(req: AuthRequest, res: Response, next: NextFunction) {
  req.params.id = 'draft';
  return previewTemplate(req, res, next);
}

// ─── E-mail ──────────────────────────────────────────────────────────────────

async function emailOne(payslip: any, orgId: string, sentBy: string) {
  const to = payslip.user?.email;
  if (!to) return { id: payslip.id, ok: false, reason: 'No e-mail address' };
  const doc = await docFor(payslip);
  const pdf = await renderPayslipPdf(doc);
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111">
    <p>Hi ${doc.employee.name.split(' ')[0]},</p>
    <p>Your payslip for <strong>${doc.payslip.periodLabel}</strong> is attached as a PDF.</p>
    <p style="font-size:13px;color:#555">Net pay: <strong>${doc.totals.net.toLocaleString(doc.locale, { style: 'currency', currency: doc.currency })}</strong> · ${doc.payslip.number}</p>
    <p style="font-size:12px;color:#888">Log in to the HR portal to see every payslip and download older ones.</p>
  </div>`;
  await sendMail({ to, subject: `Payslip — ${doc.payslip.periodLabel} (${doc.payslip.number})`, html, orgId, attachments: [{ filename: `${doc.payslip.number}.pdf`, contentBase64: pdf.toString('base64'), contentType: 'application/pdf' }] });
  await prisma.payslip.update({ where: { id: payslip.id }, data: { emailedAt: new Date() } });
  logAction(sentBy, 'UPDATE', 'Payslip', payslip.id, { action: 'emailed', to });
  return { id: payslip.id, ok: true };
}

/** POST /payslips/:id/email */
export async function emailPayslip(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const p = await prisma.payslip.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId }, include: payslipInclude });
    if (!p) throw new AppError(404, 'Payslip not found');
    if (p.status === 'DRAFT') throw new AppError(400, 'Finalise the run before e-mailing payslips');
    res.json(await emailOne(p, req.user!.orgId, req.user!.id));
  } catch (err) { next(err); }
}

/** POST /runs/:id/email — send every (non-draft) payslip in the run; { onlyUnsent?: boolean } */
export async function emailRun(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const run = await prisma.payrollRun.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId }, include: { payslips: { include: payslipInclude } } });
    if (!run) throw new AppError(404, 'Payroll run not found');
    if (run.status === 'DRAFT') throw new AppError(400, 'Finalise the run before e-mailing payslips');
    const onlyUnsent = req.body?.onlyUnsent !== false;
    const results = [];
    for (const p of run.payslips) {
      if (onlyUnsent && p.emailedAt) { results.push({ id: p.id, ok: true, skipped: true }); continue; }
      results.push(await emailOne(p, req.user!.orgId, req.user!.id));
    }
    res.json({ sent: results.filter(r => r.ok && !(r as any).skipped).length, skipped: results.filter(r => (r as any).skipped).length, failed: results.filter(r => !r.ok), results });
  } catch (err) { next(err); }
}
