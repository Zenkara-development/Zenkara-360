import { Response, NextFunction } from 'express';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';

export async function listAuditLogs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
    const { action, entityType, userId, search } = req.query as Record<string, string>;

    // AuditLog has no orgId — scope by user's org via relation
    const where: any = { user: { orgId } };
    if (action) where.action = action;
    if (entityType) where.entityType = entityType;
    if (userId) where.userId = userId;
    if (search) where.OR = [
      { entityId: { contains: search, mode: 'insensitive' } },
    ];

    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ data, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
}
