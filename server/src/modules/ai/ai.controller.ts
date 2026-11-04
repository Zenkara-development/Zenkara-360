import { Response, NextFunction } from 'express';
import { AppError } from '../../middleware/errorHandler';
import { runAiRuleManually } from '../../utils/ai-rules';
import { runAiRules } from '../../utils/ai-rules';
import { complete } from '../../utils/aiGateway';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest, IT_STAFF } from '../../middleware/authenticate';
import {
  scoreLead,
  generateFollowUp,
  analyzeTicketSentiment,
  suggestTicketReply,
  naturalLanguageQuery,
  autoRouteTicket,
  generateKbArticle,
  generateInvoiceReminder,
  detectDuplicates,
  summarizeThread,
  estimateResolutionTime,
  predictSlaBreach,
  calculateWinProbability,
  generatePipelineHealth,
  detectChurnRisk,
  generateNurtureSequence,
  parseMeetingNotes,
  generateInsights,
  checkEmailTone,
  parseNaturalLanguageCommand,
  planAiAction,
  routeChatTurn,
} from '../../utils/ai';
import { getAiAction, actionMenuForPrompt, listActionsForRole } from '../../utils/ai-actions';
import { logAction } from '../../utils/auditLog';

// getClient() (utils/ai.ts) prefers GROQ_API_KEY over OPENAI_API_KEY whenever
// both are set, so whichever one is actually configured is whichever error
// message here should mention — this used to hardcode "OpenAI" regardless,
// which is actively misleading on a Groq-only setup (a Groq 429 read as
// "add OpenAI billing" sends someone to the wrong dashboard entirely).
const usingGroq = !!process.env.GROQ_API_KEY;

function handleAIError(err: any, res: Response): boolean {
  if (err?.status === 429 || err?.code === 'insufficient_quota') {
    // Groq's free tier enforces per-minute/per-day request and token caps
    // rather than a billing balance — a 429 there almost always means "wait
    // for the rate limit to reset" or "usage cap hit", not "no money left",
    // so the guidance differs meaningfully from OpenAI's quota model.
    res.status(402).json({
      error: usingGroq
        ? 'Groq rate limit or usage cap reached. Check your usage at console.groq.com — this is usually temporary and clears within a minute, but a sustained cap means it\'s time to upgrade your Groq plan.'
        : 'OpenAI quota exceeded. Add billing credits at platform.openai.com.',
    });
    return true;
  }
  if (err?.status === 401) {
    res.status(401).json({ error: usingGroq ? 'Invalid API key. Check GROQ_API_KEY in server/.env and restart the server.' : 'Invalid API key. Check OPENAI_API_KEY in server/.env and restart the server.' });
    return true;
  }
  return false; // caller must call next(err)
}

// ─── Lead: Score ──────────────────────────────────────────────────────────────

export async function scoreLeadHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, orgId },
      include: {
        contact: { select: { name: true, email: true, jobTitle: true } },
      },
    });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const result = await scoreLead(lead);

    /* Only write a genuine assessment. When AI is unconfigured or the reply
       was unparseable, scoreLead returns scored:false with a placeholder 50 —
       persisting that made "no AI" indistinguishable from "scored 50/100",
       and the lead then looked scored so bulk scoring skipped it forever. */
    if (result.scored) {
      await prisma.lead.updateMany({
        where: { id: req.params.id, orgId },
        data: { aiScore: result.score, aiScoreReason: result.reason },
      });
      runAiRules({ trigger: 'LEAD_SCORED', orgId, entityType: 'LEAD', entityId: req.params.id, entity: { ...lead, aiScore: result.score }, userId: req.user!.id });
    }

    res.json(result);
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Lead: Follow-up Email ────────────────────────────────────────────────────

export async function leadFollowUpHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, orgId },
      include: { contact: { select: { name: true, email: true } } },
    });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const result = await generateFollowUp({
      type: 'lead',
      title: lead.contact?.name || 'Lead',
      contactName: lead.contact?.name ?? undefined,
      contactEmail: lead.contact?.email ?? undefined,
      notes: lead.notes ?? undefined,
    });
    res.json(result);
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Deal: Follow-up Email ────────────────────────────────────────────────────

export async function dealFollowUpHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const deal = await prisma.deal.findFirst({
      where: { id: req.params.id, orgId },
      include: { contact: { select: { name: true, email: true } } },
    });
    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    const result = await generateFollowUp({
      type: 'deal',
      title: deal.title,
      stage: deal.stage,
      contactName: deal.contact?.name ?? undefined,
      contactEmail: deal.contact?.email ?? undefined,
      value: Number(deal.value),
    });
    res.json(result);
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Ticket: Sentiment ────────────────────────────────────────────────────────

export async function ticketSentimentHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const ticket = await prisma.ticket.findFirst({ where: { id: req.params.id, orgId } });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const sentiment = await analyzeTicketSentiment({
      title: ticket.title,
      body: ticket.body,
      priority: ticket.priority,
    });

    await prisma.ticket.updateMany({
      where: { id: req.params.id, orgId },
      data: { sentiment },
    });

    res.json({ sentiment });
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Ticket: AI Reply Suggestion ──────────────────────────────────────────────

export async function ticketReplyHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const ticket = await prisma.ticket.findFirst({
      where: { id: req.params.id, orgId },
      include: { category: { select: { name: true } } },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    // Pull up to 3 published KB articles to help the AI
    const articles = await prisma.knowledgeArticle.findMany({
      where: { orgId, status: 'PUBLISHED' },
      select: { title: true, body: true },
      take: 3,
    });

    const reply = await suggestTicketReply(
      {
        title: ticket.title,
        body: ticket.body,
        priority: ticket.priority,
        category: ticket.category?.name ?? null,
      },
      articles
    );
    res.json({ reply });
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Ticket: AI Auto-Routing ──────────────────────────────────────────────────

export async function autoRouteHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const ticket = await prisma.ticket.findFirst({
      where: { id: req.params.id, orgId },
      include: { category: { select: { name: true } } },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const [categories, agents] = await Promise.all([
      prisma.category.findMany({ where: { orgId }, select: { id: true, name: true } }),
      prisma.user.findMany({
        where: { orgId, role: { in: ['IT_AGENT', 'IT_MANAGER', 'SUPER_ADMIN'] } },
        select: { id: true, name: true, role: true },
      }),
    ]);

    const { apply } = req.body as { apply?: boolean };
    const result = await autoRouteTicket(
      { title: ticket.title, body: ticket.body, priority: ticket.priority },
      categories,
      agents
    );

    if (apply && (result.categoryId || result.agentId)) {
      await prisma.ticket.updateMany({
        where: { id: req.params.id, orgId },
        data: {
          ...(result.categoryId ? { categoryId: result.categoryId } : {}),
          ...(result.agentId ? { assignedTo: result.agentId } : {}),
        },
      });
    }

    res.json({ ...result, applied: apply ?? false });
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Natural Language Dashboard Query ────────────────────────────────────────

export async function nlQueryHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { question } = z.object({ question: z.string().min(1).max(500) }).parse(req.body);
    const orgId = req.user!.orgId;

    const [
      totalDeals, openDeals, wonDeals, lostDeals,
      totalContacts, totalTickets, openTickets, resolvedTickets,
      totalLeads, activeLeads,
    ] = await Promise.all([
      prisma.deal.count({ where: { orgId } }),
      prisma.deal.count({ where: { orgId, status: 'OPEN' } }),
      prisma.deal.count({ where: { orgId, status: 'WON' } }),
      prisma.deal.count({ where: { orgId, status: 'LOST' } }),
      prisma.contact.count({ where: { orgId } }),
      prisma.ticket.count({ where: { orgId } }),
      prisma.ticket.count({ where: { orgId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      prisma.ticket.count({ where: { orgId, status: 'RESOLVED' } }),
      prisma.lead.count({ where: { orgId } }),
      prisma.lead.count({ where: { orgId, status: { notIn: ['CONVERTED', 'UNQUALIFIED'] } } }),
    ]);

    // Calculate forecast from open deals
    const openDealData = await prisma.deal.findMany({
      where: { orgId, status: 'OPEN' },
      select: { value: true, probability: true },
    });
    const forecastRevenue = Math.round(
      openDealData.reduce((sum, d) => sum + (Number(d.value) * d.probability / 100), 0)
    );

    const answer = await naturalLanguageQuery(question, {
      totalDeals, openDeals, wonDeals, lostDeals,
      totalContacts, totalTickets, openTickets, resolvedTickets,
      totalLeads, activeLeads, forecastRevenue,
    });

    res.json({ answer, question });
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── KB Article Generator ─────────────────────────────────────────────────────
export async function kbArticleHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const ticket = await prisma.ticket.findFirst({
      where: { id: req.params.id, orgId },
      include: { category: { select: { name: true } } },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    const comments = await prisma.comment.findMany({
      where: { entityType: 'TICKET', entityId: req.params.id },
      include: { author: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const result = await generateKbArticle(
      { title: ticket.title, body: ticket.body, priority: ticket.priority, category: ticket.category?.name },
      comments.map(c => ({ body: c.body, author: (c as any).author?.name }))
    );
    res.json(result);
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Invoice Payment Reminder ─────────────────────────────────────────────────
export async function invoiceReminderHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const invoice = await prisma.invoice.findFirst({
      where: { id: req.params.id, orgId },
      include: { lines: true, deal: { select: { contact: { select: { name: true } } } }, org: { select: { name: true, currency: true } } },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    const subtotal = invoice.lines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitPrice) * (1 - Number(l.discount ?? 0) / 100), 0);
    const total = Math.round(subtotal * (1 + Number(invoice.taxRate) / 100) * 100) / 100;
    const result = await generateInvoiceReminder({
      invoiceNumber: invoice.invoiceNumber, title: invoice.title, total,
      currency: (invoice as any).org?.currency, dueDate: invoice.dueDate, status: invoice.status,
      contactName: (invoice as any).deal?.contact?.name, orgName: (invoice as any).org?.name,
    });
    res.json(result);
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Duplicate Detector ───────────────────────────────────────────────────────
export async function duplicateDetectHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { title, body } = z.object({ title: z.string(), body: z.string().optional().default('') }).parse(req.body);
    const orgId = req.user!.orgId;
    const existing = await prisma.ticket.findMany({
      where: { orgId, status: { not: 'RESOLVED' } },
      select: { id: true, title: true, body: true, status: true },
      take: 30,
      orderBy: { createdAt: 'desc' },
    });
    const result = await detectDuplicates({ title, body }, existing);
    res.json(result);
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Thread Summarizer ────────────────────────────────────────────────────────
export async function summarizeHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const ticket = await prisma.ticket.findFirst({ where: { id: req.params.id, orgId } });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    const comments = await prisma.comment.findMany({
      where: { entityType: 'TICKET', entityId: req.params.id },
      include: { author: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const summary = await summarizeThread(
      { title: ticket.title, body: ticket.body },
      comments.map(c => ({ body: c.body, author: (c as any).author?.name, createdAt: c.createdAt }))
    );
    res.json({ summary });
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Resolution Time Estimator ────────────────────────────────────────────────
export async function estimateHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const ticket = await prisma.ticket.findFirst({
      where: { id: req.params.id, orgId },
      include: { category: { select: { name: true } } },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    const result = await estimateResolutionTime({
      title: ticket.title, body: ticket.body, priority: ticket.priority, category: ticket.category?.name,
    });
    res.json(result);
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── SLA Breach Predictor ─────────────────────────────────────────────────────
export async function slaRiskHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const ticket = await prisma.ticket.findFirst({ where: { id: req.params.id, orgId } });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    const commentCount = await prisma.comment.count({ where: { entityType: 'TICKET', entityId: req.params.id } });
    const result = await predictSlaBreach({
      title: ticket.title, body: ticket.body, priority: ticket.priority,
      createdAt: ticket.createdAt, slaDeadline: (ticket as any).slaDeadline,
      responseCount: commentCount,
    });
    res.json(result);
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Deal Win Probability ─────────────────────────────────────────────────────
export async function winProbabilityHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const deal = await prisma.deal.findFirst({
      where: { id: req.params.id, orgId },
      include: { contact: { select: { name: true } } },
    });
    if (!deal) return res.status(404).json({ error: 'Deal not found' });
    const wonCount = await prisma.deal.count({ where: { orgId, status: 'WON' } });
    const totalClosed = await prisma.deal.count({ where: { orgId, status: { in: ['WON','LOST'] } } });
    const orgWinRate = totalClosed > 0 ? Math.round((wonCount / totalClosed) * 100) : 30;
    const daysOpen = Math.floor((Date.now() - new Date(deal.createdAt).getTime()) / 86400000);
    const result = await calculateWinProbability(
      { title: deal.title, value: Number(deal.value), stage: deal.stage, probability: deal.probability, daysOpen, contactName: deal.contact?.name },
      orgWinRate
    );
    res.json(result);
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Pipeline Health Report ───────────────────────────────────────────────────
export async function pipelineHealthHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const [totalDeals, openDeals, wonDeals, lostDeals] = await Promise.all([
      prisma.deal.count({ where: { orgId } }),
      prisma.deal.count({ where: { orgId, status: 'OPEN' } }),
      prisma.deal.count({ where: { orgId, status: 'WON' } }),
      prisma.deal.count({ where: { orgId, status: 'LOST' } }),
    ]);
    const openDealData = await prisma.deal.findMany({
      where: { orgId, status: 'OPEN' },
      select: { value: true, stage: true, createdAt: true },
    });
    const totalValue = openDealData.reduce((s, d) => s + Number(d.value), 0);
    const now = Date.now();
    const avgDaysOpen = openDealData.length > 0
      ? openDealData.reduce((s, d) => s + (now - new Date(d.createdAt).getTime()) / 86400000, 0) / openDealData.length
      : 0;
    const staleDealCount = openDealData.filter(d => (now - new Date(d.createdAt).getTime()) / 86400000 > 14).length;
    const stageMap: Record<string, { count: number; value: number }> = {};
    for (const d of openDealData) {
      if (!stageMap[d.stage]) stageMap[d.stage] = { count: 0, value: 0 };
      stageMap[d.stage].count++;
      stageMap[d.stage].value += Number(d.value);
    }
    const stageBreakdown = Object.entries(stageMap).map(([stage, v]) => ({ stage, ...v }));
    const result = await generatePipelineHealth({ totalDeals, openDeals, wonDeals, lostDeals, totalValue, avgDaysOpen: Math.round(avgDaysOpen), staleDealCount, stageBreakdown });
    res.json(result);
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Churn Risk ───────────────────────────────────────────────────────────────
export async function churnRiskHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const contact = await prisma.contact.findFirst({ where: { id: req.params.id, orgId } });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    /* Scoped to THIS contact. It previously selected the 10 most recent
       tickets in the whole organisation, so every contact was assessed
       against the same unrelated ticket set and the resulting "churn risk"
       said nothing about the customer it was attached to. */
    const recentTickets = await prisma.ticket.findMany({
      where: { orgId, contactId: contact.id },
      select: { sentiment: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    const result = await detectChurnRisk(
      { name: contact.name, createdAt: contact.createdAt },
      recentTickets
    );
    res.json(result);
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Nurture Sequence ─────────────────────────────────────────────────────────
export async function nurtureSequenceHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, orgId },
      include: { contact: { select: { name: true, email: true } } },
    });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const result = await generateNurtureSequence({
      status: lead.status, source: lead.source, notes: lead.notes,
      contactName: lead.contact?.name, contactEmail: lead.contact?.email ?? undefined,
    });
    res.json({ sequence: result });
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Meeting Notes Parser ─────────────────────────────────────────────────────
export async function meetingNotesHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { notes } = z.object({ notes: z.string().min(10).max(10000) }).parse(req.body);
    const result = await parseMeetingNotes(notes);
    res.json(result);
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── AI Insights ──────────────────────────────────────────────────────────────
export async function insightsHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const now = Date.now();
    const weekAgo = new Date(now - 7 * 86400000);
    const [openDeals, openTickets, recentTickets, weeklyLeads, unfollowedLeads] = await Promise.all([
      prisma.deal.findMany({ where: { orgId, status: 'OPEN' }, select: { value: true, createdAt: true } }),
      prisma.ticket.findMany({ where: { orgId, status: { in: ['OPEN','IN_PROGRESS'] } }, select: { createdAt: true } }),
      prisma.ticket.count({ where: { orgId, createdAt: { gte: weekAgo } } }),
      prisma.lead.count({ where: { orgId, createdAt: { gte: weekAgo } } }),
      prisma.lead.count({ where: { orgId, status: 'NEW' } }),
    ]);
    // Count SLA-breached tickets: slaDueAt is past and ticket is not resolved/closed
    const slaBreached = await prisma.ticket.count({
      where: { orgId, slaDueAt: { lt: new Date() }, status: { notIn: ['RESOLVED', 'CLOSED'] } },
    });
    const staleDealCount = openDeals.filter(d => (now - new Date(d.createdAt).getTime()) / 86400000 > 14).length;
    const staleDealValue = openDeals.filter(d => (now - new Date(d.createdAt).getTime()) / 86400000 > 14).reduce((s, d) => s + Number(d.value), 0);
    const avgTicketAgeHours = openTickets.length > 0 ? openTickets.reduce((s, t) => s + (now - new Date(t.createdAt).getTime()) / 3600000, 0) / openTickets.length : 0;
    const negativeTickets = await prisma.ticket.count({ where: { orgId, sentiment: { in: ['NEGATIVE','FRUSTRATED'] }, status: { not: 'RESOLVED' } } });
    const result = await generateInsights({ staleDealCount, staleDealValue: Math.round(staleDealValue), openTickets: openTickets.length, avgTicketAgeHours: Math.round(avgTicketAgeHours), slaBreachedCount: slaBreached, weeklyTicketGrowth: recentTickets, weeklyLeadsGrowth: weeklyLeads, unfollowedLeads, topNegativeTickets: negativeTickets });
    res.json({ insights: result });
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Tone Checker ─────────────────────────────────────────────────────────────
export async function toneCheckHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { subject, body, context } = z.object({
      subject: z.string(),
      body: z.string().min(10),
      context: z.string().optional(),
    }).parse(req.body);
    const result = await checkEmailTone({ subject, body, context });
    res.json(result);
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Natural Language Command (AI CRUD) ───────────────────────────────────────
export async function nlCommandHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { command } = z.object({ command: z.string().min(3).max(500) }).parse(req.body);
    const orgId = req.user!.orgId;
    const [users, categories, contacts] = await Promise.all([
      prisma.user.findMany({ where: { orgId }, select: { id: true, name: true }, take: 20 }),
      prisma.category.findMany({ where: { orgId }, select: { id: true, name: true } }),
      prisma.contact.findMany({ where: { orgId }, select: { id: true, name: true }, take: 30, orderBy: { createdAt: 'desc' } }),
    ]);
    const result = await parseNaturalLanguageCommand(command, { users, categories, contacts });
    res.json(result);
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Ticket: Auto-Tag ─────────────────────────────────────────────────────────
export async function autoTagHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const ticket = await prisma.ticket.findFirst({
      where: { id: req.params.id, orgId },
      include: { category: { select: { name: true } } },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    const { autoTagTicket } = await import('../../utils/ai');
    const tags = await autoTagTicket({
      title: ticket.title,
      body: ticket.body ?? '',
      category: (ticket.category as any)?.name ?? null,
    });
    res.json({ tags });
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Contact: Health Score ────────────────────────────────────────────────────
export async function contactHealthHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const contact = await prisma.contact.findFirst({
      where: { id: req.params.id, orgId },
      include: {
        deals: { select: { value: true, stage: true } },
        activities: { select: { id: true }, take: 100 },
      },
    });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const { scoreContactHealth } = await import('../../utils/ai');

    /* The prompt asks for ticket counts, but this used to pass the ACTIVITY
       count as ticketCount and hardcode negativeTickets: 0 — so the model was
       reasoning about support history it was never given. Query the real
       thing. */
    const contactTickets = await prisma.ticket.findMany({
      where: { orgId, contactId: contact.id },
      select: { sentiment: true },
    });
    const negativeTickets = contactTickets.filter(
      t => t.sentiment === 'NEGATIVE' || t.sentiment === 'FRUSTRATED',
    ).length;

    const openDealValue = (contact.deals as any[])
      .filter((d: any) => !['Won', 'Lost'].includes(d.stage))
      .reduce((sum: number, d: any) => sum + Number(d.value || 0), 0);

    const result = await scoreContactHealth({
      name: contact.name,
      createdAt: contact.createdAt,
      lastActivityAt: (contact as any).lastActivityAt ?? null,
      dealCount: (contact.deals as any[]).length,
      openDealValue,
      ticketCount: contactTickets.length,
      negativeTickets,
    });
    res.json(result);
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Deal: Predict Close Date ─────────────────────────────────────────────────
export async function dealCloseDateHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const deal = await prisma.deal.findFirst({ where: { id: req.params.id, orgId } });
    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    // Calculate historical avg close days from won deals
    const wonDeals = await prisma.deal.findMany({
      where: { orgId, stage: 'Won' },
      select: { createdAt: true, updatedAt: true },
      take: 50,
    });
    const avgDays = wonDeals.length > 0
      ? wonDeals.reduce((s, d) => s + (d.updatedAt.getTime() - d.createdAt.getTime()) / 86400000, 0) / wonDeals.length
      : 30;

    const { predictDealCloseDate } = await import('../../utils/ai');
    const result = await predictDealCloseDate({
      title: deal.title,
      stage: deal.stage,
      value: Number(deal.value),
      probability: deal.probability ?? 50,
      daysOpen: Math.floor((Date.now() - deal.createdAt.getTime()) / 86400000),
      expectedCloseDate: deal.closeDate ?? null,
      notes: null,
    }, Math.round(avgDays));
    res.json(result);
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Ticket/Deal/Lead: Competitor Detection ───────────────────────────────────
export async function competitorDetectHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const rawText = req.body?.text;
    if (!rawText || typeof rawText !== 'string') {
      return res.status(400).json({ error: 'text field is required' });
    }
    const { text, competitors } = z.object({
      text: z.string().min(1).max(5000),
      competitors: z.array(z.string()).optional(),
    }).parse(req.body);
    const { detectCompetitorMentions } = await import('../../utils/ai');
    const result = await detectCompetitorMentions(text, competitors);
    res.json(result);
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Leads: Bulk Score ────────────────────────────────────────────────────────
export async function bulkScoreHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const leads = await prisma.lead.findMany({
      where: { orgId, aiScore: null },
      include: { contact: { select: { name: true } } },
      take: 50,
    });
    if (leads.length === 0) return res.json({ scored: 0, message: 'All leads already scored' });

    const { bulkScoreLeads } = await import('../../utils/ai');
    const scored = await bulkScoreLeads(leads.map(l => ({
      id: l.id,
      status: l.status,
      source: l.source,
      notes: l.notes,
      contactName: (l.contact as any)?.name,
      daysOld: Math.floor((Date.now() - l.createdAt.getTime()) / 86400000),
    })));

    /* bulkScoreLeads now returns only validated rows whose id was in the
       batch we sent, and returns [] rather than a page of placeholder 50s when
       AI is unconfigured — so an empty result must not be reported as success. */
    if (scored.length === 0) {
      return res.json({
        scored: 0,
        results: [],
        message: 'No leads were scored — check that an AI provider is configured.',
      });
    }

    await Promise.all(scored.map(s =>
      prisma.lead.updateMany({ where: { id: s.id, orgId }, data: { aiScore: s.score, aiScoreReason: s.reason } })
    ));
    res.json({ scored: scored.length, results: scored });
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── AI Actions: List (metadata for the "what can I say" help panel) ────────
// No LLM call here at all — just the same static registry actions/plan and
// actions/execute already validate against, filtered to this user's role and
// reshaped for display. Deliberately NOT behind requireFeature('ai_advanced')
// like the actual AI endpoints below: it costs nothing to serve and a
// FREE-plan org should still be able to see what AI actions exist (arguably
// useful as an upgrade nudge), even though running one is gated.
const LEGACY_COMMAND_EXAMPLES = [
  { entity: 'ticket',  label: 'Ticket',  example: 'Create a new ticket about VPN issues' },
  { entity: 'contact', label: 'Contact', example: 'Add a contact named Jane Smith from Acme Corp' },
  { entity: 'lead',    label: 'Lead',    example: 'New lead from LinkedIn named John Doe' },
  { entity: 'deal',    label: 'Deal',    example: 'Create a deal with Acme Corp worth $50,000' },
  { entity: 'article', label: 'KB Article', example: 'Write a KB article about resetting a forgotten password' },
];

export async function listActionsHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({
      actions: listActionsForRole(req.user!.role),
      legacy: LEGACY_COMMAND_EXAMPLES,
    });
  } catch (err) { next(err); }
}

// ─── AI Actions: Plan (parse only — no mutation) ─────────────────────────────
// Companion to nlCommandHandler above, but for the whitelisted action
// registry (state changes / reminders / notes / scoring / toggles) rather
// than the 5-entity create/update flow. This endpoint never writes anything
// — it only asks the model to pick an action + params, which the client then
// shows to the user to confirm before calling executeActionHandler below.
/**
 * Shared plan builder — gathers the org context menu (deals, tickets, users,
 * leave requests, …) and asks the model to pick one whitelisted action.
 * Called by planActionHandler (command bar), chatCopilotHandler (chat), and
 * conversationPlanHandler (file-a-conversation) so all three surfaces agree.
 */
export async function buildActionPlanForOrg(orgId: string, role: string, command: string) {
  {

    const [
      deals, tickets, leads, rules, contacts, modules, assignableUsers,
      quotes, invoices, campaigns, assets, leaveTypes, pendingLeaveRequests, orgUsers,
    ] = await Promise.all([
      prisma.deal.findMany({ where: { orgId }, select: { id: true, title: true, stage: true }, take: 25, orderBy: { updatedAt: 'desc' } }),
      prisma.ticket.findMany({ where: { orgId }, select: { id: true, title: true, status: true }, take: 25, orderBy: { updatedAt: 'desc' } }),
      prisma.lead.findMany({ where: { orgId }, select: { id: true, contact: { select: { name: true } } }, take: 25, orderBy: { createdAt: 'desc' } }),
      prisma.workflowRule.findMany({ where: { orgId }, select: { id: true, name: true, isActive: true }, take: 25 }),
      prisma.contact.findMany({ where: { orgId }, select: { id: true, name: true }, take: 25, orderBy: { createdAt: 'desc' } }),
      // Active modules only, but deliberately NOT filtered to "has fields" —
      // unlike the sidebar's nav injection (AppLayout.tsx), a fieldless
      // module is still a valid target here: it's exactly what
      // ADD_CUSTOM_MODULE_FIELD needs to add someone's first field to a
      // module they just created via CREATE_CUSTOM_MODULE.
      prisma.customModule.findMany({
        where: { orgId, isActive: true },
        // stages so the planner can name a stage key for CREATE/MOVE actions
        // (Phase 5); isPrimary so record titles can be computed below.
        select: { id: true, name: true, stages: true, fields: { select: { fieldKey: true, label: true, fieldType: true, isPrimary: true }, orderBy: { position: 'asc' } } },
        take: 25,
      }),
      // For ASSIGN_TICKET's name -> id resolution — same role set tickets
      // are normally assigned to (IT_STAFF), not every org member.
      prisma.user.findMany({ where: { orgId, isActive: true, role: { in: [...IT_STAFF] } }, select: { id: true, name: true }, take: 50 }),
      prisma.quote.findMany({ where: { orgId }, select: { id: true, title: true, status: true }, take: 25, orderBy: { createdAt: 'desc' } }),
      prisma.invoice.findMany({ where: { orgId }, select: { id: true, invoiceNumber: true, title: true, status: true }, take: 25, orderBy: { createdAt: 'desc' } }),
      prisma.campaign.findMany({ where: { orgId }, select: { id: true, name: true, status: true }, take: 25, orderBy: { createdAt: 'desc' } }),
      prisma.asset.findMany({ where: { orgId }, select: { id: true, name: true, type: true }, take: 25, orderBy: { createdAt: 'desc' } }),
      prisma.leaveType.findMany({ where: { orgId, isActive: true }, select: { id: true, name: true }, take: 25 }),
      // Only PENDING ones — APPROVE_LEAVE/REJECT_LEAVE can't act on anything
      // else, so a decided request cluttering this list would just be a
      // wrong-match trap for the model.
      prisma.leaveRequest.findMany({
        where: { orgId, status: 'PENDING' },
        select: { id: true, startDate: true, endDate: true, user: { select: { name: true } }, leaveType: { select: { name: true } } },
        take: 25, orderBy: { createdAt: 'desc' },
      }),
      // Broader than assignableUsers (IT_STAFF-only, for ticket assignment) —
      // MANUAL_ATTENDANCE_ENTRY can target any active org member, including
      // Employee-role staff who never appear in assignableUsers.
      prisma.user.findMany({ where: { orgId, isActive: true }, select: { id: true, name: true }, take: 50 }),
    ]);

    /* Phase 5 — each module carries its recent records (id/title/stage) so
       MOVE_CUSTOM_RECORD_STAGE can resolve "the Kia EV6" to a real id, and
       its stage keys so both custom-record actions can name a stage. One
       bounded query for all modules, then 8 records per module. */
    const moduleIds = modules.map((m: any) => m.id);
    const recentRecords = moduleIds.length
      ? await prisma.customModuleRecord.findMany({
          where: { moduleId: { in: moduleIds } },
          select: { id: true, moduleId: true, stage: true, data: true },
          orderBy: { updatedAt: 'desc' }, take: 120,
        })
      : [];
    const modulesForPlan = modules.map((m: any) => {
      const primary = m.fields.find((f: any) => f.isPrimary) ?? m.fields[0];
      const records = recentRecords
        .filter(r => r.moduleId === m.id).slice(0, 8)
        .map(r => ({
          id: r.id, stage: r.stage,
          title: primary ? String((r.data as any)?.[primary.fieldKey] ?? r.id) : r.id,
        }));
      return {
        id: m.id, name: m.name,
        fields: m.fields.map((f: any) => ({ fieldKey: f.fieldKey, label: f.label, fieldType: f.fieldType })),
        ...(Array.isArray(m.stages) && m.stages.length
          ? { stages: (m.stages as any[]).map(s => ({ key: s.key, label: s.label })) } : {}),
        ...(records.length ? { records } : {}),
      };
    });

    const plan = await planAiAction(command, {
      actions: actionMenuForPrompt(),
      deals,
      tickets,
      leads: leads.map(l => ({ id: l.id, name: (l as any).contact?.name || 'Unknown' })),
      rules,
      contacts,
      modules: modulesForPlan,
      assignableUsers,
      quotes,
      invoices,
      campaigns,
      assets,
      leaveTypes,
      pendingLeaveRequests: pendingLeaveRequests.map(r => ({
        id: r.id, userName: r.user.name, leaveTypeName: r.leaveType.name,
        startDate: r.startDate.toISOString().slice(0, 10), endDate: r.endDate.toISOString().slice(0, 10),
      })),
      orgUsers,
    });

    // Filter to what this user's role is actually allowed to run, so the
    // confirm card never shows an action the execute step will just reject.
    const actionDef = plan.action ? getAiAction(plan.action) : undefined;
    const allowed = actionDef ? actionDef.allowedRoles.includes(role as any) : true;

    return {
      ...plan,
      allowed,
      label: actionDef?.label,
      requiresConfirmation: actionDef?.requiresConfirmation ?? true,
    };
  }
}

export async function planActionHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { command } = z.object({ command: z.string().min(3).max(500) }).parse(req.body);
    const plan = await buildActionPlanForOrg(req.user!.orgId, req.user!.role, command);
    res.json(plan);
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── Chat Copilot — multi-turn chat that can answer or act ───────────────────
// One endpoint powers the floating chat: a cheap router model reads the
// conversation and decides whether the latest turn is (a) a question about
// the org's data, (b) a command to execute, or (c) plain conversation.
// Actions come back as a plan the client must confirm — this endpoint never
// mutates anything itself; execution still goes through executeActionHandler
// with its role re-checks.
export async function chatCopilotHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { messages, context } = z.object({
      messages: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(2000),
      })).min(1).max(20),
      /** Optional record the chat was opened on, e.g. "TICKET cmt123 — VPN down". */
      context: z.string().max(300).optional(),
    }).parse(req.body);
    const orgId = req.user!.orgId;

    const route = await routeChatTurn(messages, context);

    if (route.mode === 'action' && route.command) {
      const plan = await buildActionPlanForOrg(orgId, req.user!.role, route.command.slice(0, 500));
      /* No matched action must NOT say "confirm to run it" — there is
         nothing to confirm, and that phrasing strands the user (they type
         "yes" at a card that never appeared). Surface the planner's own
         explanation of what it needs instead. */
      if (!plan.action) {
        return res.json({
          type: 'reply',
          text: plan.explanation
            ? `I couldn't set that up: ${plan.explanation}`
            : 'I couldn\u2019t match that to an action I can run. Try including the specifics — e.g. "Request 2 days of Annual Leave starting next Monday" or "Create a high priority ticket: VPN down".',
        });
      }
      return res.json({ type: 'plan', plan, text: route.reply || 'Here\u2019s what I\u2019ll do — confirm to run it.' });
    }

    if (route.mode === 'query' && route.command) {
      // Same org snapshot the dashboard's Ask-AI uses.
      const [totalDeals, openDeals, wonDeals, lostDeals, totalContacts, totalTickets, openTickets, resolvedTickets, totalLeads, activeLeads] = await Promise.all([
        prisma.deal.count({ where: { orgId } }),
        prisma.deal.count({ where: { orgId, status: 'OPEN' } }),
        prisma.deal.count({ where: { orgId, status: 'WON' } }),
        prisma.deal.count({ where: { orgId, status: 'LOST' } }),
        prisma.contact.count({ where: { orgId } }),
        prisma.ticket.count({ where: { orgId } }),
        prisma.ticket.count({ where: { orgId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
        prisma.ticket.count({ where: { orgId, status: 'RESOLVED' } }),
        prisma.lead.count({ where: { orgId } }),
        prisma.lead.count({ where: { orgId, status: { notIn: ['CONVERTED', 'UNQUALIFIED'] } } }),
      ]);
      const openDealData = await prisma.deal.findMany({ where: { orgId, status: 'OPEN' }, select: { value: true, probability: true } });
      const forecastRevenue = Math.round(openDealData.reduce((sum, d) => sum + (Number(d.value) * d.probability / 100), 0));
      const answer = await naturalLanguageQuery(route.command, { totalDeals, openDeals, wonDeals, lostDeals, totalContacts, totalTickets, openTickets, resolvedTickets, totalLeads, activeLeads, forecastRevenue });
      return res.json({ type: 'reply', text: answer });
    }

    res.json({ type: 'reply', text: route.reply || 'How can I help? I can create tickets and leads, add notes, assign work, file or approve leave, and answer questions about your data.' });
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── File a whole conversation with AI ───────────────────────────────────────
// Reads an Inbox conversation (email, WhatsApp, portal chat — any channel)
// and proposes the single best action: usually CREATE_TICKET, CREATE_LEAD,
// or ADD_NOTE on the record it already relates to. Same confirm-then-execute
// contract as every other plan.
export async function conversationPlanHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, orgId },
      include: { messages: { orderBy: { sentAt: 'asc' }, take: 30 } },
    });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    const transcript = conversation.messages
      .map(m => `${m.direction === 'INBOUND' ? (conversation.contactName || 'Customer') : 'Staff'}: ${m.body}`)
      .join('\n').slice(0, 6000);
    const command =
      `Based on this ${conversation.channel} conversation with ${conversation.contactName || 'a customer'} ` +
      `(subject: ${conversation.subject || 'none'}), decide the single most useful action to take in the CRM ` +
      `and fill its params from the conversation content:\n\n${transcript}`;

    const plan = await buildActionPlanForOrg(orgId, req.user!.role, command.slice(0, 500 * 20));
    res.json({ plan, transcriptPreview: transcript.slice(0, 400) });
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── AI Actions: Execute (re-validates everything, then runs) ───────────────
// Recursively drops `null` values from an object/array (in place shape,
// returns a new value) before it's handed to a Zod schema. Same failure
// mode as sanitizeNlCommandFields in utils/ai.ts fixed for the legacy
// create/update flow: the model sometimes emits e.g. "stage": null for a
// param it has no data for instead of omitting the key, and almost every
// optional param across the 24 registered actions uses `.optional()`
// (absent key only) rather than `.nullable()` (also accepts an explicit
// null) — so an unlucky plan would 400 at execute time on a perfectly
// legitimate command. Recursive because CREATE_CUSTOM_MODULE_RECORD's
// `data` param is itself a nested object of field values that needs the
// same treatment. Never strips nulls out of arrays' primitive entries,
// only object values — no current action param shape needs that, and
// silently dropping array elements would be a much stranger failure mode
// than dropping an unset field.
function stripNulls(value: any): any {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null) continue;
      out[k] = stripNulls(v);
    }
    return out;
  }
  return value;
}

export async function executeActionHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { action, params, command } = z.object({
      action: z.string().min(1),
      params: z.record(z.any()).default({}),
      command: z.string().optional(),
    }).parse(req.body);

    const actionDef = getAiAction(action);
    if (!actionDef) return res.status(404).json({ error: `Unknown action: ${action}` });

    // The model's own opinion of what's allowed is never trusted — the role
    // check happens here, server-side, against the actual logged-in user,
    // exactly like every other mutating endpoint in the app.
    if (!actionDef.allowedRoles.includes(req.user!.role as any)) {
      return res.status(403).json({ error: `Your role isn't permitted to run "${actionDef.label}"` });
    }

    const parsedParams = actionDef.schema.parse(stripNulls(params));
    const result = await actionDef.handler(parsedParams, { orgId: req.user!.orgId, userId: req.user!.id });

    logAction(req.user!.id, 'UPDATE', `AI:${action}`, (parsedParams as any).dealId || (parsedParams as any).ticketId || (parsedParams as any).leadId || (parsedParams as any).ruleId || (parsedParams as any).moduleId || (parsedParams as any).entityId || 'n/a', {
      viaAI: true,
      command,
      params: parsedParams,
    });

    res.json(result);
  } catch (err: any) { if (!handleAIError(err, res)) next(err); }
}

// ─── AI Feature Builder: List Rules ──────────────────────────────────────────
export async function listAIRulesHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const rules = await (prisma as any).aICustomRule.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' } });
    res.json(rules);
  } catch (err: any) { next(err); }
}

// ─── AI Feature Builder: Create Rule ─────────────────────────────────────────
export async function createAIRuleHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const body = z.object({
      name: z.string().min(1).max(100),
      description: z.string().optional(),
      trigger: z.enum(['TICKET_CREATED', 'LEAD_SCORED', 'DEAL_STAGE_CHANGED', 'CONTACT_UPDATED', 'TICKET_RESOLVED', 'MANUAL']),
      action: z.enum(['TAG', 'ROUTE', 'EMAIL', 'NOTIFY', 'SCORE', 'SUMMARIZE', 'CUSTOM_PROMPT']),
      customPrompt: z.string().optional(),
      outputField: z.string().optional(),
      isActive: z.boolean().default(true),
    }).parse(req.body);
    const rule = await (prisma as any).aICustomRule.create({ data: { ...body, orgId } });
    res.status(201).json(rule);
  } catch (err: any) { next(err); }
}

// ─── AI Feature Builder: Update Rule ─────────────────────────────────────────
export async function updateAIRuleHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const body = z.object({
      name: z.string().min(1).max(100).optional(),
      description: z.string().optional(),
      trigger: z.enum(['TICKET_CREATED', 'LEAD_SCORED', 'DEAL_STAGE_CHANGED', 'CONTACT_UPDATED', 'TICKET_RESOLVED', 'MANUAL']).optional(),
      action: z.enum(['TAG', 'ROUTE', 'EMAIL', 'NOTIFY', 'SCORE', 'SUMMARIZE', 'CUSTOM_PROMPT']).optional(),
      customPrompt: z.string().optional(),
      outputField: z.string().optional(),
      isActive: z.boolean().optional(),
    }).parse(req.body);
    // updateMany returns { count } — use update to return the full record
    const existing = await (prisma as any).aICustomRule.findFirst({ where: { id: req.params.id, orgId } });
    if (!existing) return res.status(404).json({ error: 'Rule not found' });
    const rule = await (prisma as any).aICustomRule.update({ where: { id: req.params.id }, data: body });
    res.json(rule);
  } catch (err: any) { next(err); }
}

// ─── AI Feature Builder: Delete Rule ─────────────────────────────────────────
export async function deleteAIRuleHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    await (prisma as any).aICustomRule.deleteMany({ where: { id: req.params.id, orgId } });
    res.status(204).end();
  } catch (err: any) { next(err); }
}

// ─── AI Feature Builder: Test/Run Rule ───────────────────────────────────────
export async function runAIRuleHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const { entityType, entityId, inputText } = z.object({
      entityType: z.enum(['TICKET', 'LEAD', 'DEAL', 'CONTACT']).optional(),
      entityId: z.string().optional(),
      inputText: z.string().max(10000).optional(),
    }).parse(req.body);

    /* Runs the rule for real against a real record, through the AI gateway so
       it is budgeted and logged. The previous version built its own OpenAI
       client and, when no inputText was supplied, sent the model the literal
       string `Entity: <cuid>` — no record data at all — so the "test" ran
       against nothing and told you it had worked. */
    const { output, outcome } = await runAiRuleManually(
      req.params.id,
      orgId,
      req.user!.id,
      entityType && entityId ? { entityType, entityId } : null,
      inputText,
    );

    res.json({ output, result: output, outcome });
  } catch (err: any) {
    if (!handleAIError(err, res)) next(new AppError(400, err?.message || 'Could not run that rule'));
  }
}
