import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface PortalRequest extends Request {
  portal?: { portalUserId: string; orgId: string };
}

export function authenticatePortal(req: PortalRequest, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Portal token required' });
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as any;
    if (payload.iss !== 'portal') return res.status(401).json({ error: 'Invalid portal token' });
    req.portal = { portalUserId: payload.sub, orgId: payload.orgId };
    next();
  } catch {
    res.status(401).json({ error: 'Portal token expired or invalid' });
  }
}
