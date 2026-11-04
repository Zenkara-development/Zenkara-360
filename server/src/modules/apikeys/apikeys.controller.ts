import { Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { logAction } from '../../utils/auditLog';

const SCOPES = ['read', 'write', 'admin'] as const;

// ─── Generate a new API key ───────────────────────────────────────────────────

export async function createKey(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const { name, scopes, expiresAt } = z.object({
      name:      z.string().min(1).max(80),
      // Previously z.array(z.string()) — accepted (and silently ignored) any
      // string at all, including the resource-level scopes the old frontend
      // picker offered ("read:tickets" etc) that authenticateApiKey() below
      // never actually checked. Constraining to the 3 values it does check
      // means what you grant here is what the key can actually do.
      scopes:    z.array(z.enum(SCOPES)).default(['read']),
      expiresAt: z.string().optional(),
    }).parse(req.body);

    // Generate: crm_<32 random hex chars>
    const raw = `crm_${crypto.randomBytes(24).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(raw).digest('hex');
    const keyPrefix = raw.slice(0, 12); // e.g. "crm_a1b2c3d4"

    const key = await prisma.apiKey.create({
      data: {
        orgId,
        name,
        keyHash,
        keyPrefix,
        scopes,
        createdBy: req.user!.id,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      },
    });

    logAction(req.user!.id, 'CREATE', 'ApiKey', key.id, { name: key.name, scopes: key.scopes });
    // Return raw key only once — never stored
    res.status(201).json({ ...key, rawKey: raw });
  } catch (err) { next(err); }
}

export async function listKeys(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const keys = await prisma.apiKey.findMany({
      where: { orgId: req.user!.orgId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, keyPrefix: true, scopes: true,
        lastUsedAt: true, expiresAt: true, createdAt: true,
        creator: { select: { name: true } },
      },
    });
    res.json({ data: keys });
  } catch (err) { next(err); }
}

export async function revokeKey(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const deleted = await prisma.apiKey.deleteMany({
      where: { id: req.params.id, orgId: req.user!.orgId },
    });
    if (!deleted.count) throw new AppError(404, 'API key not found');
    logAction(req.user!.id, 'DELETE', 'ApiKey', req.params.id);
    res.json({ message: 'API key revoked' });
  } catch (err) { next(err); }
}

// ─── Middleware: authenticate via X-API-Key header ───────────────────────────

/**
 * Mounted globally in index.ts, ahead of every route — this used to be true
 * only in the sense that the middleware existed; it was never actually
 * wired into the request pipeline anywhere, so an X-API-Key header did
 * nothing and every "API key" created in Settings → API Keys was decorative.
 * Now: a request carrying X-API-Key is authenticated here (bypassing the
 * regular JWT check — see authenticate() in middleware/authenticate.ts,
 * which no-ops if req.user is already set) and scope-gated by HTTP method,
 * since the key's scopes (read/write/admin — see SCOPES above) are the only
 * granularity this API actually models. 'read' allows GET/HEAD; 'write' (or
 * 'admin') allows everything else. Requests without X-API-Key are untouched
 * and fall through to the normal JWT flow.
 */
export async function authenticateApiKey(
  req: AuthRequest, res: Response, next: NextFunction,
) {
  const header = req.headers['x-api-key'] as string | undefined;
  if (!header) return next(); // fall through to JWT auth

  const keyHash = crypto.createHash('sha256').update(header).digest('hex');
  const apiKey = await prisma.apiKey.findUnique({ where: { keyHash } });

  if (!apiKey) return res.status(401).json({ error: 'Invalid API key' });
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return res.status(401).json({ error: 'API key expired' });
  }

  const scopes = apiKey.scopes as string[];
  const isAdmin = scopes.includes('admin');
  const canWrite = isAdmin || scopes.includes('write');
  const canRead = canWrite || scopes.includes('read');
  const isWriteMethod = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);

  if (isWriteMethod && !canWrite) {
    return res.status(403).json({ error: `This API key only has read access. Add the "write" scope to make ${req.method} requests.` });
  }
  if (!isWriteMethod && !canRead) {
    return res.status(403).json({ error: 'This API key has no usable scopes configured.' });
  }

  // Update last used (fire-and-forget)
  prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  // Attach minimal user-like context. Role 'API' intentionally satisfies no
  // requireRole(...) check anywhere (ADMIN/MANAGERS/etc all list real user
  // roles) — an API key can reach whatever a route's requireRole would let
  // an EMPLOYEE-and-up reach only where a route has no requireRole at all.
  // Routes gated to manager/admin roles (billing, user management, this
  // apikeys module itself, org settings) stay out of reach of API keys
  // entirely, regardless of scope. That's a deliberate ceiling, not a gap —
  // key management itself should never be manageable by a key.
  /* Act as the admin who created the key (a real User row — controllers set
     ownerId/createdBy from req.user.id, so a fake id would violate FKs), but
     keep the synthetic 'API' role so requireRole() applies the key ceiling
     rather than that admin's real permissions. */
  req.user = { id: apiKey.createdBy, orgId: apiKey.orgId, role: 'API' as any, email: '' };
  (req as any).apiKeyId = apiKey.id; // for the per-key rate limiter in index.ts
  next();
}
