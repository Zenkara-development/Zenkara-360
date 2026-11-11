import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';
import { AppError } from '../../../middleware/errorHandler';
import { logAction } from '../../../utils/auditLog';
import { verifyAgainstOffices, distanceFromOffice } from '../../../utils/attendanceVerification';
import { recordTransition, lastGeofenceEvent, isUsableAccuracy, type GeofenceEventType } from '../../../utils/attendanceGeofenceEvents';
import { locationTrackingEnabled } from '../../../utils/attendanceAutoCheckout';
import { getOrCreateAttendancePolicy } from '../../../utils/faceVerification';
import { geocode } from '../../../utils/geocoding';

/**
 * Geofence endpoints that sit around the office boundaries:
 *
 *   GET  /hr/attendance/my-location            the caller's own position status
 *   POST /hr/attendance/my-location            evaluate a fresh GPS fix
 *   GET  /hr/attendance/office-locations/:id/events   entry/exit history
 *   GET  /hr/attendance/office-locations/presence     who is inside where
 *   GET  /hr/attendance/geocode                address search for the editor
 *
 * The employee's own endpoints are open to every staff role but only ever
 * return that person's data. The office-wide ones are manager-only, and are
 * scoped to the caller's organization — location history is not something a
 * manager from another tenant, or an ordinary employee, may read.
 */

// ─── Employee: am I at the office? ───────────────────────────────────────────

const MyLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100000).optional(),
});

interface OfficeView {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  allowedIps: string | null;
  geofenceType: string;
  polygon: unknown;
}

/**
 * The office the employee is *assigned* to.
 *
 * Employees carry a `locationId` (the HR "Location" concept — a site, a
 * branch). An office location can point at the same Location, which is what
 * makes it "the employee's office" — as opposed to any office they happen
 * to be standing in.
 */
async function assignedOffice(userId: string, orgId: string): Promise<{ id: string; name: string } | null> {
  const employee = await prisma.employee.findFirst({
    where: { orgId, userId },
    select: { locationId: true },
  });
  if (!employee?.locationId) return null;
  const office = await prisma.officeLocation.findFirst({
    where: { orgId, locationId: employee.locationId, isActive: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
  return office;
}

async function activeOffices(orgId: string): Promise<OfficeView[]> {
  return prisma.officeLocation.findMany({
    where: { orgId, isActive: true },
    select: {
      id: true, name: true, latitude: true, longitude: true, radiusMeters: true,
      allowedIps: true, geofenceType: true, polygon: true,
    },
  });
}

/**
 * GET /hr/attendance/my-location
 *
 * The last position the server has for this person, evaluated against the
 * org's office boundaries. No GPS is requested here — the browser asks for
 * that separately (see the POST below), so simply opening the page never
 * triggers a location permission prompt.
 */
export async function myLocation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const userId = req.user!.id;

    const [offices, assigned, lastEvent, lastRecord] = await Promise.all([
      activeOffices(orgId),
      assignedOffice(userId, orgId),
      lastGeofenceEvent(orgId, userId),
      prisma.attendanceRecord.findFirst({
        where: { orgId, userId },
        orderBy: { updatedAt: 'desc' },
        select: { lastSeenLat: true, lastSeenLng: true, lastSeenInside: true, lastSeenAt: true, checkInAt: true, checkInLat: true, checkInLng: true },
      }),
    ]);

    const lat = lastRecord?.lastSeenLat ?? lastRecord?.checkInLat ?? null;
    const lng = lastRecord?.lastSeenLng ?? lastRecord?.checkInLng ?? null;
    const seenAt = lastRecord?.lastSeenAt ?? lastRecord?.checkInAt ?? null;

    let inside: boolean | null = null;
    let office: string | null = null;
    let distanceMeters: number | null = null;
    if (lat != null && lng != null && offices.length) {
      const geo = verifyAgainstOffices(offices, lat, lng, '');
      inside = geo.locationOk;
      office = geo.matchedLocationName;
      distanceMeters = geo.nearestDistanceMeters;
    }

    res.json({
      inside,
      office,
      distanceMeters,
      lat,
      lng,
      seenAt,
      /** True when the last fix is older than 5 minutes — treat it as history, not "now". */
      stale: seenAt ? Date.now() - new Date(seenAt).getTime() > 5 * 60_000 : true,
      assignedOffice: assigned,
      lastEvent: lastEvent
        ? { type: lastEvent.eventType as GeofenceEventType, at: lastEvent.at }
        : null,
      officeCount: offices.length,
    });
  } catch (err) { next(err); }
}

/**
 * POST /hr/attendance/my-location
 *
 * Evaluates a GPS fix the browser has just obtained and returns the verdict.
 * The server does the geometry — the client is never trusted to decide
 * whether somebody is inside an office, and the same code path is used by
 * check-in, so what the employee sees is what they will be judged by.
 */
export async function reportMyLocation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const userId = req.user!.id;
    const { lat, lng, accuracy } = MyLocationSchema.parse(req.body);

    const [offices, policy, assigned] = await Promise.all([
      activeOffices(orgId),
      getOrCreateAttendancePolicy(orgId),
      assignedOffice(userId, orgId),
    ]);

    if (!offices.length) {
      res.json({
        inside: null, office: null, distanceMeters: null, lat, lng, accuracy: accuracy ?? null,
        seenAt: new Date(), stale: false, assignedOffice: assigned, lastEvent: null, officeCount: 0,
        message: 'This organisation has no office locations set up yet.',
      });
      return;
    }

    // A vague fix ("within 400 m of here") must not flip somebody's status.
    const usable = isUsableAccuracy(accuracy);
    const geo = usable ? verifyAgainstOffices(offices, lat, lng, '') : null;
    const inside = geo ? geo.locationOk : null;

    let lastEvent = await lastGeofenceEvent(orgId, userId);
    if (inside !== null && locationTrackingEnabled(policy)) {
      const recorded = await recordTransition({
        orgId, userId,
        officeLocationId: geo?.matchedLocationId ?? null,
        officeName: geo?.matchedLocationName ?? null,
        inside, lat, lng, accuracy: accuracy ?? null,
        source: 'STATUS_CHECK',
      });
      if (recorded) lastEvent = { eventType: recorded.eventType, at: recorded.at, seq: 0 };
    }

    res.json({
      inside,
      office: geo?.matchedLocationName ?? null,
      distanceMeters: geo?.nearestDistanceMeters ?? null,
      lat,
      lng,
      accuracy: accuracy ?? null,
      seenAt: new Date(),
      stale: false,
      /** False when the fix was too vague to decide anything. */
      usable,
      assignedOffice: assigned,
      lastEvent: lastEvent
        ? { type: lastEvent.eventType as GeofenceEventType, at: lastEvent.at }
        : null,
      officeCount: offices.length,
      message: usable
        ? null
        : 'Your GPS reading is not precise enough yet — move somewhere with a clearer signal.',
    });
  } catch (err) { next(err); }
}

// ─── Manager / team lead: the office's entry/exit history ───────────────────

/** Roles that may review every employee's movements in the organisation. */
const REVIEW_ROLES = new Set(['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER']);

/**
 * Who may look at movement history, and whose movements?
 *
 *   • A manager (org owner, IT manager, sales manager) may review anybody
 *     in their organisation.
 *   • A team lead may review the people in their own team — no more. The
 *     team lead is an Employee row, so the caller's login is matched
 *     through it.
 *
 * Returns the user ids the caller is allowed to see, or null for "everybody
 * in the organisation".
 */
async function reviewScope(
  orgId: string,
  userId: string,
  role: string,
): Promise<string[] | null> {
  if (REVIEW_ROLES.has(role)) return null;

  const teams = await prisma.team.findMany({
    where: { orgId, lead: { userId } },
    select: { id: true },
  });
  if (!teams.length) return [];

  const members = await prisma.teamMember.findMany({
    where: { teamId: { in: teams.map(t => t.id) } },
    select: { employee: { select: { userId: true } } },
  });
  return [...new Set(members.map(m => m.employee.userId).filter((v): v is string => !!v))];
}

/**
 * GET /hr/attendance/office-locations/:id/events
 *
 * The boundary crossings recorded for one office. This is employee movement
 * history, so it is never open to anyone who has no legitimate attendance
 * reason to see it — see reviewScope() above.
 */
export async function officeEvents(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const office = await prisma.officeLocation.findFirst({
      where: { id: req.params.id, orgId },
      select: { id: true, name: true },
    });
    if (!office) throw new AppError(404, 'Office location not found');

    const scope = await reviewScope(orgId, req.user!.id, req.user!.role);
    if (scope && scope.length === 0) {
      throw new AppError(403, 'Only managers and team leads can review office entry and exit history.');
    }

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const events = await prisma.attendanceGeofenceEvent.findMany({
      where: {
        orgId,
        officeLocationId: office.id,
        ...(scope ? { userId: { in: scope } } : {}),
      },
      orderBy: { at: 'desc' },
      take: limit,
      select: {
        id: true, userId: true, eventType: true, at: true, lat: true, lng: true,
        accuracy: true, source: true, officeName: true,
        user: { select: { id: true, name: true, avatarUrl: true, department: true } },
      },
    });
    res.json({ office, events, total: events.length });
  } catch (err) { next(err); }
}

/**
 * GET /hr/attendance/office-locations/presence
 *
 * Who is reported inside which office right now, and who is outside.
 *
 * "Reported" is the important word: this is built from the last location
 * each employee sent, so it is only as fresh as the last heartbeat and is
 * empty for anyone who has not sent one. It is never a background tracker.
 */
export async function officePresence(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    const policy = await getOrCreateAttendancePolicy(orgId);
    if (!policy.shareLiveLocation) {
      throw new AppError(403, 'Live location sharing is switched off for your organisation — enable it under HR Settings → Attendance.');
    }

    const [offices, sessions] = await Promise.all([
      activeOffices(orgId),
      prisma.attendanceRecord.findMany({
        where: { orgId, checkInAt: { not: null } },
        orderBy: { checkInAt: 'desc' },
        select: {
          id: true, userId: true, lastSeenAt: true, lastSeenLat: true, lastSeenLng: true,
          lastSeenInside: true, checkInAt: true, checkInLat: true, checkInLng: true,
          user: { select: { id: true, name: true, avatarUrl: true, department: true } },
        },
      }),
    ]);

    // One row per employee: their most recent session.
    const latest = new Map<string, (typeof sessions)[number]>();
    for (const s of sessions) if (!latest.has(s.userId)) latest.set(s.userId, s);

    const scope = await reviewScope(orgId, req.user!.id, req.user!.role);
    if (scope && scope.length === 0) {
      throw new AppError(403, 'Only managers and team leads can see who is inside an office.');
    }
    const visible = [...latest.values()].filter(s => !scope || scope.includes(s.userId));

    const now = Date.now();
    const STALE_MS = 3 * 60_000;
    const people = visible.map(s => {
      const lat = s.lastSeenLat ?? s.checkInLat;
      const lng = s.lastSeenLng ?? s.checkInLng;
      const seenAt = s.lastSeenAt ?? s.checkInAt;
      const stale = seenAt ? now - new Date(seenAt).getTime() > STALE_MS : true;
      let insideOffice: string | null = null;
      let distanceMeters: number | null = null;
      if (lat != null && lng != null && offices.length) {
        let best: { d: number; name: string } | null = null;
        for (const o of offices) {
          const d = distanceFromOffice(o, { lat, lng });
          if (!best || d < best.d) best = { d, name: o.name };
        }
        if (best) {
          distanceMeters = Math.round(best.d);
          if (best.d === 0) insideOffice = best.name;
        }
      }
      return {
        user: s.user,
        lat, lng,
        seenAt,
        stale,
        inside: s.lastSeenInside ?? null,
        insideOffice,
        distanceMeters,
      };
    });

    const byOffice = offices.map(o => ({
      id: o.id,
      name: o.name,
      geofenceType: o.geofenceType,
      inside: people.filter(p => p.insideOffice === o.name).length,
    }));

    res.json({
      generatedAt: new Date(),
      offices: byOffice,
      people,
      insideCount: people.filter(p => p.insideOffice).length,
      outsideCount: people.filter(p => !p.stale && !p.insideOffice && p.lat != null).length,
      staleCount: people.filter(p => p.stale).length,
    });
  } catch (err) { next(err); }
}

// ─── Address search for the map editor ──────────────────────────────────────

/**
 * GET /hr/attendance/geocode?q=…
 *
 * Looks an address up so the admin can start the map somewhere useful
 * instead of hunting for their own building. Best-effort by design: an
 * unreachable service returns an empty list, and the editor still works by
 * clicking points on the map.
 */
export async function searchAddress(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const q = (typeof req.query.q === 'string' ? req.query.q : '').trim();
    if (q.length < 3) throw new AppError(400, 'Type at least three characters to search.');
    const results = await geocode(q);
    res.json({ query: q, results });
  } catch (err) { next(err); }
}
