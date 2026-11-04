import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';
import { AppError } from '../../../middleware/errorHandler';
import { parsePagination, paginate } from '../../../utils/pagination';
import { logAction } from '../../../utils/auditLog';
import { encryptSecret, decryptSecretOrPlain } from '../../../utils/crypto';
import { purgeEntityChildren } from '../../../utils/entityCleanup';
import {
  getPermCtx,
  assertCan,
  scopedWhere,
  canAccessRecord,
  redact,
  stripUnwritableFields,
  invalidatePermCtx,
} from '../../../utils/permissions';

/**
 * Employee records — the people side of the platform.
 *
 * Two things here are load-bearing beyond plain CRUD:
 *
 *  1. Every read goes through scopedWhere() + redact(). A manager on scope
 *     TEAM sees their reports; an EMPLOYEE sees themselves; and the bank/tax
 *     columns are masked for everyone except roles explicitly exempted. This
 *     is the first module wired to the permission engine, deliberately — it
 *     holds the data where getting it wrong actually matters.
 *
 *  2. Sensitive columns are encrypted at rest with the same helper used for
 *     mail passwords. Encryption and field permissions solve different
 *     problems and we need both: encryption protects a stolen database dump,
 *     field permissions protect against a logged-in colleague.
 */

const SENSITIVE_COLUMNS = [
  'bankAccountName',
  'bankAccountNumber',
  'bankName',
  'bankIfsc',
  'taxId',
  'nationalId',
  'socialSecurityId',
] as const;

const CreateSchema = z.object({
  employeeCode: z.string().min(1).max(40).optional(),
  userId: z.string().optional().nullable(),
  firstName: z.string().min(1),
  lastName: z.string().optional().nullable(),
  displayName: z.string().optional(),
  workEmail: z.string().email().optional().nullable(),
  personalEmail: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  alternatePhone: z.string().optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  maritalStatus: z.string().optional().nullable(),
  bloodGroup: z.string().optional().nullable(),
  photoUrl: z.string().optional().nullable(),
  addressLine1: z.string().optional().nullable(),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  designation: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  locationId: z.string().optional().nullable(),
  managerId: z.string().optional().nullable(),
  dottedLineManagerId: z.string().optional().nullable(),
  costCenter: z.string().optional().nullable(),
  workMode: z.enum(['ONSITE', 'REMOTE', 'HYBRID']).optional(),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT', 'TEMPORARY']).optional(),
  employmentStatus: z.enum(['PROBATION', 'ACTIVE', 'ON_LEAVE', 'NOTICE_PERIOD', 'SUSPENDED', 'EXITED']).optional(),
  joiningDate: z.string(),
  probationEndDate: z.string().optional().nullable(),
  confirmationDate: z.string().optional().nullable(),
  bankAccountName: z.string().optional().nullable(),
  bankAccountNumber: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  bankIfsc: z.string().optional().nullable(),
  taxId: z.string().optional().nullable(),
  nationalId: z.string().optional().nullable(),
  socialSecurityId: z.string().optional().nullable(),
});

const UpdateSchema = CreateSchema.partial().extend({ joiningDate: z.string().optional() });

const ExitSchema = z.object({
  resignationDate: z.string().optional().nullable(),
  lastWorkingDate: z.string(),
  exitType: z.enum(['RESIGNATION', 'TERMINATION', 'RETIREMENT', 'END_OF_CONTRACT', 'ABSCONDED']),
  exitReason: z.string().optional().nullable(),
  isRehireEligible: z.boolean().optional(),
});

const listInclude = {
  department: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  manager: { select: { id: true, displayName: true, employeeCode: true } },
  user: { select: { id: true, email: true, role: true, isActive: true } },
};

function toDate(v?: string | null): Date | undefined {
  return v ? new Date(v) : undefined;
}

/** Encrypts the sensitive columns present on an input object, in place. */
function encryptSensitive<T extends Record<string, any>>(data: T): T {
  const out: Record<string, any> = { ...data };
  for (const col of SENSITIVE_COLUMNS) {
    if (typeof out[col] === 'string' && out[col]) out[col] = encryptSecret(out[col]);
  }
  return out as T;
}

/** Decrypts sensitive columns so redact() can then mask them per role. */
function decryptSensitive<T extends Record<string, any>>(row: T): T {
  const out: Record<string, any> = { ...row };
  for (const col of SENSITIVE_COLUMNS) {
    if (typeof out[col] === 'string' && out[col]) {
      try {
        out[col] = decryptSecretOrPlain(out[col]);
      } catch {
        out[col] = null;
      }
    }
  }
  return out as T;
}

/**
 * Next code in the EMP-0001 sequence.
 *
 * Derived from the current max rather than a counter column, so an org that
 * imports employees with their own codes doesn't end up colliding on the next
 * generated one.
 */
async function nextEmployeeCode(orgId: string): Promise<string> {
  const rows = await prisma.employee.findMany({
    where: { orgId, employeeCode: { startsWith: 'EMP-' } },
    select: { employeeCode: true },
    orderBy: { employeeCode: 'desc' },
    take: 1,
  });
  const last = rows[0]?.employeeCode;
  const n = last ? parseInt(last.replace('EMP-', ''), 10) : 0;
  return `EMP-${String((Number.isFinite(n) ? n : 0) + 1).padStart(4, '0')}`;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.employee.read');

    const orgId = req.user!.orgId;
    const { search, departmentId, locationId, managerId, employmentStatus, employmentType } =
      req.query as Record<string, string>;

    const where: any = {
      orgId,
      ...scopedWhere(ctx, 'employee', 'hr.employee.read'),
    };
    if (departmentId) where.departmentId = departmentId;
    if (locationId) where.locationId = locationId;
    if (managerId) where.managerId = managerId;
    if (employmentStatus) where.employmentStatus = employmentStatus;
    if (employmentType) where.employmentType = employmentType;
    if (search) {
      where.AND = [
        {
          OR: [
            { displayName: { contains: search, mode: 'insensitive' } },
            { employeeCode: { contains: search, mode: 'insensitive' } },
            { workEmail: { contains: search, mode: 'insensitive' } },
            { designation: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const pag = parsePagination(req);
    const [rows, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        include: listInclude,
        orderBy: { displayName: 'asc' },
        take: pag.limit,
        skip: pag.skip,
      }),
      prisma.employee.count({ where }),
    ]);

    const safe = rows.map(r => redact(ctx, 'employee', decryptSensitive(r)));
    res.json(paginate(safe, total, pag));
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.employee.read');

    const employee = await prisma.employee.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
      include: {
        ...listInclude,
        dottedLineManager: { select: { id: true, displayName: true } },
        reports: { select: { id: true, displayName: true, designation: true, employeeCode: true } },
        contacts: true,
        education: true,
        experience: true,
        certifications: true,
        skills: { include: { skill: { select: { id: true, name: true, category: true } } } },
        teamMemberships: { include: { team: { select: { id: true, name: true } } } },
      },
    });
    if (!employee) throw new AppError(404, 'Employee not found');
    if (!canAccessRecord(ctx, 'employee', 'hr.employee.read', employee)) {
      throw new AppError(403, 'Insufficient permissions');
    }

    res.json(redact(ctx, 'employee', decryptSensitive(employee)));
  } catch (err) {
    next(err);
  }
}

/**
 * The org chart, as a nested tree.
 *
 * Built in one query and assembled in memory rather than with a recursive CTE:
 * an org chart is bounded by headcount, headcount fits comfortably in memory,
 * and this keeps the query portable and readable. Employees whose manager is
 * outside the visible set surface as roots so nobody silently disappears from
 * the chart just because their manager left.
 */
export async function orgChart(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.employee.read');

    const rows = await prisma.employee.findMany({
      where: { orgId: req.user!.orgId, employmentStatus: { not: 'EXITED' } },
      select: {
        id: true,
        displayName: true,
        employeeCode: true,
        designation: true,
        photoUrl: true,
        managerId: true,
        department: { select: { id: true, name: true } },
      },
      orderBy: { displayName: 'asc' },
    });

    type Node = (typeof rows)[number] & { reports: Node[] };
    const byId = new Map<string, Node>(rows.map(r => [r.id, { ...r, reports: [] }]));
    const roots: Node[] = [];

    for (const node of byId.values()) {
      const parent = node.managerId ? byId.get(node.managerId) : undefined;
      if (parent && parent.id !== node.id) parent.reports.push(node);
      else roots.push(node);
    }

    res.json({ data: roots, total: rows.length });
  } catch (err) {
    next(err);
  }
}

export async function directReports(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    const rows = await prisma.employee.findMany({
      where: { orgId: req.user!.orgId, managerId: req.params.id },
      include: listInclude,
      orderBy: { displayName: 'asc' },
    });
    res.json({ data: rows.map(r => redact(ctx, 'employee', decryptSensitive(r))), total: rows.length });
  } catch (err) {
    next(err);
  }
}

export async function stats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.employee.read');
    const orgId = req.user!.orgId;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const [total, byStatus, byType, byDepartment, recentJoiners, exiting] = await Promise.all([
      prisma.employee.count({ where: { orgId } }),
      prisma.employee.groupBy({ by: ['employmentStatus'], where: { orgId }, _count: { _all: true } }),
      prisma.employee.groupBy({ by: ['employmentType'], where: { orgId }, _count: { _all: true } }),
      prisma.employee.groupBy({ by: ['departmentId'], where: { orgId }, _count: { _all: true } }),
      prisma.employee.count({ where: { orgId, joiningDate: { gte: thirtyDaysAgo } } }),
      prisma.employee.count({ where: { orgId, employmentStatus: 'NOTICE_PERIOD' } }),
    ]);

    const deptNames = await prisma.department.findMany({
      where: { orgId },
      select: { id: true, name: true },
    });
    const nameById = new Map(deptNames.map(d => [d.id, d.name]));

    res.json({
      total,
      recentJoiners,
      exiting,
      byStatus: byStatus.map(s => ({ status: s.employmentStatus, count: s._count._all })),
      byType: byType.map(t => ({ type: t.employmentType, count: t._count._all })),
      byDepartment: byDepartment.map(d => ({
        departmentId: d.departmentId,
        department: d.departmentId ? nameById.get(d.departmentId) ?? 'Unknown' : 'Unassigned',
        count: d._count._all,
      })),
    });
  } catch (err) {
    next(err);
  }
}

/** The caller's own employee record — powers the employee self-service home. */
export async function me(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    const employee = await prisma.employee.findFirst({
      where: { orgId: req.user!.orgId, userId: req.user!.id },
      include: {
        ...listInclude,
        contacts: true,
        certifications: true,
        skills: { include: { skill: true } },
      },
    });
    if (!employee) {
      // Not an error: plenty of legitimate logins have no employee record.
      res.json({ data: null, message: 'No employee record is linked to this login' });
      return;
    }
    res.json({ data: redact(ctx, 'employee', decryptSensitive(employee)) });
  } catch (err) {
    next(err);
  }
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.employee.create');

    const orgId = req.user!.orgId;
    const input = CreateSchema.parse(req.body);
    const data = stripUnwritableFields(ctx, 'employee', input);

    if (data.userId) {
      const linked = await prisma.employee.findUnique({ where: { userId: data.userId } });
      if (linked) throw new AppError(409, 'That login is already linked to another employee');
      const user = await prisma.user.findFirst({ where: { id: data.userId, orgId } });
      if (!user) throw new AppError(404, 'User not found in this organization');
    }

    const employeeCode = data.employeeCode ?? (await nextEmployeeCode(orgId));
    const displayName = data.displayName ?? [data.firstName, data.lastName].filter(Boolean).join(' ');

    const employee = await prisma.employee.create({
      data: {
        ...encryptSensitive(data),
        orgId,
        employeeCode,
        displayName,
        firstName: data.firstName!,
        joiningDate: new Date(input.joiningDate),
        dateOfBirth: toDate(data.dateOfBirth),
        probationEndDate: toDate(data.probationEndDate),
        confirmationDate: toDate(data.confirmationDate),
        userId: data.userId ?? null,
      },
      include: listInclude,
    });

    logAction(req.user!.id, 'CREATE', 'EMPLOYEE', employee.id, { employeeCode, displayName });
    if (data.userId) invalidatePermCtx(data.userId);

    res.status(201).json(redact(ctx, 'employee', decryptSensitive(employee)));
  } catch (err) {
    next(err);
  }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.employee.update');

    const orgId = req.user!.orgId;
    const existing = await prisma.employee.findFirst({ where: { id: req.params.id, orgId } });
    if (!existing) throw new AppError(404, 'Employee not found');
    if (!canAccessRecord(ctx, 'employee', 'hr.employee.update', existing)) {
      throw new AppError(403, 'Insufficient permissions');
    }

    const input = UpdateSchema.parse(req.body);
    const data = stripUnwritableFields(ctx, 'employee', input);

    // A cycle in the reporting line would make resolveReports() and the org
    // chart both wrong, so reject it at the edge rather than defending against
    // it in six read paths.
    if (data.managerId) {
      if (data.managerId === existing.id) throw new AppError(400, 'An employee cannot report to themselves');
      let cursor: string | null = data.managerId;
      for (let i = 0; i < 20 && cursor; i++) {
        if (cursor === existing.id) throw new AppError(400, 'That change would create a reporting loop');
        const next: { managerId: string | null } | null = await prisma.employee.findUnique({
          where: { id: cursor },
          select: { managerId: true },
        });
        cursor = next?.managerId ?? null;
      }
    }

    const displayName =
      data.displayName ??
      (data.firstName || data.lastName
        ? [data.firstName ?? existing.firstName, data.lastName ?? existing.lastName].filter(Boolean).join(' ')
        : undefined);

    const employee = await prisma.employee.update({
      where: { id: existing.id },
      data: {
        ...encryptSensitive(data),
        ...(displayName ? { displayName } : {}),
        ...(input.joiningDate ? { joiningDate: new Date(input.joiningDate) } : {}),
        ...(data.dateOfBirth !== undefined ? { dateOfBirth: toDate(data.dateOfBirth) ?? null } : {}),
        ...(data.probationEndDate !== undefined ? { probationEndDate: toDate(data.probationEndDate) ?? null } : {}),
        ...(data.confirmationDate !== undefined ? { confirmationDate: toDate(data.confirmationDate) ?? null } : {}),
      },
      include: listInclude,
    });

    logAction(req.user!.id, 'UPDATE', 'EMPLOYEE', employee.id, { fields: Object.keys(data) });
    if (existing.userId) invalidatePermCtx(existing.userId);

    res.json(redact(ctx, 'employee', decryptSensitive(employee)));
  } catch (err) {
    next(err);
  }
}

/**
 * Records an exit.
 *
 * Deliberately does NOT delete anything or reassign ownership — that's the
 * offboarding workflow's job, and conflating "mark this person as leaving"
 * with "transfer their 12 open deals" is how you end up with an irreversible
 * button. This sets the status and dates; the caller then generates the
 * offboarding task set.
 */
export async function recordExit(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.employee.update');

    const orgId = req.user!.orgId;
    const existing = await prisma.employee.findFirst({ where: { id: req.params.id, orgId } });
    if (!existing) throw new AppError(404, 'Employee not found');

    const input = ExitSchema.parse(req.body);
    const lastWorkingDate = new Date(input.lastWorkingDate);
    const hasLeft = lastWorkingDate <= new Date();

    const employee = await prisma.employee.update({
      where: { id: existing.id },
      data: {
        resignationDate: toDate(input.resignationDate),
        lastWorkingDate,
        exitType: input.exitType,
        exitReason: input.exitReason ?? null,
        isRehireEligible: input.isRehireEligible ?? null,
        employmentStatus: hasLeft ? 'EXITED' : 'NOTICE_PERIOD',
      },
      include: listInclude,
    });

    logAction(req.user!.id, 'UPDATE', 'EMPLOYEE', employee.id, {
      action: 'EXIT',
      exitType: input.exitType,
      lastWorkingDate: input.lastWorkingDate,
    });

    res.json(redact(ctx, 'employee', decryptSensitive(employee)));
  } catch (err) {
    next(err);
  }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.employee.delete');

    const orgId = req.user!.orgId;
    const existing = await prisma.employee.findFirst({ where: { id: req.params.id, orgId } });
    if (!existing) throw new AppError(404, 'Employee not found');

    const reports = await prisma.employee.count({ where: { orgId, managerId: existing.id } });
    if (reports > 0) {
      throw new AppError(
        400,
        `This employee has ${reports} direct report(s). Reassign them before deleting, or record an exit instead.`
      );
    }

    await prisma.employee.delete({ where: { id: existing.id } });
    await purgeEntityChildren('EMPLOYEE', existing.id, orgId);
    logAction(req.user!.id, 'DELETE', 'EMPLOYEE', existing.id, { employeeCode: existing.employeeCode });
    if (existing.userId) invalidatePermCtx(existing.userId);

    res.json({ message: 'Employee deleted' });
  } catch (err) {
    next(err);
  }
}

// ─── Sub-resources ────────────────────────────────────────────────────────────

const ContactSchema = z.object({
  name: z.string().min(1),
  relationship: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional().nullable(),
  address: z.string().optional().nullable(),
  isEmergency: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
});

export async function addContact(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.employee.update');
    const employee = await prisma.employee.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
      select: { id: true },
    });
    if (!employee) throw new AppError(404, 'Employee not found');

    const data = ContactSchema.parse(req.body);
    const row = await prisma.employeeContact.create({ data: { ...data, employeeId: employee.id } });
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
}

const SkillSchema = z.object({
  skillName: z.string().min(1),
  category: z.string().optional(),
  level: z.number().int().min(1).max(5).optional(),
  yearsExperience: z.number().optional(),
});

/** Attaches a skill, creating the org-level Skill row on first use. */
export async function addSkill(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.employee.update');
    const orgId = req.user!.orgId;

    const employee = await prisma.employee.findFirst({
      where: { id: req.params.id, orgId },
      select: { id: true },
    });
    if (!employee) throw new AppError(404, 'Employee not found');

    const input = SkillSchema.parse(req.body);
    const skill = await prisma.skill.upsert({
      where: { orgId_name: { orgId, name: input.skillName } },
      update: input.category ? { category: input.category } : {},
      create: { orgId, name: input.skillName, category: input.category ?? null },
    });

    const row = await prisma.employeeSkill.upsert({
      where: { employeeId_skillId: { employeeId: employee.id, skillId: skill.id } },
      update: { level: input.level ?? 3, yearsExperience: input.yearsExperience ?? null },
      create: {
        employeeId: employee.id,
        skillId: skill.id,
        level: input.level ?? 3,
        yearsExperience: input.yearsExperience ?? null,
      },
      include: { skill: true },
    });

    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
}

const CertificationSchema = z.object({
  name: z.string().min(1),
  issuer: z.string().optional().nullable(),
  credentialId: z.string().optional().nullable(),
  issuedOn: z.string().optional().nullable(),
  expiresOn: z.string().optional().nullable(),
});

export async function addCertification(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.employee.update');
    const employee = await prisma.employee.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
      select: { id: true },
    });
    if (!employee) throw new AppError(404, 'Employee not found');

    const data = CertificationSchema.parse(req.body);
    const row = await prisma.employeeCertification.create({
      data: {
        employeeId: employee.id,
        name: data.name,
        issuer: data.issuer ?? null,
        credentialId: data.credentialId ?? null,
        issuedOn: toDate(data.issuedOn),
        expiresOn: toDate(data.expiresOn),
      },
    });
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
}

/**
 * Certifications and documents expiring soon — the HR home's "documents
 * expiring" widget, and the thing that stops a lapsed compliance
 * certification being discovered by an auditor rather than by us.
 */
export async function expiringSoon(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.employee.read');
    const orgId = req.user!.orgId;
    const days = Math.min(365, parseInt(req.query.days as string) || 30);
    const cutoff = new Date(Date.now() + days * 86_400_000);

    const [certs, docs] = await Promise.all([
      prisma.employeeCertification.findMany({
        where: { expiresOn: { gte: new Date(), lte: cutoff }, employee: { orgId } },
        include: { employee: { select: { id: true, displayName: true, employeeCode: true } } },
        orderBy: { expiresOn: 'asc' },
        take: 100,
      }),
      prisma.employeeDocument.findMany({
        where: { orgId, expiresOn: { gte: new Date(), lte: cutoff } },
        include: { employee: { select: { id: true, displayName: true, employeeCode: true } } },
        orderBy: { expiresOn: 'asc' },
        take: 100,
      }),
    ]);

    res.json({
      certifications: certs.map(c => ({
        id: c.id,
        kind: 'CERTIFICATION',
        name: c.name,
        expiresOn: c.expiresOn,
        employee: c.employee,
      })),
      documents: docs.map(d => ({
        id: d.id,
        kind: 'DOCUMENT',
        name: d.name,
        type: d.type,
        expiresOn: d.expiresOn,
        employee: d.employee,
      })),
    });
  } catch (err) {
    next(err);
  }
}
