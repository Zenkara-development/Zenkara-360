import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import {
  buildCalendarAuthUrl, exchangeCodeForTokens, isCalendarSyncConfigured, pushCalendarEvent,
} from '../../utils/googleCalendar';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/** GET /api/calendar/status */
export async function getStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const conn = await prisma.calendarConnection.findUnique({ where: { userId: req.user!.id } });
    res.json({
      configured: isCalendarSyncConfigured(),
      connected: !!conn,
      connectedEmail: conn?.connectedEmail || null,
      lastSyncAt: conn?.lastSyncAt || null,
      syncActivities: conn?.syncActivities ?? true,
      syncTickets: conn?.syncTickets ?? true,
    });
  } catch (err) { next(err); }
}

/** GET /api/calendar/oauth-url — authenticated; returns the Google consent URL to redirect the browser to */
export async function getOAuthUrl(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!isCalendarSyncConfigured()) {
      throw new AppError(400, 'Calendar sync is not configured on this server (missing GOOGLE_CLIENT_ID/SECRET)');
    }
    // Short-lived signed state carrying the requesting user's id — Google's
    // redirect back to /callback below has no Authorization header, so this
    // is how we know who to attach the resulting tokens to.
    const state = jwt.sign({ userId: req.user!.id }, process.env.JWT_SECRET!, { expiresIn: '10m' });
    res.json({ url: buildCalendarAuthUrl(state) });
  } catch (err) { next(err); }
}

/** GET /api/calendar/callback — public; Google redirects the browser here after consent */
export async function oauthCallback(req: Request, res: Response) {
  try {
    const { code, state, error } = req.query as Record<string, string>;
    if (error) return res.redirect(`${FRONTEND_URL}/profile?calendar=error&reason=${encodeURIComponent(error)}`);
    if (!code || !state) return res.redirect(`${FRONTEND_URL}/profile?calendar=error`);

    const { userId } = jwt.verify(state, process.env.JWT_SECRET!) as { userId: string };
    const tokens = await exchangeCodeForTokens(code);

    await prisma.calendarConnection.upsert({
      where: { userId },
      create: {
        userId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
        connectedEmail: tokens.email,
      },
      update: {
        accessToken: tokens.accessToken,
        ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
        tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
        connectedEmail: tokens.email,
      },
    });

    res.redirect(`${FRONTEND_URL}/profile?calendar=connected`);
  } catch (err) {
    console.error('[calendar] OAuth callback failed:', err);
    res.redirect(`${FRONTEND_URL}/profile?calendar=error`);
  }
}

const SettingsSchema = z.object({
  syncActivities: z.boolean().optional(),
  syncTickets: z.boolean().optional(),
});

/** PATCH /api/calendar/settings */
export async function updateSettings(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = SettingsSchema.parse(req.body);
    const conn = await prisma.calendarConnection.findUnique({ where: { userId: req.user!.id } });
    if (!conn) throw new AppError(404, 'No calendar connected yet');
    const updated = await prisma.calendarConnection.update({ where: { userId: req.user!.id }, data });
    res.json({ syncActivities: updated.syncActivities, syncTickets: updated.syncTickets });
  } catch (err) { next(err); }
}

/** DELETE /api/calendar/connection */
export async function disconnect(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.calendarConnection.deleteMany({ where: { userId: req.user!.id } });
    res.json({ message: 'Calendar disconnected' });
  } catch (err) { next(err); }
}

/**
 * POST /api/calendar/sync — manual "push my open activities/tickets now"
 * button, complementing the automatic push hooked into Activity create/
 * update and ticket assignment (see activities.controller.ts / tickets
 * .controller.ts). Useful right after first connecting, when nothing has
 * changed recently enough to have triggered an automatic push yet.
 */
export async function manualSync(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const conn = await prisma.calendarConnection.findUnique({ where: { userId: req.user!.id } });
    if (!conn) throw new AppError(404, 'No calendar connected yet');

    let pushed = 0;
    if (conn.syncActivities) {
      const activities = await prisma.activity.findMany({
        where: { orgId: req.user!.orgId, createdBy: req.user!.id, done: false, dueAt: { not: null } },
        take: 50,
      });
      for (const a of activities) {
        const ok = await pushCalendarEvent(req.user!.id, 'activities', {
          sourceId: `activity-${a.id}`,
          summary: `[${a.type}] ${a.title}`,
          description: a.body || '',
          start: a.dueAt!,
          end: new Date(a.dueAt!.getTime() + 30 * 60 * 1000),
        });
        if (ok) pushed++;
      }
    }
    if (conn.syncTickets) {
      const tickets = await prisma.ticket.findMany({
        where: { orgId: req.user!.orgId, assignedTo: req.user!.id, slaDueAt: { not: null }, status: { notIn: ['RESOLVED', 'CLOSED'] } },
        take: 50,
      });
      for (const t of tickets) {
        const ok = await pushCalendarEvent(req.user!.id, 'tickets', {
          sourceId: `ticket-${t.id}`,
          summary: `[Ticket] ${t.title}`,
          description: `Priority: ${t.priority}`,
          start: new Date(t.slaDueAt!.getTime() - 30 * 60 * 1000),
          end: t.slaDueAt!,
        });
        if (ok) pushed++;
      }
    }
    res.json({ message: `Synced ${pushed} item(s) to Google Calendar` });
  } catch (err) { next(err); }
}
