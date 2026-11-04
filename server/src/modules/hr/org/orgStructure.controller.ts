import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';
import { AppError } from '../../../middleware/errorHandler';
import { logAction } from '../../../utils/auditLog';
import { getPermCtx, assertCan, invalidateAllPermCtx } from '../../../utils/permissions';
import { purgeEntityChildren } from '../../../utils/entityCleanup';

/**
 * Departments, teams and locations — the org-structure primitives that
 * `User.department: String?` could not express.
 *
 * The free-text column is deliberately still written on every change (see
 * syncLegacyDepartmentString) so that reports, filters and the demo seed which
 * read `User.department` keep returning the same strings they always have. It
 * is a deprecated mirror, not a second source of truth: Department.id is
 * authoritative and the string is derived from it.
 */

// ═══ Departments ═════════════════════════════════════════════════════════════

const DepartmentSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().max(40).optional().nullable(),
  description: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
  headId: z.string().optional().nullable(),
  costCenter: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

const departmentInclude = {
  head: { select: { id: true, displayName: true, employeeCode: true } },
  parent: { select: { id: true, name: true } },
  _count: { select: { employees: true, children: true, teams: true } },
};

export async function listDepartments(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.department.read');

    const rows = await prisma.department.findMany({
      where: { orgId: req.user!.orgId },
      include: departmentInclude,
      orderBy: { name: 'asc' },
    });
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
}

/** Departments as a nested tree, for the org-structure screen. */
export async function departmentTree(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.department.read');

    const rows = await prisma.department.findMany({
      where: { orgId: req.user!.orgId, isActive: true },
      include: departmentInclude,
      orderBy: { name: 'asc' },
    });

    type Node = (typeof rows)[number] & { children: Node[] };
    const byId = new Map<string, Node>(rows.map(r => [r.id, { ...r, children: [] }]));
    const roots: Node[] = [];
    for (const node of byId.values()) {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent && parent.id !== node.id) parent.children.push(node);
      else roots.push(node);
    }
    res.json({ data: roots, total: rows.length });
  } catch (err) {
    next(err);
  }
}

export async function createDepartment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.department.create');

    const orgId = req.user!.orgId;
    const data = DepartmentSchema.parse(req.body);

    const clash = await prisma.department.findFirst({ where: { orgId, name: data.name } });
    if (clash) throw new AppError(409, 'A department with that name already exists');

    const dept = await prisma.department.create({
      data: { ...data, orgId, parentId: data.parentId ?? null, headId: data.headId ?? null },
      include: departmentInclude,
    });
    logAction(req.user!.id, 'CREATE', 'DEPARTMENT', dept.id, { name: dept.name });
    res.status(201).json(dept);
  } catch (err) {
    next(err);
  }
}

export async function updateDepartment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.department.update');

    const orgId = req.user!.orgId;
    const existing = await prisma.department.findFirst({ where: { id: req.params.id, orgId } });
    if (!existing) throw new AppError(404, 'Department not found');

    const data = DepartmentSchema.partial().parse(req.body);

    if (data.parentId) {
      if (data.parentId === existing.id) throw new AppError(400, 'A department cannot be its own parent');
      let cursor: string | null = data.parentId;
      for (let i = 0; i < 20 && cursor; i++) {
        if (cursor === existing.id) throw new AppError(400, 'That change would create a department loop');
        const next: { parentId: string | null } | null = await prisma.department.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
        cursor = next?.parentId ?? null;
      }
    }

    const dept = await prisma.department.update({
      where: { id: existing.id },
      data,
      include: departmentInclude,
    });

    if (data.name && data.name !== existing.name) await syncLegacyDepartmentString(orgId, dept.id, data.name);
    logAction(req.user!.id, 'UPDATE', 'DEPARTMENT', dept.id, { fields: Object.keys(data) });
    res.json(dept);
  } catch (err) {
    next(err);
  }
}

export async function deleteDepartment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.department.delete');

    const orgId = req.user!.orgId;
    const existing = await prisma.department.findFirst({
      where: { id: req.params.id, orgId },
      include: { _count: { select: { employees: true, children: true } } },
    });
    if (!existing) throw new AppError(404, 'Department not found');

    if (existing._count.employees > 0 || existing._count.children > 0) {
      throw new AppError(
        400,
        `This department still has ${existing._count.employees} employee(s) and ${existing._count.children} sub-department(s). Move them first, or deactivate the department instead.`
      );
    }

    await prisma.department.delete({ where: { id: existing.id } });
    await purgeEntityChildren('DEPARTMENT', existing.id, orgId);
    logAction(req.user!.id, 'DELETE', 'DEPARTMENT', existing.id, { name: existing.name });
    res.json({ message: 'Department deleted' });
  } catch (err) {
    next(err);
  }
}

/** Keeps the deprecated User.department string in step with the real record. */
async function syncLegacyDepartmentString(orgId: string, departmentId: string, name: string): Promise<void> {
  const employees = await prisma.employee.findMany({
    where: { orgId, departmentId, userId: { not: null } },
    select: { userId: true },
  });
  const userIds = employees.map(e => e.userId).filter((v): v is string => !!v);
  if (userIds.length) {
    await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { department: name } });
  }
}

// ═══ Teams ═══════════════════════════════════════════════════════════════════

const TeamSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  leadId: z.string().optional().nullable(),
  type: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

const teamInclude = {
  department: { select: { id: true, name: true } },
  lead: { select: { id: true, displayName: true } },
  members: {
    include: { employee: { select: { id: true, displayName: true, employeeCode: true, designation: true } } },
  },
};

export async function listTeams(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.team.read');
    const rows = await prisma.team.findMany({
      where: { orgId: req.user!.orgId },
      include: teamInclude,
      orderBy: { name: 'asc' },
    });
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
}

export async function createTeam(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.team.create');
    const orgId = req.user!.orgId;
    const data = TeamSchema.parse(req.body);

    const clash = await prisma.team.findFirst({ where: { orgId, name: data.name } });
    if (clash) throw new AppError(409, 'A team with that name already exists');

    const team = await prisma.team.create({
      data: { ...data, orgId, departmentId: data.departmentId ?? null, leadId: data.leadId ?? null },
      include: teamInclude,
    });
    invalidateAllPermCtx(); // team membership feeds TEAM-scoped permissions
    res.status(201).json(team);
  } catch (err) {
    next(err);
  }
}

export async function updateTeam(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.team.update');
    const existing = await prisma.team.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!existing) throw new AppError(404, 'Team not found');

    const team = await prisma.team.update({
      where: { id: existing.id },
      data: TeamSchema.partial().parse(req.body),
      include: teamInclude,
    });
    invalidateAllPermCtx();
    res.json(team);
  } catch (err) {
    next(err);
  }
}

export async function deleteTeam(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.team.delete');
    const existing = await prisma.team.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!existing) throw new AppError(404, 'Team not found');
    await prisma.team.delete({ where: { id: existing.id } });
    invalidateAllPermCtx();
    res.json({ message: 'Team deleted' });
  } catch (err) {
    next(err);
  }
}

const MemberSchema = z.object({
  employeeId: z.string().min(1),
  role: z.enum(['LEAD', 'MEMBER']).optional(),
});

export async function addTeamMember(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.team.update');
    const orgId = req.user!.orgId;

    const team = await prisma.team.findFirst({ where: { id: req.params.id, orgId }, select: { id: true } });
    if (!team) throw new AppError(404, 'Team not found');

    const data = MemberSchema.parse(req.body);
    const employee = await prisma.employee.findFirst({
      where: { id: data.employeeId, orgId },
      select: { id: true },
    });
    if (!employee) throw new AppError(404, 'Employee not found');

    const row = await prisma.teamMember.upsert({
      where: { teamId_employeeId: { teamId: team.id, employeeId: employee.id } },
      update: { role: data.role ?? 'MEMBER' },
      create: { teamId: team.id, employeeId: employee.id, role: data.role ?? 'MEMBER' },
      include: { employee: { select: { id: true, displayName: true } } },
    });
    invalidateAllPermCtx();
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
}

export async function removeTeamMember(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.team.update');
    const team = await prisma.team.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
      select: { id: true },
    });
    if (!team) throw new AppError(404, 'Team not found');

    await prisma.teamMember.deleteMany({ where: { teamId: team.id, employeeId: req.params.employeeId } });
    invalidateAllPermCtx();
    res.json({ message: 'Member removed' });
  } catch (err) {
    next(err);
  }
}

// ═══ Locations ═══════════════════════════════════════════════════════════════

const LocationSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().max(40).optional().nullable(),
  type: z.enum(['HEAD_OFFICE', 'BRANCH', 'PLANT', 'WAREHOUSE', 'CLIENT_SITE', 'REMOTE']).optional(),
  addressLine1: z.string().optional().nullable(),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  timezone: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function listLocations(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.location.read');
    const rows = await prisma.location.findMany({
      where: { orgId: req.user!.orgId },
      include: {
        _count: { select: { employees: true, officeLocations: true } },
        officeLocations: { select: { id: true, name: true, latitude: true, longitude: true, radiusMeters: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
}

export async function createLocation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.location.create');
    const orgId = req.user!.orgId;
    const data = LocationSchema.parse(req.body);

    const clash = await prisma.location.findFirst({ where: { orgId, name: data.name } });
    if (clash) throw new AppError(409, 'A location with that name already exists');

    const row = await prisma.location.create({ data: { ...data, orgId } });
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
}

export async function updateLocation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.location.update');
    const existing = await prisma.location.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
    });
    if (!existing) throw new AppError(404, 'Location not found');
    const row = await prisma.location.update({
      where: { id: existing.id },
      data: LocationSchema.partial().parse(req.body),
    });
    res.json(row);
  } catch (err) {
    next(err);
  }
}

export async function deleteLocation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'hr.location.delete');
    const existing = await prisma.location.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
      include: { _count: { select: { employees: true } } },
    });
    if (!existing) throw new AppError(404, 'Location not found');
    if (existing._count.employees > 0) {
      throw new AppError(400, `${existing._count.employees} employee(s) are assigned to this location. Move them first.`);
    }
    await prisma.location.delete({ where: { id: existing.id } });
    res.json({ message: 'Location deleted' });
  } catch (err) {
    next(err);
  }
}
