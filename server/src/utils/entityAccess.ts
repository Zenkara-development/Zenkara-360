import { prisma } from './prisma';
import { AppError } from '../middleware/errorHandler';

// Shared by every polymorphic (entityType + entityId) feature — Comments and
// Attachments today. Single source of truth for which Prisma model backs
// each EntityType value, so adding a new entity type to one doesn't
// silently leave the other out of sync.
export const ENTITY_MODEL: Record<string, {
  findFirst: (args: any) => Promise<any>;
  /** Used by entityCleanup's orphan sweep to ask "which of these ids still exist?". */
  findMany: (args: any) => Promise<any>;
}> = {
  DEAL: prisma.deal,
  TICKET: prisma.ticket,
  CONTACT: prisma.contact,
  LEAD: prisma.lead,
  ACCOUNT: prisma.account,
  CHANGE_REQUEST: prisma.changeRequest,
  QUOTE: prisma.quote,
  ASSET: prisma.asset,
  CAMPAIGN: prisma.campaign,
  // Added with the people/task/approval platform. Every EntityType enum value
  // needs an entry here or polymorphic comments/attachments 404 for that type.
  EMPLOYEE: prisma.employee,
  TASK: prisma.task,
  APPROVAL_REQUEST: prisma.approvalRequest,
  DEPARTMENT: prisma.department,
  INVOICE: prisma.invoice,
};

/** Confirms the referenced Deal/Ticket/Contact/etc. actually belongs to the
 * caller's org before any polymorphic read/write touches it — a guessed
 * entityId from another tenant must never resolve to real data. */
export async function assertEntityInOrg(entityType: string, entityId: string, orgId: string): Promise<void> {
  const model = ENTITY_MODEL[entityType];
  const record = model && await model.findFirst({ where: { id: entityId, orgId }, select: { id: true } });
  if (!record) throw new AppError(404, 'Not found');
}
