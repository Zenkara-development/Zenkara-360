/**
 * Playwright global setup — runs once before the entire test suite.
 * Deletes all E2E test records so each run starts with a clean slate.
 * Prevents "strict mode violation: resolved to N elements" failures caused
 * by data accumulating across multiple test runs.
 */
import path from 'path';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

// Load DATABASE_URL from server/.env (path relative to project root)
dotenv.config({ path: path.join(__dirname, '../server/.env') });

/**
 * Polls a URL until it responds successfully (or times out). The dev stack
 * (ts-node-dev respawning the API, Vite compiling the client) isn't
 * necessarily ready the instant `npm run dev` returns a prompt — the very
 * first requests of a run were observed hanging on the login page for the
 * full 30s test timeout ("Signing in…" never resolving) purely because the
 * server hadn't finished booting yet, not because of an app bug. Waiting
 * here, once, before any test fires, removes that class of flake.
 */
async function waitForUrl(url: string, label: string, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        console.log(`[global-setup] ${label} is up (${url}).`);
        return;
      }
    } catch {
      // not up yet — keep polling
    }
    await new Promise(r => setTimeout(r, 1_000));
  }
  console.warn(`[global-setup] ${label} did not respond at ${url} within ${timeoutMs}ms — continuing anyway.`);
}

export default async function globalSetup() {
  console.log('\n[global-setup] Waiting for dev servers to be ready...');
  await Promise.all([
    waitForUrl(process.env.API_HEALTH_URL || 'http://localhost:4000/health', 'API server'),
    waitForUrl(process.env.BASE_URL || 'http://localhost:5173', 'Client (Vite)'),
  ]);

  const prisma = new PrismaClient();
  try {
    console.log('\n[global-setup] Cleaning E2E test data from database...');

    // ── AI rules (AICustomRule) ────────────────────────────────────────────
    const AI_RULE_NAMES = [
      'Test AI Rule', 'Label Test Rule', 'Toggle Test Rule',
      'Expand Test Rule', 'Runner Test Rule', 'Output Test Rule',
      'Edit Test Rule', 'Delete Test Rule', 'Quick Start Test Rule',
    ];
    const deletedRules = await prisma.aICustomRule.deleteMany({
      where: { name: { in: AI_RULE_NAMES } },
    });

    // ── Workflows ─────────────────────────────────────────────────────────
    const deletedWorkflows = await prisma.workflowRule.deleteMany({
      where: { name: { in: ['E2E Workflow', 'E2E WhatsApp Workflow'] } },
    });

    // ── Schedules (WhatsApp reminders) ──────────────────────────────────────
    // No unique constraint on Schedule, but leftover rows accumulate across
    // runs and inflate the "WhatsApp Reminders (N)" count assertions in
    // schedules.spec.ts, so they're matched and removed by message prefix.
    const deletedSchedules = await prisma.schedule.deleteMany({
      where: { message: { startsWith: 'E2E Reminder' } },
    });

    // ── Quotes (delete lines first) ───────────────────────────────────────
    const quoteTitles = ['E2E Quote', 'E2E Quote Edited'];
    const quotes = await prisma.quote.findMany({
      where: { title: { in: quoteTitles } },
      select: { id: true },
    });
    if (quotes.length) {
      await prisma.quoteLine.deleteMany({
        where: { quoteId: { in: quotes.map((q) => q.id) } },
      });
    }
    const deletedQuotes = await prisma.quote.deleteMany({
      where: { title: { in: quoteTitles } },
    });

    // ── Change requests ───────────────────────────────────────────────────
    // Includes the "Reject"/"Delete" variant titles created by tests further
    // down change-requests.spec.ts, which otherwise linger and cause
    // non-exact getByText() lookups elsewhere to match multiple elements.
    const deletedCRs = await prisma.changeRequest.deleteMany({
      where: {
        title: {
          in: [
            'E2E Server Upgrade',
            'E2E Server Upgrade Reject',
            'E2E Server Upgrade Delete',
          ],
        },
      },
    });

    // ── Templates (Record/Reply/Email/Quote) ──────────────────────────────
    // These had NO cleanup at all before — ReplyTemplate/EmailTemplate/
    // QuoteTemplate/RecordTemplate all have an @@unique([orgId, name])
    // constraint, so a leftover row from any earlier run (e.g. a test
    // failing before it reached its own delete-template cleanup step) makes
    // every subsequent run's create() 409/500 on that exact name — the
    // create dialog then never closes, identically on every retry, since
    // the conflicting row already existed before the run even started.
    const deletedRecordTemplates = await prisma.recordTemplate.deleteMany({
      where: { name: { in: ['E2E Ticket Record Template'] } },
    });
    const deletedReplyTemplates = await prisma.replyTemplate.deleteMany({
      where: { name: { in: ['E2E Password Reset Reply'] } },
    });
    const deletedEmailTemplates = await prisma.emailTemplate.deleteMany({
      where: { name: { in: ['E2E Welcome Email Template'] } },
    });
    const deletedQuoteTemplates = await prisma.quoteTemplate.deleteMany({
      where: { name: { in: ['E2E Support Package Template'] } },
    });

    // ── Custom AI Functions (AI Studio) ───────────────────────────────────
    const deletedCustomFunctions = await prisma.customAIFunction.deleteMany({
      where: {
        name: {
          in: [
            'E2E Classify Urgency', 'E2E Input Field Test', 'E2E Test Function',
            'Badge Test Function', 'Toggle Test Function', 'Edit Test Function',
            'Delete Test Function',
          ],
        },
      },
    });

    // ── Custom Scripts (AI Studio) ─────────────────────────────────────────
    const deletedCustomScripts = await prisma.customScript.deleteMany({
      where: {
        name: {
          in: [
            'E2E Auto-Priority Script', 'E2E Test Script', 'Badge Script Test',
            'Toggle Script Test', 'Edit Script Test', 'Delete Script Test',
          ],
        },
      },
    });

    // ── Campaigns ────────────────────────────────────────────────────────
    const deletedCampaigns = await prisma.campaign.deleteMany({
      where: { name: { in: ['E2E Campaign'] } },
    });

    // ── Custom fields ────────────────────────────────────────────────────
    // Matches every fieldKey used across custom-fields.spec.ts and
    // custom-fields-integration.spec.ts. If any of those tests fails before
    // reaching its own cleanup step (e.g. deleteFieldDef()), the field
    // definition is left behind and silently persists on every entity's
    // create form for every future run — including as a *required* field,
    // which blocks that form's submit entirely with no visible error. This
    // broader match (by key prefix and by "E2E ..." label) makes sure stale
    // fields never survive past the next global-setup run.
    const deletedFields = await prisma.customField.deleteMany({
      where: {
        OR: [
          { fieldKey: { in: ['e2e_field'] } },
          { fieldKey: { startsWith: 'e2e_' } },
          { label: { startsWith: 'E2E ' } },
        ],
      },
    });

    // ── Tickets (delete time entries + comments first) ────────────────────
    const TICKET_TITLES = [
      'E2E Test Ticket',
      'CSAT Test Ticket',
      'AI Sentiment Test Ticket',
      'E2E Time Tracking Ticket', // time-tracking.spec.ts — kept distinct from
                                  // 'E2E Test Ticket' so it doesn't race with
                                  // tickets.spec.ts under multiple workers
      'E2E Integration Ticket',  // custom-fields-integration.spec.ts
      'E2E Schedule Test Ticket', // schedules.spec.ts — own fixture, not shared with tickets.spec.ts
    ];
    const tickets = await prisma.ticket.findMany({
      where: { title: { in: TICKET_TITLES } },
      select: { id: true },
    });
    if (tickets.length) {
      const ticketIds = tickets.map((t) => t.id);
      await prisma.timeEntry.deleteMany({ where: { ticketId: { in: ticketIds } } });
      await prisma.comment.deleteMany({
        where: { entityType: 'TICKET', entityId: { in: ticketIds } },
      });
      await prisma.ticketHistory.deleteMany({ where: { ticketId: { in: ticketIds } } });
      await prisma.ticketAsset.deleteMany({ where: { ticketId: { in: ticketIds } } });
    }
    const deletedTickets = await prisma.ticket.deleteMany({
      where: { title: { in: TICKET_TITLES } },
    });

    // ── Knowledge articles ───────────────────────────────────────────────
    // Includes 'E2E Tickets-Page Article' — a name distinct from
    // 'E2E Test Article' so tickets.spec.ts doesn't race with
    // knowledge-base.spec.ts under multiple workers.
    const deletedArticles = await prisma.knowledgeArticle.deleteMany({
      where: { title: { in: ['E2E Test Article', 'E2E Tickets-Page Article'] } },
    });

    // ── Assets ───────────────────────────────────────────────────────────
    await prisma.ticketAsset.deleteMany({
      where: { asset: { name: { in: ['E2E Laptop', 'E2E Laptop Updated'] } } },
    });
    const deletedAssets = await prisma.asset.deleteMany({
      where: { name: { in: ['E2E Laptop', 'E2E Laptop Updated'] } },
    });

    // ── Categories ───────────────────────────────────────────────────────
    // Includes 'E2E Tickets-Page Category' — a name distinct from
    // 'E2E Test Category' so tickets.spec.ts doesn't race with
    // categories.spec.ts under multiple workers.
    const deletedCategories = await prisma.category.deleteMany({
      where: {
        name: {
          in: [
            'E2E Test Category', 'E2E Test Category Edited',
            'E2E Tickets-Page Category',
          ],
        },
      },
    });

    // ── Deals (delete comments + history first) ───────────────────────────
    const DEAL_TITLES = ['E2E Test Deal', 'E2E Converted Deal', 'E2E Integration Deal', 'E2E Schedule Test Deal'];
    const deals = await prisma.deal.findMany({
      where: { title: { in: DEAL_TITLES } },
      select: { id: true },
    });
    if (deals.length) {
      const dealIds = deals.map((d) => d.id);
      await prisma.comment.deleteMany({
        where: { entityType: 'DEAL', entityId: { in: dealIds } },
      });
      await prisma.dealHistory.deleteMany({ where: { dealId: { in: dealIds } } });
    }
    const deletedDeals = await prisma.deal.deleteMany({
      where: { title: { in: DEAL_TITLES } },
    });

    // ── Leads ────────────────────────────────────────────────────────────
    // Lead model has NO 'email' field — email lives on the linked Contact.
    // Find relevant contacts first, then delete their associated leads.
    // Was previously missing 'e2e-integration-lead@test.com' /
    // 'E2E Integration Lead' (custom-fields-integration.spec.ts), so that
    // fixture never got cleaned up and accumulated a duplicate row on every
    // run that ever exercised it, eventually tripping strict-mode
    // "resolved to 2 elements" failures in unrelated later runs.
    const leadContactIds = await prisma.contact.findMany({
      where: {
        OR: [
          { email: { in: ['e2e-lead@test.com', 'editme@test.com', 'e2e-integration-lead@test.com'] } },
          { email: { startsWith: 'editme-' } }, // leads.spec.ts 'edits a lead' — unique per invocation
          { name: { contains: 'E2E Test Lead' } },
          { name: { contains: 'Edit Me Lead' } },
          { name: { contains: 'E2E Integration Lead' } },
        ],
      },
      select: { id: true },
    });
    let deletedLeads = { count: 0 };
    if (leadContactIds.length) {
      deletedLeads = await prisma.lead.deleteMany({
        where: { contactId: { in: leadContactIds.map((c) => c.id) } },
      });
    }

    // ── Contacts ─────────────────────────────────────────────────────────
    const deletedContacts = await prisma.contact.deleteMany({
      where: {
        OR: [
          { email: { in: ['e2e-contact@test.com', 'secret@orga.com', 'editme@test.com', 'e2e-integration-contact@test.com', 'e2e-integration-lead@test.com'] } },
          { email: { startsWith: 'editme-' } },
          { name: { contains: 'Edit Me Lead' } },
        ],
      },
    });

    // ── Users (created by admin / user-management tests) ─────────────────
    // Tests create per-run emails like e2e-user-1234567890@test.com and
    // pw-user-1234567890@test.com — match both prefixes.
    const deletedUsers = await prisma.user.deleteMany({
      where: {
        OR: [
          { email: { startsWith: 'e2e-user-' } },
          { email: { startsWith: 'pw-user-' } },
        ],
      },
    });

    // ── API keys ─────────────────────────────────────────────────────────
    await prisma.apiKey.deleteMany({
      where: { name: { startsWith: 'E2E API Key' } },
    });

    // ── Reset admin user name (profile tests may leave 'Alex Renamed') ────
    await prisma.user.updateMany({
      where: { email: 'admin@crmitdesk.com' },
      data: { name: 'Alex Admin' },
    });

    console.log('[global-setup] Deleted:');
    console.log(`  AI rules: ${deletedRules.count}`);
    console.log(`  Workflows: ${deletedWorkflows.count}`);
    console.log(`  Schedules: ${deletedSchedules.count}`);
    console.log(`  Quotes: ${deletedQuotes.count}`);
    console.log(`  Change requests: ${deletedCRs.count}`);
    console.log(`  Record templates: ${deletedRecordTemplates.count}`);
    console.log(`  Reply templates: ${deletedReplyTemplates.count}`);
    console.log(`  Email templates: ${deletedEmailTemplates.count}`);
    console.log(`  Quote templates: ${deletedQuoteTemplates.count}`);
    console.log(`  Custom AI functions: ${deletedCustomFunctions.count}`);
    console.log(`  Custom scripts: ${deletedCustomScripts.count}`);
    console.log(`  Campaigns: ${deletedCampaigns.count}`);
    console.log(`  Custom fields: ${deletedFields.count}`);
    console.log(`  Tickets: ${deletedTickets.count}`);
    console.log(`  Articles: ${deletedArticles.count}`);
    console.log(`  Assets: ${deletedAssets.count}`);
    console.log(`  Categories: ${deletedCategories.count}`);
    console.log(`  Deals: ${deletedDeals.count}`);
    console.log(`  Leads: ${deletedLeads.count}`);
    console.log(`  Contacts: ${deletedContacts.count}`);
    console.log(`  Users: ${deletedUsers.count}`);
    console.log('[global-setup] Done.\n');
  } catch (err) {
    console.error('[global-setup] Error during cleanup:', err);
    // Don't throw — let tests run even if cleanup fails
  } finally {
    await prisma.$disconnect();
  }
}
