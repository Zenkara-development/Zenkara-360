import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../middleware/errorHandler';
import { prisma } from '../../utils/prisma';
import { seedAllDemoOrgs, seedMissingDemoOrgs, VERTICALS, loginEmailFor } from '../../utils/seedDemoData';
import { AuthRequest } from '../../middleware/authenticate';
import { secretsMatch } from '../../utils/crypto';

/**
 * POST /demo/reset — re-seeds every industry-vertical showcase org from
 * scratch (see utils/seedDemoData.ts). No user JWT is involved here — this
 * is meant to be called by an external scheduler (a nightly GitHub Actions
 * workflow) hitting the deployed API directly, so it's gated by a shared
 * secret header instead of a login session.
 *
 * If DEMO_RESET_SECRET isn't set, the endpoint refuses everything (404,
 * rather than 401/403) so its existence isn't even observable — safer
 * default than an accidentally-open reset endpoint on a deployment where
 * nobody got around to setting the secret yet.
 */
export async function resetDemo(req: Request, res: Response, next: NextFunction) {
  try {
    const configuredSecret = process.env.DEMO_RESET_SECRET;
    if (!configuredSecret) {
      throw new AppError(404, 'Not found');
    }
    const providedSecret = req.header('x-demo-reset-secret');
    // Constant-time — a plain !== leaks how much of a guess matched via
    // response timing. See secretsMatch() in utils/crypto.ts.
    if (!secretsMatch(providedSecret, configuredSecret)) {
      throw new AppError(404, 'Not found');
    }

    const orgs = await seedAllDemoOrgs();
    res.json({ success: true, orgs: orgs.map(o => o.name), resetAt: new Date().toISOString() });
  } catch (err) { next(err); }
}

/**
 * Which verticals are actually seeded right now.
 *
 * A vertical is only usable if BOTH its org and its admin login exist — the
 * seed deletes an org before rebuilding it, so a failed run can leave neither.
 * One query for each rather than eight round trips.
 */
async function availability(): Promise<Map<string, boolean>> {
  const slugs = VERTICALS.map(v => v.slug);
  const emails = slugs.map(loginEmailFor);

  const [orgs, users] = await Promise.all([
    prisma.organization.findMany({ where: { slug: { in: slugs } }, select: { slug: true } }),
    prisma.user.findMany({ where: { email: { in: emails }, isActive: true }, select: { email: true } }),
  ]);

  const haveOrg = new Set(orgs.map(o => o.slug));
  const haveUser = new Set(users.map(u => u.email));

  return new Map(VERTICALS.map(v => [v.slug, haveOrg.has(v.slug) && haveUser.has(loginEmailFor(v.slug))]));
}

/**
 * A small, truthful preview of what a vertical's workspace contains.
 *
 * Derived from the seed preset rather than hardcoded on the landing page, so
 * the marketing preview cannot drift away from what a visitor actually sees
 * after clicking through. Previously the landing page showed fixed TechCorp
 * deals in dollars no matter which industry was selected — which made the
 * industry picker decorative and, once a rupee-priced vertical existed, wrong.
 */
function previewFor(v: (typeof VERTICALS)[number]) {
  const open = v.deals.filter(d => String(d.status) === 'OPEN');
  const won = v.deals.filter(d => String(d.status) === 'WON').length;
  const lost = v.deals.filter(d => String(d.status) === 'LOST').length;
  const decided = won + lost;

  const liveTicketStatuses = new Set(['OPEN', 'IN_PROGRESS', 'PENDING']);

  return {
    stats: {
      openTickets: v.tickets.filter(t => liveTicketStatuses.has(String(t.status))).length,
      pipelineValue: open.reduce((sum, d) => sum + d.value, 0),
      // Rounded to a whole percent — a demo tile showing 66.667% reads as a bug.
      winRate: decided ? Math.round((won / decided) * 100) : 0,
      employees: 6,
    },
    deals: [...v.deals]
      .sort((a, b) => b.value - a.value)
      .slice(0, 3)
      .map(d => ({ title: d.title, value: d.value, stage: d.stage })),
    tickets: v.tickets.slice(0, 3).map(t => ({ title: t.title, priority: String(t.priority) })),
  };
}

/**
 * GET /demo/verticals — public list for the /demo landing page's picker.
 *
 * Now reports `available` per vertical. Previously this returned the static
 * VERTICALS array regardless of what was in the database, so the landing page
 * cheerfully offered eight demos even when none had been seeded — and every
 * click failed with a message telling the visitor to wait for something that
 * was never going to happen on its own.
 */
export async function listVerticals(_req: Request, res: Response, next: NextFunction) {
  try {
    const avail = await availability();
    res.json(
      VERTICALS.map(v => ({
        slug: v.slug,
        orgName: v.orgName,
        industry: v.industry,
        primaryColor: v.primaryColor,
        currency: v.currency ?? 'USD',
        available: avail.get(v.slug) ?? false,
        preview: previewFor(v),
      }))
    );
  } catch (err) { next(err); }
}

/**
 * GET /demo/status — is the demo actually usable, and if not, what fixes it.
 *
 * Exists because "the demo is warming up" is a dead end when the real answer is
 * "nothing has been seeded". Public and read-only: which demo orgs exist is not
 * sensitive, and being able to check it without a login is the entire point.
 */
export async function demoStatus(_req: Request, res: Response, next: NextFunction) {
  try {
    const avail = await availability();
    const ready = [...avail.values()].filter(Boolean).length;

    // Distinguish "not seeded" from "migration never ran", because the fix is
    // different and the error otherwise looks identical from the outside.
    let peoplePlatform = true;
    try {
      await prisma.employee.findFirst({ select: { id: true } });
    } catch {
      peoplePlatform = false;
    }

    res.json({
      ready: ready > 0,
      seeded: ready,
      total: VERTICALS.length,
      peoplePlatformMigrated: peoplePlatform,
      verticals: VERTICALS.map(v => ({ slug: v.slug, orgName: v.orgName, available: avail.get(v.slug) ?? false })),
      hint:
        ready === 0
          ? peoplePlatform
            ? 'No demo organizations exist. Run `npm run db:seed`, or POST /api/demo/seed-missing as an admin if this host has no shell.'
            : 'The people-platform tables are missing. Run `npx prisma migrate dev` and then `npm run db:seed`.'
          : ready < VERTICALS.length
            ? `${VERTICALS.length - ready} workspace(s) missing. POST /api/demo/seed-missing as an admin to create just those — no shell needed, and it leaves the existing ones untouched.`
            : 'All demo organizations are seeded and ready.',
    });
  } catch (err) { next(err); }
}


/**
 * POST /demo/seed-missing — creates demo orgs that don't exist yet.
 *
 * Separate from /demo/reset, and deliberately held to a lower bar, because the
 * two do genuinely different things. A reset tears down and rebuilds every
 * demo org, so it stays behind the shared secret. This only creates what is
 * absent, so it cannot destroy a working workspace no matter who calls it.
 *
 * Accepts either the reset secret (for CI) or a signed-in SUPER_ADMIN. That
 * second path is the point: adding a vertical leaves every deployed
 * environment one org short, and on a host with no shell — Render's free tier,
 * for instance — `npm run db:seed` simply isn't available. Without this the
 * only fix is a paid plan or a redeploy.
 */
export async function seedMissing(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const secret = process.env.DEMO_RESET_SECRET;
    const provided = req.header('x-demo-reset-secret');
    const bySecret = secretsMatch(provided, secret);
    const byAdmin = req.user?.role === 'SUPER_ADMIN' || req.user?.role === 'PLATFORM_ADMIN';

    if (!bySecret && !byAdmin) {
      throw new AppError(403, 'Sign in as an admin, or send the demo reset secret.');
    }

    const result = await seedMissingDemoOrgs();
    res.json({
      ...result,
      message: result.created.length
        ? `Created ${result.created.length} demo workspace(s): ${result.created.join(', ')}.`
        : 'Every demo workspace already exists — nothing to create.',
    });
  } catch (err) { next(err); }
}
