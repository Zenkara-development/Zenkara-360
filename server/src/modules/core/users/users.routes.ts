import { Router } from 'express';
import { authenticate, AuthRequest } from '../../../middleware/authenticate';
import { prisma } from '../../../utils/prisma';

export const usersRouter = Router();
usersRouter.use(authenticate);
usersRouter.get('/', async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.orgId;
    const users = await prisma.user.findMany({
      where: { isActive: true, orgId },
      select: { id: true, name: true, email: true, role: true, department: true, avatarUrl: true },
      orderBy: { name: 'asc' }
    });
    res.json(users);
  } catch (err) { next(err); }
});
