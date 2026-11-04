import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';
import { AppError } from '../../../middleware/errorHandler';

// Validated via the Intl constructors actually throwing on a bad value,
// rather than a hand-maintained list of currency codes/time zones — the
// runtime's own ICU data is the source of truth and stays current without
// needing a code change here whenever a new zone is added upstream.
function isValidCurrency(code: string): boolean {
  try { new Intl.NumberFormat('en-US', { style: 'currency', currency: code }); return true; } catch { return false; }
}
function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

const UpdateSchema = z.object({
  name: z.string().min(2).optional(),
  currency: z.string().refine(isValidCurrency, 'Not a recognized currency code (e.g. USD, EUR, INR)').optional(),
  timezone: z.string().refine(isValidTimeZone, 'Not a recognized time zone (e.g. America/New_York, Asia/Kolkata)').optional(),
});

export async function getOrg(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.user!.orgId },
      include: { _count: { select: { users: true, contacts: true, deals: true, tickets: true } } },
    });
    if (!org) throw new AppError(404, 'Organization not found');
    res.json(org);
  } catch (err) { next(err); }
}

export async function updateOrg(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = UpdateSchema.parse(req.body);
    const org = await prisma.organization.update({ where: { id: req.user!.orgId }, data });
    res.json(org);
  } catch (err) { next(err); }
}

export async function listInvites(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const invites = await prisma.inviteToken.findMany({
      where: { orgId: req.user!.orgId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(invites);
  } catch (err) { next(err); }
}
