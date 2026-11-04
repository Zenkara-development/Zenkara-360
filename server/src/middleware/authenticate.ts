import { Request, Response, NextFunction } from 'express';
import { runWithAiContext } from '../utils/aiContext';
import jwt from 'jsonwebtoken';
import { AppError } from './errorHandler';

export interface AuthRequest extends Request {
  user?: { id: string; role: string; email: string; orgId: string };
}

// ─── Role Constants ────────────────────────────────────────────────────────────

export const R = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  IT_MANAGER:  'IT_MANAGER',
  CRM_MANAGER: 'CRM_MANAGER',
  IT_AGENT:    'IT_AGENT',
  SALES_REP:   'SALES_REP',
  EMPLOYEE:    'EMPLOYEE',
} as const;

/** Org owner only */
export const ADMIN        = [R.SUPER_ADMIN] as const;
/** All three manager-level roles */
export const MANAGERS     = [R.SUPER_ADMIN, R.IT_MANAGER, R.CRM_MANAGER] as const;
/** IT-side managers */
export const IT_MANAGERS  = [R.SUPER_ADMIN, R.IT_MANAGER] as const;
/** CRM-side managers */
export const CRM_MANAGERS = [R.SUPER_ADMIN, R.CRM_MANAGER] as const;
/** IT workers: agents + their managers */
export const IT_STAFF     = [R.SUPER_ADMIN, R.IT_MANAGER, R.IT_AGENT] as const;
/** CRM workers: reps + their managers */
export const CRM_STAFF    = [R.SUPER_ADMIN, R.CRM_MANAGER, R.SALES_REP] as const;
/** Every role except EMPLOYEE */
export const ALL_STAFF    = [R.SUPER_ADMIN, R.IT_MANAGER, R.CRM_MANAGER, R.IT_AGENT, R.SALES_REP] as const;
/** Every authenticated role */
export const ALL_USERS    = [R.SUPER_ADMIN, R.IT_MANAGER, R.CRM_MANAGER, R.IT_AGENT, R.SALES_REP, R.EMPLOYEE] as const;

// ─── Middleware ────────────────────────────────────────────────────────────────

export function authenticate(req: AuthRequest, _res: Response, next: NextFunction) {
  // authenticateApiKey (modules/apikeys/apikeys.controller.ts), mounted
  // globally ahead of every router, already populated req.user for a
  // request carrying a valid X-API-Key header — don't then demand a JWT
  // too. A request with neither header still falls through to the "no
  // token" 401 below, same as always.
  // The API-key path already set req.user upstream; still open an AI context
  // for it, or key-authenticated AI calls would be the one route that stays
  // unlogged and unbudgeted.
  if (req.user) return runWithAiContext({ orgId: req.user.orgId, userId: (req.user as any).id ?? null }, next);

  const token = req.headers.authorization?.split(' ')[1];
  if (!token) throw new AppError(401, 'Authentication required');
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as {
      id: string; role: string; email: string; orgId: string;
    };
    req.user = payload;
    /* Everything downstream of this call runs inside the store, so
       utils/ai.ts can find the org without every AI helper taking an orgId
       parameter. See utils/aiContext.ts for why it is done this way. */
    runWithAiContext({ orgId: payload.orgId, userId: payload.id }, next);
  } catch {
    throw new AppError(401, 'Invalid or expired token');
  }
}

/* Manager/admin-tier roles. Used below to decide which requireRole() gates an
   API key may pass: a route is "staff-level" if its allowed-roles list names
   at least one role outside this set. */
const ELEVATED = new Set<string>([R.SUPER_ADMIN, R.IT_MANAGER, R.CRM_MANAGER]);

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user) throw new AppError(403, 'Insufficient permissions');

    /* X-API-Key requests carry the synthetic role 'API' (see
       authenticateApiKey in modules/apikeys/apikeys.controller.ts), which no
       roles list ever names. Per /api/docs, a key may use staff-level
       endpoints (its read/write scopes were already enforced by HTTP method
       upstream) but can never reach routes gated to manager/admin roles only
       (billing, user management, API key management, org settings). A route
       is staff-level when its allowed roles include at least one
       non-manager role — e.g. CRM_STAFF lists SALES_REP, so contacts CRUD
       is open to keys, while CRM_MANAGERS/ADMIN routes stay closed. */
    if (req.user.role === 'API') {
      if (roles.some(r => !ELEVATED.has(r))) return next();
      throw new AppError(403, 'API keys cannot access admin-gated endpoints');
    }

    if (!roles.includes(req.user.role)) {
      throw new AppError(403, 'Insufficient permissions');
    }
    next();
  };
}
