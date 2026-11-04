import { Response, NextFunction, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { runWorkflows } from '../../utils/workflow-engine';
import { AuthRequest } from '../../middleware/authenticate';
import { notifyOrgAdmins } from '../notifications/notifications.controller';

// ─── Public: customer-facing feedback page (no auth) ──────────────────────────
//
// Reached from the emailed CSAT survey (mailer.ts's csatSurvey template) —
// both the star links (?rating=N) and the plain "leave a comment" link land
// here. This has to be a real server-rendered HTML page, not a client-side
// route: it's opened straight out of an email client with no app/session
// context, and must work with zero JavaScript.
//
// GET has no side effects on purpose — mail providers and security scanners
// routinely pre-fetch every link in an email to check for malware, which
// would silently record a 5-star rating nobody actually gave if the GET
// itself wrote to the database. The star click only *pre-selects* a value
// in the form; the customer's Submit click (a real POST, from the page's
// own <form>) is what actually records anything.

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: -apple-system, Arial, sans-serif; max-width: 460px; margin: 64px auto; padding: 0 20px; color: #111827; text-align: center; }
  h1 { font-size: 19px; margin-bottom: 6px; }
  p.sub { color: #6b7280; font-size: 14px; margin-top: 0; }
  .stars { display: flex; flex-direction: row-reverse; justify-content: center; gap: 2px; margin: 20px 0 4px; }
  .stars input { position: absolute; opacity: 0; width: 0; height: 0; }
  .stars label { font-size: 38px; line-height: 1; color: #d1d5db; cursor: pointer; }
  .stars input:checked ~ label, .stars label:hover, .stars label:hover ~ label { color: #f59e0b; }
  textarea { width: 100%; min-height: 90px; margin-top: 18px; padding: 10px; border: 1px solid #e5e7eb; border-radius: 8px; font: inherit; font-size: 14px; box-sizing: border-box; resize: vertical; }
  button { margin-top: 16px; background: #4f46e5; color: #fff; border: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 14px; }
  button:hover { background: #4338ca; }
  .thanks { color: #16a34a; }
</style></head>
<body>${body}</body></html>`;
}

function feedbackForm(ticketId: string, rating: number | undefined, comment: string): string {
  const starInput = (n: number) => `<input type="radio" id="star${n}" name="rating" value="${n}" ${rating === n ? 'checked' : ''} required />
    <label for="star${n}" aria-label="${n} star${n === 1 ? '' : 's'}">★</label>`;
  return page('Rate your support experience', `
    <h1>How was your support experience?</h1>
    <p class="sub">Your feedback helps us do better.</p>
    <form method="POST" action="/api/csat/submit/${ticketId}">
      <div class="stars">${[5, 4, 3, 2, 1].map(starInput).join('')}</div>
      <textarea name="comment" placeholder="Anything you'd like to add? (optional)">${escapeHtml(comment)}</textarea>
      <br/><button type="submit">Submit Feedback</button>
    </form>
  `);
}

function thanksPage(rating: number, comment: string): string {
  const starDisplay = (n: number) => `<span style="font-size:28px;color:${n <= rating ? '#f59e0b' : '#d1d5db'}">★</span>`;
  return page('Thanks for your feedback!', `
    <h1 class="thanks">Thanks for your feedback!</h1>
    <p class="sub">We appreciate you taking the time to help us improve.</p>
    <div style="margin:18px 0 4px">${[5, 4, 3, 2, 1].map(starDisplay).join('')}</div>
    <p class="sub" style="margin-top:0">You rated us ${rating} out of 5</p>
    ${comment ? `<p style="text-align:left;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-top:12px;font-size:14px;color:#374151;white-space:pre-wrap">${escapeHtml(comment)}</p>` : ''}
  `);
}

function invalidLinkPage(): string {
  return page('Feedback link invalid', `
    <h1>This feedback link isn't valid</h1>
    <p class="sub">It may have expired, or the ticket no longer exists.</p>
  `);
}

/** GET /csat/submit/:ticketId — shows the feedback form (star pre-selected from ?rating=, if present). No database writes here — see the file-level comment on why. */
export async function showForm(req: Request, res: Response, next: NextFunction) {
  try {
    const { ticketId } = req.params;
    const ratingParam = Number(req.query.rating);
    const rating = Number.isInteger(ratingParam) && ratingParam >= 1 && ratingParam <= 5 ? ratingParam : undefined;

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { id: true } });
    if (!ticket) { res.status(404).send(invalidLinkPage()); return; }

    // Pre-fill from any existing response so revisiting the link (or
    // clicking a different star than before) doesn't discard what they
    // already told us.
    const existing = await prisma.csatResponse.findFirst({ where: { ticketId } });
    res.send(feedbackForm(ticketId, rating ?? existing?.rating, existing?.comment ?? ''));
  } catch (err) { next(err); }
}

const SubmitSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

/** POST /csat/submit/:ticketId — the feedback page's own form target. Upserts rather than rejecting a second submission, so adding a comment after an earlier star-only submit still gets recorded. */
export async function submitRating(req: Request, res: Response, next: NextFunction) {
  try {
    const { ticketId } = req.params;
    const { rating, comment } = SubmitSchema.parse(req.body);

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) { res.status(404).send(invalidLinkPage()); return; }

    const existing = await prisma.csatResponse.findFirst({ where: { ticketId } });
    const response = existing
      ? await prisma.csatResponse.update({ where: { id: existing.id }, data: { rating, comment: comment || existing.comment } })
      : await prisma.csatResponse.create({ data: { orgId: ticket.orgId, ticketId, rating, comment } });

    // Let admins/managers know feedback came in (visible in the bell + push,
    // and now also in Reports → Feedback — see client/src/pages/ReportsPage.tsx).
    // Only fire on the *first* submission — re-submitting a comment via the
    // same link would otherwise re-notify for something admins already saw.
    if (!existing) {
      const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
      notifyOrgAdmins({
        orgId: ticket.orgId,
        type: 'CSAT_SUBMITTED',
        title: `Feedback received: ${stars}`,
        body: comment ? `"${comment}"` : undefined,
        entityType: 'TICKET',
        entityId: ticketId,
      }).catch(() => {});

      /* Automation hook — entityType stays TICKET (the record staff act on),
         with the rating/comment merged into the entity so a rule can filter
         `rating lt 3` and, say, open a follow-up ticket or page a manager. */
      runWorkflows({
        trigger: 'CSAT_RECEIVED', orgId: ticket.orgId, entityType: 'TICKET', entityId: ticketId,
        entity: { ...(ticket as any), rating, comment: comment || '' },
      }).catch(() => {});
    }

    // A browser form post wants a page back; keep the old JSON response for
    // any non-browser (fetch/API) caller of the same endpoint.
    if (req.headers.accept?.includes('text/html')) {
      res.send(thanksPage(response.rating, response.comment || ''));
      return;
    }
    res.status(201).json({ message: 'Thank you for your feedback!', rating: response.rating });
  } catch (err) { next(err); }
}

// ─── Admin: list CSAT responses ───────────────────────────────────────────────

export async function listResponses(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    // Named pageNum, not page — a module-level page() HTML-template helper
    // is already in scope above (shadowing would still compile fine, just
    // needlessly confusing to read).
    const pageNum = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);

    const [data, total] = await Promise.all([
      prisma.csatResponse.findMany({
        where: { orgId },
        orderBy: { submittedAt: 'desc' },
        skip: (pageNum - 1) * limit,
        take: limit,
        include: {
          ticket: { select: { id: true, title: true, status: true } },
        },
      }),
      prisma.csatResponse.count({ where: { orgId } }),
    ]);
    res.json({ data, total, page: pageNum, limit });
  } catch (err) { next(err); }
}

// ─── Admin: CSAT analytics ────────────────────────────────────────────────────

export async function csatStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const responses = await prisma.csatResponse.findMany({ where: { orgId }, select: { rating: true } });
    const total = responses.length;
    const avg = total ? responses.reduce((s, r) => s + r.rating, 0) / total : 0;
    const dist = [1, 2, 3, 4, 5].map(r => ({
      rating: r,
      count: responses.filter(x => x.rating === r).length,
    }));
    const satisfied = responses.filter(r => r.rating >= 4).length;
    const satisfactionRate = total ? Math.round((satisfied / total) * 100) : 0;

    res.json({ total, avg: Math.round(avg * 10) / 10, dist, satisfactionRate });
  } catch (err) { next(err); }
}
