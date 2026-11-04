import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

// READ added for GDPR data-export logging (gdpr.controller.ts) — exporting
// someone's personal/org data is worth an audit trail even though nothing
// is modified.
type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'READ';

/**
 * Write an audit log entry asynchronously (fire-and-forget).
 * Never throws — a logging failure must never break the main request.
 */
export function logAction(
  userId: string,
  action: AuditAction,
  entityType: string,
  entityId: string,
  changes?: Record<string, unknown>
): void {
  prisma.auditLog.create({
    data: {
      userId,
      action,
      entityType,
      entityId,
      ...(changes !== undefined && { changes: changes as Prisma.InputJsonValue }),
    },
  }).catch(err => {
    console.error('[audit-log] Failed to write entry:', err);
  });
}
