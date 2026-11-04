// MUST be the first import. Imports run before this file's body, and many
// modules read process.env once at load (ADMIN_NOTIFY_EMAIL, FRONTEND_URL,
// APP_URL, Google/VAPID keys…) — a dotenv.config() call further down ran too
// late, so every one of those silently got its fallback when set via .env.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { validateEnv } from './utils/env';
import { authRouter } from './modules/core/auth/auth.routes';
import { usersRouter } from './modules/core/users/users.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { contactsRouter } from './modules/crm/contacts/contacts.routes';
import { accountsRouter } from './modules/crm/accounts/accounts.routes';
import { leadsRouter } from './modules/crm/leads/leads.routes';
import { dealsRouter } from './modules/crm/deals/deals.routes';
import { pipelinesRouter } from './modules/crm/pipelines/pipelines.routes';
import { activitiesRouter } from './modules/crm/activities/activities.routes';
import { ticketsRouter } from './modules/itdesk/tickets/tickets.routes';
import { categoriesRouter } from './modules/itdesk/categories/categories.routes';
import { slaRouter } from './modules/itdesk/sla/sla.routes';
import { articlesRouter } from './modules/itdesk/articles/articles.routes';
import { commentsRouter } from './modules/core/comments/comments.routes';
import { searchRouter } from './modules/core/search/search.routes';
import { usersAdminRouter } from './modules/core/users/usersAdmin.routes';
import { reportsRouter } from './modules/core/reports/reports.routes';
import { orgRouter } from './modules/core/org/org.routes';
import { aiRouter } from './modules/ai/ai.routes';
import { inboxRouter } from './modules/inbox/inbox.routes';
import { workflowsRouter } from './modules/workflows/workflows.routes';
import { chatRouter } from './modules/chat/chat.routes';
import { workspaceRouter } from './modules/workspace/workspace.routes';
import { relatedRouter } from './modules/core/related/related.routes';
import { webFormsRouter, publicFormsRouter } from './modules/webforms/webforms.routes';
import { portalRouter } from './modules/portal/portal.routes';
import { portalUsersRouter } from './modules/portal/portalUsers.routes';
import { billingRouter } from './modules/billing/billing.routes';
import { sweepAutoCheckouts, purgeOldLocationPings } from './utils/attendanceAutoCheckout';
import { analyticsRouter } from './modules/analytics/analytics.routes';
import { eventsRouter } from './modules/events/events.routes';
import { slackRouter } from './modules/slack/slack.routes';
import { directoryRouter } from './modules/directory/directory.routes';
import { assetsRouter } from './modules/itdesk/assets/assets.routes';
import { csatRouter } from './modules/csat/csat.routes';
import { campaignsRouter } from './modules/campaigns/campaigns.routes';
import { changeRequestsRouter } from './modules/changemanagement/changeRequests.routes';
import { apiKeysRouter } from './modules/apikeys/apikeys.routes';
import { authenticateApiKey } from './modules/apikeys/apikeys.controller';
import { customFieldsRouter } from './modules/customfields/customfields.routes';
import { auditLogRouter } from './modules/core/auditlog/auditlog.routes';
import { brandingRouter } from './modules/branding/branding.routes';
import { teamsRouter } from './modules/teams/teams.routes';
import { timeTrackingRouter } from './modules/timetracking/timetracking.routes';
import { quotesRouter } from './modules/quotes/quotes.routes';
import { totpRouter } from './modules/totp/totp.routes';
import { importRouter } from './modules/import/import.routes';
import { recordTemplatesRouter } from './modules/templates/recordTemplates.routes';
import { replyTemplatesRouter } from './modules/templates/replyTemplates.routes';
import { emailTemplatesRouter } from './modules/templates/emailTemplates.routes';
import { quoteTemplatesRouter } from './modules/templates/quoteTemplates.routes';
import { schedulesRouter } from './modules/schedules/schedules.routes';
import { storageRouter } from './modules/storage/storage.routes';
import { attachmentsRouter } from './modules/attachments/attachments.routes';
import { tagsRouter } from './modules/tags/tags.routes';
import { demoRouter } from './modules/demo/demo.routes';
import { customModulesRouter } from './modules/custom-modules/customModules.routes';
import { pushRouter } from './modules/push/push.routes';
import { platformAdminRouter } from './modules/platform-admin/platformAdmin.routes';
import { calendarRouter } from './modules/calendar/calendar.routes';
import { gdprRouter } from './modules/gdpr/gdpr.routes';
import { attendanceRouter } from './modules/hr/attendance/attendance.routes';
import { leaveRouter } from './modules/hr/leave/leave.routes';
import { payrollRouter } from './modules/hr/payroll/payroll.routes';
// ─── People / task / approval / permission / knowledge platform ──────────────
// Added with the Employee-Department-Task-Approval foundation. These five
// routers are what the cross-suite workflows (onboarding, offboarding,
// ownership transfer, the universal request centre) are built on.
import { employeesRouter } from './modules/hr/employees/employees.routes';
// One "People" surface over the User and Employee tables — see
// modules/people/people.controller.ts for why they stay separate underneath.
import { peopleRouter } from './modules/people/people.routes';
import { orgStructureRouter } from './modules/hr/org/orgStructure.routes';
import { tasksRouter } from './modules/tasks/tasks.routes';
import { approvalsRouter } from './modules/approvals/approvals.routes';
import { permissionsRouter } from './modules/permissions/permissions.routes';
import { knowledgeRouter } from './modules/knowledge/knowledge.routes';
import { seedPermissionCatalog } from './utils/permissions';
import { ensureVectorIndex } from './utils/rag';
import { expireOverdueApprovals } from './utils/approvals';
import { invoicesRouter } from './modules/invoices/invoices.routes';
import { jobsRouter } from './modules/jobs/jobs.routes';
import { startSchedulePoller } from './utils/scheduler';
import { startOrphanReaper } from './utils/entityCleanup';
import { startCustomModuleSyncPoller } from './utils/customModuleSync';
import { startDateAutomationPoller } from './utils/dateAutomation';
import { startSlaMonitorPoller } from './utils/slaMonitor';
import { startJobQueuePoller } from './utils/jobQueue';
import { syncAllEmailAccounts } from './utils/email-sync';
import { errorHandler } from './middleware/errorHandler';
import { prisma } from './utils/prisma';
import { sseManager } from './utils/sse';

// Fail fast on missing/placeholder env config — before any route, poller, or
// DB work starts. See utils/env.ts for what's required and why.
validateEnv();

const app = express();
const PORT = process.env.PORT || 4000;
const isProd = process.env.NODE_ENV === 'production';

// Render (like most PaaS) sits the app behind a reverse proxy, which sets
// X-Forwarded-For. Without telling Express to trust it, express-rate-limit
// refuses to use that header at all — every request gets rate-limited as if
// it came from the same IP (Render's proxy), and it throws/logs
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every single request. `1` trusts
// exactly one hop (Render's own proxy), which is correct here — trusting
// unlimited hops would let a client spoof X-Forwarded-For to dodge rate
// limits entirely. Behind the docker-compose stack (Caddy → nginx → here)
// there are two hops, so TRUST_PROXY_HOPS=2 is set in docker-compose.yml.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow avatar/file access from frontend
}));

// ─── Compression ─────────────────────────────────────────────────────────────
app.use(compression({
  /* Never compress the SSE stream: compression buffers output until it has a
     full chunk, which silently swallows every real-time event for any client
     that sends Accept-Encoding — i.e. every browser. This is why live
     updates worked in curl but never in the UI. */
  filter: (req, res) => !req.originalUrl.startsWith('/api/events') && compression.filter(req, res),
}));

// ─── CORS ────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));

// ─── Body limits (prevent payload attacks) ───────────────────────────────────
// Twilio webhook sends URL-encoded form data — must parse before JSON middleware
app.use('/api/inbox/whatsapp/webhook', express.urlencoded({ extended: false, limit: '64kb' }));
// Stripe webhook signature verification needs the EXACT raw bytes Stripe
// signed. If the global express.json() below runs first it consumes the
// stream and hands the route a parsed object — re-serialising never matches
// the signature, so every real Stripe event fails verification and plan
// changes silently stop applying. Mounting raw() here (before json()) claims
// the body first; the route-level raw() in billing.routes.ts then sees the
// body is already read and no-ops.
app.use('/api/billing/webhook', express.raw({ type: 'application/json', limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─── Rate limiting ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // 20 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again in 15 minutes' },
  skip: () => !isProd,       // disabled in dev/test
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 300,                  // generous for normal SaaS usage
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded' },
  skip: () => !isProd,
});

// Public API traffic (X-API-Key) is rate-limited per key, not per IP — a
// third-party integration can call from a shared IP (a serverless function,
// an office NAT) that would otherwise starve every other key or user behind
// the same address under the plain apiLimiter above. authenticateApiKey is
// mounted just above this, so (req as any).apiKeyId is already set by the
// time this runs. Requests with no API key (skip returns true) fall through
// to the ordinary IP-based apiLimiter untouched.
const apiKeyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,                  // per key, per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'API key rate limit exceeded — 120 requests/minute per key' },
  skip: (req) => !isProd || !(req as any).apiKeyId,
  keyGenerator: (req) => (req as any).apiKeyId,
});

// Populates req.user from X-API-Key before either limiter or any router
// runs, so requests carrying a valid key skip the JWT check entirely (see
// authenticate()'s early-return in middleware/authenticate.ts) and get
// their own rate-limit bucket via apiKeyLimiter above instead of sharing
// the generic per-IP one.
app.use('/api/', authenticateApiKey);
app.use('/api/', apiLimiter);
app.use('/api/', apiKeyLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/demo-login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/accept-invite', authLimiter);
app.use('/api/auth/approve-org-signup', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/auth/google', authLimiter);
app.use('/api/admin/users/invite', authLimiter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable', timestamp: new Date().toISOString() });
  }
});

// ─── Public API docs ──────────────────────────────────────────────────────────
// Unauthenticated, machine-readable reference for anyone building against an
// API key created in Settings → API Keys. Deliberately covers the resources
// a third-party integration is actually likely to want (CRM + helpdesk core
// objects) rather than every one of this app's ~50 internal route modules —
// most of those (billing, branding, custom scripts, platform admin, ...) are
// app-internal, not public-API surface. Every listed path also works with
// the normal JWT session the way it always has; X-API-Key is an alternative,
// not a replacement.
app.get('/api/docs', (_req, res) => {
  res.json({
    baseUrl: '/api',
    authentication: {
      header: 'X-API-Key',
      note: 'Generate a key in Settings → API Keys (org admin only). Include it as the X-API-Key header on every request instead of an Authorization bearer token.',
    },
    scopes: {
      read: 'GET/HEAD requests only',
      write: 'Includes read, plus POST/PUT/PATCH/DELETE',
      admin: 'Includes write, plus org-admin-only endpoints the key\'s scope allows — a key can never reach routes gated to a manager/admin user role (billing, user management, API key management itself), regardless of scope',
    },
    rateLimit: '120 requests/minute per API key',
    resources: [
      { path: '/crm/contacts', methods: ['GET', 'POST', 'PUT', 'DELETE'] },
      { path: '/crm/leads', methods: ['GET', 'POST', 'PUT', 'DELETE'] },
      { path: '/crm/deals', methods: ['GET', 'POST', 'PUT', 'DELETE'] },
      { path: '/crm/accounts', methods: ['GET', 'POST', 'PUT', 'DELETE'] },
      { path: '/crm/activities', methods: ['GET', 'POST'] },
      { path: '/itdesk/tickets', methods: ['GET', 'POST', 'PUT', 'DELETE'] },
      { path: '/itdesk/articles', methods: ['GET', 'POST', 'PUT', 'DELETE'] },
      { path: '/itdesk/assets', methods: ['GET', 'POST', 'PUT', 'DELETE'] },
      { path: '/invoices', methods: ['GET', 'POST', 'PUT'] },
      { path: '/quotes', methods: ['GET', 'POST', 'PUT'] },
      { path: '/search', methods: ['GET'], note: 'q= query param; searches contacts, deals, tickets, leads, articles, assets, invoices' },
    ],
    example: `curl -H "X-API-Key: crm_..." ${(process.env.APP_URL || 'https://your-app.example.com')}/api/crm/contacts`,
  });
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/crm/contacts', contactsRouter);
app.use('/api/crm/accounts', accountsRouter);
app.use('/api/crm/leads', leadsRouter);
app.use('/api/crm/deals', dealsRouter);
app.use('/api/crm/pipelines', pipelinesRouter);
app.use('/api/crm/activities', activitiesRouter);
app.use('/api/itdesk/tickets', ticketsRouter);
app.use('/api/itdesk/categories', categoriesRouter);
app.use('/api/itdesk/sla-policies', slaRouter);
app.use('/api/itdesk/articles', articlesRouter);
app.use('/api/comments', commentsRouter);
app.use('/api/search', searchRouter);
app.use('/api/admin/users', usersAdminRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/org', orgRouter);
app.use('/api/ai', aiRouter);
app.use('/api/inbox', inboxRouter);
app.use('/api/workflows', workflowsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/workspace', workspaceRouter);
app.use('/api/related', relatedRouter);
app.use('/api/web-forms', webFormsRouter);
// Public web-to-lead/ticket submissions — deliberately unauthenticated.
app.use('/api/public/forms', publicFormsRouter);
app.use('/api/portal', portalRouter);
app.use('/api/portal-users', portalUsersRouter);
app.use('/api/billing', billingRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/slack', slackRouter);
app.use('/api/directory', directoryRouter);
app.use('/api/itdesk/assets', assetsRouter);
app.use('/api/csat', csatRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/change-requests', changeRequestsRouter);
app.use('/api/api-keys', apiKeysRouter);
app.use('/api/custom-fields', customFieldsRouter);
app.use('/api/audit-logs', auditLogRouter);
app.use('/api/branding', brandingRouter);
app.use('/api/teams', teamsRouter);
app.use('/api/itdesk/time-tracking', timeTrackingRouter);
app.use('/api/quotes', quotesRouter);
app.use('/api/2fa', totpRouter);
app.use('/api/import', importRouter);
app.use('/api/templates/records', recordTemplatesRouter);
app.use('/api/templates/replies', replyTemplatesRouter);
app.use('/api/templates/emails', emailTemplatesRouter);
app.use('/api/templates/quotes', quoteTemplatesRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/storage', storageRouter);
app.use('/api/attachments', attachmentsRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/demo', demoRouter);
app.use('/api/custom-modules', customModulesRouter);
app.use('/api/push', pushRouter);
app.use('/api/platform', platformAdminRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/gdpr', gdprRouter);
app.use('/api/hr/attendance', attendanceRouter);
app.use('/api/hr/leave', leaveRouter);
app.use('/api/hr/payroll', payrollRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/hr/employees', employeesRouter);
app.use('/api/people', peopleRouter);
app.use('/api/hr/org', orgStructureRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/approvals', approvalsRouter);
app.use('/api/permissions', permissionsRouter);
app.use('/api/knowledge', knowledgeRouter);

// ─── Error handler ───────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start ───────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`[server] Running on http://localhost:${PORT} (${isProd ? 'production' : 'development'})`);
});

// Seed the permission catalog and built-in roles on boot.
//
// Idempotent and non-narrowing (see utils/permissions.ts seedPermissionCatalog):
// it upserts permissions by key and only *adds* missing role grants, so an
// admin who has already tightened SALES_REP from ALL to TEAM does not get it
// reset by the next deploy. Failing here must not stop the server — the engine
// falls back to LEGACY_ROLE_GRANTS, which is exactly the pre-existing behavior.
seedPermissionCatalog()
  .then(() => console.log('[permissions] catalog and built-in roles are up to date'))
  .catch(err => console.error('[permissions] seed failed; falling back to legacy role grants', err));

// Prepare the pgvector column/index if the extension is installed. No-ops
// cleanly on databases without it — RAG then uses the in-process cosine path.
ensureVectorIndex().catch(err => console.error('[rag] vector index setup failed', err));

// Handles to every interval started in this file, so shutdown() can stop
// them — otherwise a poller can fire mid-shutdown and get killed halfway
// through a send (the job queue's stall recovery papers over that, but not
// starting new work at all is strictly better).
const pollers: NodeJS.Timeout[] = [];

// Expire approval requests that blew past their deadline, every 15 minutes.
pollers.push(setInterval(() => {
  expireOverdueApprovals()
    .then(n => { if (n > 0) console.log(`[approvals] expired ${n} overdue request(s)`); })
    .catch(err => console.error('[approvals] expiry sweep failed', err));
}, 15 * 60 * 1000));

// Purge expired refresh tokens once per hour
pollers.push(setInterval(async () => {
  const { count } = await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  if (count > 0) console.log(`[cleanup] Deleted ${count} expired refresh tokens`);
}, 60 * 60 * 1000));

// Email sync: run immediately on startup, then every 5 minutes
syncAllEmailAccounts().catch(() => {});
pollers.push(setInterval(() => syncAllEmailAccounts().catch(() => {}), 5 * 60 * 1000));

// Attendance: finish geofence / silent-session auto check-outs every minute
pollers.push(setInterval(() => {
  sweepAutoCheckouts()
    .then(n => { if (n.geofence || n.timeout || n.nudged) console.log(`[attendance] sweep: ${n.geofence} left office, ${n.timeout} timed out, ${n.nudged} nudged by push`); })
    .catch(err => console.error('[attendance] auto check-out sweep failed', err));
}, 60 * 1000));

// Attendance: drop location pings past each org's retention, hourly
pollers.push(setInterval(() => {
  purgeOldLocationPings().then(n => { if (n) console.log(`[attendance] purged ${n} old location pings`); }).catch(() => {});
}, 60 * 60 * 1000));

// Schedule reminders: check for due WhatsApp notifications every minute
startSchedulePoller();

// Attachments whose parent record was deleted by a database-level cascade
// (which no controller sees) still occupy the org's storage quota. Daily sweep.
startOrphanReaper();

// Custom module external sync: check for due polling jobs every minute
startCustomModuleSyncPoller();

// Date-driven follow-ups (birthdays, appointment/service-due reminders):
// day-granularity, so hourly is enough — see utils/dateAutomation.ts
startDateAutomationPoller();

// SLA breach detection: fires the SLA_BREACH workflow trigger + Slack/Teams
// notifications for any ticket that just crossed its resolution deadline —
// see utils/slaMonitor.ts
startSlaMonitorPoller();

// Background job retry queue: picks up failed email/Slack/Teams/push sends
// (mailer.ts, slack.ts, teams.ts, webPush.ts all enqueue here on failure
// instead of just logging and dropping the message) and retries them with
// exponential backoff — see utils/jobQueue.ts.
startJobQueuePoller();

// ─── Crash safety net ────────────────────────────────────────────────────────
// On Node 20 an unhandled promise rejection TERMINATES the process — and this
// codebase has many fire-and-forget async chains (pollers, seeding, SSE
// writes). Without these handlers the process dies with whatever half-line
// the default reporter prints and Render just restarts it, invisibly. Log
// loudly, then exit non-zero so the platform restarts us from a clean slate —
// limping on after an uncaught throw risks corrupt in-memory state.
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled promise rejection — exiting for a clean restart:', reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception — exiting for a clean restart:', err);
  process.exit(1);
});

// ─── Graceful shutdown ───────────────────────────────────────────────────────
async function shutdown(signal: string) {
  console.log(`[server] ${signal} received — shutting down gracefully`);

  // Stop starting new background work, and release the connections that
  // would otherwise hold server.close() open forever: every SSE stream
  // (deliberately never-ending) and idle keep-alive sockets. Before this,
  // any deploy with a dashboard open always hit the 10s force-exit path.
  for (const p of pollers) clearInterval(p);
  sseManager.closeAll();
  server.closeIdleConnections?.();

  server.close(async () => {
    await prisma.$disconnect();
    console.log('[server] Closed');
    process.exit(0);
  });

  // Force exit if shutdown takes too long
  setTimeout(() => {
    console.error('[server] Forced exit after timeout');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
