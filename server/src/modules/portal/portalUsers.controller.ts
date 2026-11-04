import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { emailField } from '../../utils/zodHelpers';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { sendMail } from '../../utils/mailer';

const Schema = z.object({
  name: z.string().min(1),
  email: emailField(),
  sendInvite: z.boolean().optional().default(true),
});

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const users = await prisma.portalUser.findMany({
      where: { orgId: req.user!.orgId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(users);
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, email, sendInvite } = Schema.parse(req.body);
    const orgId = req.user!.orgId;

    const existing = await prisma.portalUser.findUnique({ where: { orgId_email: { orgId, email } } });
    if (existing) throw new AppError(409, 'A portal user with this email already exists');

    const user = await prisma.portalUser.create({ data: { name, email, orgId } });

    if (sendInvite) {
      const portalUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/portal?org=${orgId}`;
      await sendMail({
        orgId,
        to: email,
        subject: 'You\'ve been invited to the support portal',
        html: `
          <p>Hello ${name},</p>
          <p>You've been given access to the support portal. Click below to get started:</p>
          <p><a href="${portalUrl}" style="background:#4f46e5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Open Portal</a></p>
          <p>You'll receive a magic login link each time you want to sign in — no password needed.</p>
        `,
      }).catch(() => {});
    }

    res.status(201).json(user);
  } catch (err) { next(err); }
}

export async function toggleActive(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await prisma.portalUser.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!user) throw new AppError(404, 'Portal user not found');
    const updated = await prisma.portalUser.update({ where: { id: req.params.id }, data: { isActive: !user.isActive } });
    res.json(updated);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.portalUser.deleteMany({ where: { id: req.params.id, orgId: req.user!.orgId } });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
}

export async function resendInvite(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await prisma.portalUser.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!user) throw new AppError(404, 'Portal user not found');
    const orgId = req.user!.orgId;
    const portalUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/portal?org=${orgId}`;
    await sendMail({
      orgId,
      to: user.email,
      subject: 'Your portal access link',
      html: `<p>Hello ${user.name},</p><p><a href="${portalUrl}">Click here to access the support portal</a>.</p>`,
    });
    res.json({ message: 'Invite sent' });
  } catch (err) { next(err); }
}
