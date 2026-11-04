import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';

// The settings form always submits every field, including ones the admin
// left blank (logoUrl, faviconUrl, supportEmail default to '' in the client
// state) — treat an empty string the same as "not provided" instead of
// failing .url()/.email() validation on it, which previously 400'd the
// *entire* save (including the fields that were actually filled in) any
// time an optional field was left empty.
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

const Schema = z.object({
  logoUrl:       z.preprocess(emptyToUndefined, z.string().url().optional()),
  faviconUrl:    z.preprocess(emptyToUndefined, z.string().url().optional()),
  companyName:   z.string().optional(),
  primaryColor:  z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#2563eb'),
  supportEmail:  z.preprocess(emptyToUndefined, z.string().email().optional()),
  portalTitle:   z.string().default('Support Portal'),
  portalWelcome: z.string().optional(),
});

export async function getBranding(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const branding = await prisma.orgBranding.findUnique({ where: { orgId: req.user!.orgId } });
    res.json(branding ?? null);
  } catch (err) { next(err); }
}

export async function saveBranding(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const data = Schema.parse(req.body);
    const branding = await prisma.orgBranding.upsert({
      where: { orgId },
      create: { orgId, ...data },
      update: { ...data },
    });
    res.json(branding);
  } catch (err) { next(err); }
}

// Public endpoint — for portal to fetch branding by orgId
export async function getPublicBranding(req: any, res: Response, next: NextFunction) {
  try {
    const { orgId } = req.params;
    const branding = await prisma.orgBranding.findUnique({
      where: { orgId },
      select: { logoUrl: true, primaryColor: true, portalTitle: true, portalWelcome: true, supportEmail: true },
    });
    res.json(branding ?? { primaryColor: '#2563eb', portalTitle: 'Support Portal' });
  } catch (err) { next(err); }
}
