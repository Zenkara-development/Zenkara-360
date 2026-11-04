/**
 * Workspace identity — Phase 1 of the platform play.
 *
 * Lets an org (or the white-label partner running it) reskin the product so
 * the underlying CRM disappears: rename the app, rename any nav section or
 * item ("Tickets" → "Service Jobs"), and hide whole areas a vertical doesn't
 * need. Purely presentational — hiding a nav item never blocks the route or
 * the API (same "hidden from nav, not gated by URL" pattern the sidebar
 * already uses for role-filtered links), so nothing here is a security
 * boundary and an admin can never lock themselves out.
 *
 *   GET /api/workspace/config  — ALL_USERS (everyone renders the nav)
 *   PUT /api/workspace/config  — MANAGERS
 */
import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';

// Section labels are the NAV_SECTIONS labels client-side; routes are the
// nav item `to` paths. Validated loosely (strings, bounded lengths) rather
// than against a hardcoded route list so the client can add nav items
// without a lockstep server deploy — unknown keys are simply ignored by the
// renderer.
const Trimmed = (max: number) => z.string().trim().min(1).max(max);

export const ConfigSchema = z.object({
  /** What the product calls itself in the sidebar header ("DealerTrack Pro"). */
  appName: z.string().trim().max(40).optional(),
  /** { "/itdesk/tickets": "Service Jobs" } — nav item + page title renames, keyed by route. */
  navRenames: z.record(Trimmed(200), Trimmed(30)).optional(),
  /** { "CRM": "Sales", "IT Desk": "Service" } — section heading renames. */
  sectionRenames: z.record(Trimmed(40), Trimmed(30)).optional(),
  /** Routes whose nav links are hidden for every role. */
  hiddenRoutes: z.array(Trimmed(200)).max(100).optional(),
  /** Section labels hidden entirely (all their items with them). */
  hiddenSections: z.array(Trimmed(40)).max(20).optional(),
}).strict();

export type WorkspaceConfigShape = z.infer<typeof ConfigSchema>;

export async function getWorkspaceConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const row = await prisma.workspaceConfig.findUnique({ where: { orgId: req.user!.orgId } });
    res.json({ config: (row?.config as WorkspaceConfigShape | null) ?? null });
  } catch (err) { next(err); }
}

export async function saveWorkspaceConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const config = ConfigSchema.parse(req.body?.config ?? req.body);
    // Drop empty containers so "cleared everything" stores {} and the client
    // treats it exactly like never-configured.
    const clean: WorkspaceConfigShape = {};
    if (config.appName) clean.appName = config.appName;
    if (config.navRenames && Object.keys(config.navRenames).length) clean.navRenames = config.navRenames;
    if (config.sectionRenames && Object.keys(config.sectionRenames).length) clean.sectionRenames = config.sectionRenames;
    if (config.hiddenRoutes?.length) clean.hiddenRoutes = [...new Set(config.hiddenRoutes)];
    if (config.hiddenSections?.length) clean.hiddenSections = [...new Set(config.hiddenSections)];

    const row = await prisma.workspaceConfig.upsert({
      where:  { orgId },
      create: { orgId, config: clean },
      update: { config: clean },
    });
    res.json({ config: row.config });
  } catch (err) { next(err); }
}
