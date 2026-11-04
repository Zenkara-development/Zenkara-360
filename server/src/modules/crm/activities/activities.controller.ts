import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';
import { runWorkflows } from '../../../utils/workflow-engine';
import { pushCalendarEvent } from '../../../utils/googleCalendar';

const Schema = z.object({
  type: z.enum(['CALL','EMAIL','MEETING','TASK']),
  title: z.string().min(1),
  body: z.string().optional(),
  dealId: z.string().optional(),
  contactId: z.string().optional(),
  // Follow-up activities against a Lead — the CRM had no way to schedule a
  // call/email/task on a lead before converting it to a deal; this closes
  // that gap without a separate lead-only activity model.
  leadId: z.string().optional(),
  dueAt: z.string().optional(),
  done: z.boolean().optional(),
});

const include = { createdByUser: { select: { id: true, name: true } } };

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const { dealId, contactId, leadId } = req.query as Record<string, string>;
    const where: any = { orgId };
    if (dealId) where.dealId = dealId;
    if (contactId) where.contactId = contactId;
    if (leadId) where.leadId = leadId;
    const activities = await prisma.activity.findMany({ where, include, orderBy: [{ done: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }] });
    res.json(activities);
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = Schema.parse(req.body);
    const activity = await prisma.activity.create({
      data: {
        ...data,
        dueAt: data.dueAt ? new Date(data.dueAt) : undefined,
        createdBy: req.user!.id,
        orgId: req.user!.orgId,
      },
      include,
    });
    // Fire-and-forget — most orgs/users have no calendar connected, so this
    // is a cheap no-op for them (pushCalendarEvent returns false immediately).
    if (activity.dueAt && !activity.done) {
      pushCalendarEvent(req.user!.id, 'activities', {
        sourceId: `activity-${activity.id}`,
        summary: `[${activity.type}] ${activity.title}`,
        description: activity.body || '',
        start: activity.dueAt,
        end: new Date(activity.dueAt.getTime() + 30 * 60 * 1000),
      }).catch(() => {});
    }
    res.status(201).json(activity);
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = Schema.partial().parse(req.body);
    const orgId = req.user!.orgId;
    const existing = await prisma.activity.findFirst({ where: { id: req.params.id, orgId } });
    await prisma.activity.updateMany({
      where: { id: req.params.id, orgId },
      data: { ...data, dueAt: data.dueAt ? new Date(data.dueAt) : undefined },
    });
    const activity = await prisma.activity.findFirst({ where: { id: req.params.id, orgId }, include });
    // Completing a lead follow-up is a meaningful automation trigger point
    // (e.g. "notify manager when a lead's first-touch call is logged done").
    if (activity?.leadId && data.done === true && existing?.done === false) {
      /* The entity must be the LEAD, not the activity.
         This declared `entityType: 'LEAD'` while passing the activity as
         `entity`, so conditions were evaluated against the activity while the
         rule builder offered lead fields (status, source) — which resolved to
         undefined, meaning they never matched under `eq` and always matched
         under `neq`. Template variables like {{title}} resolved to the
         activity's subject too. Load the lead and pass it; the activity that
         triggered this rides along under `activity` so a rule can still read
         its fields. */
      const lead = await prisma.lead.findFirst({ where: { id: activity.leadId, orgId } });
      if (lead) {
        runWorkflows({
          trigger: 'LEAD_ACTIVITY_COMPLETED',
          orgId,
          entityType: 'LEAD',
          entityId: lead.id,
          entity: { ...lead, activity },
        }).catch(() => {});
      }
    }
    res.json(activity);
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.activity.deleteMany({ where: { id: req.params.id, orgId: req.user!.orgId } });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
}
