// ─── Geofence entry / exit events ───────────────────────────────────────────
//
// The attendance record already knows whether a person is inside an office
// right now (`lastSeenInside`), but it only describes the *current* session:
// when the session closes, the history of where they went is gone. This
// module keeps the transitions — the moments somebody crossed a boundary —
// so an admin reviewing "the system says I wasn't in the office" can see
// when they arrived and when they left.
//
// ── Why transitions and not pings ───────────────────────────────────────────
//
// AttendanceLocationPing already stores every GPS fix, and it is purged on
// the org's `locationRetentionDays` (30 by default). Writing a row per ping
// here would duplicate that data, store it twice the rate, and survive
// nothing. A transition is rare — a handful per person per day — and it is
// the thing a human actually reviews.
//
// ── How duplicates are prevented ───────────────────────────────────────────
//
// Twice over, on purpose:
//
//   1. A transition is only recorded when the new state DIFFERS from the
//      person's last recorded event. Ten GPS fixes in a row saying "inside"
//      produce one ENTER and then nothing, because the state hasn't changed.
//      This is the rule that makes repeated GPS events harmless.
//   2. The row carries a per-employee sequence number with a unique index on
//      (userId, seq). Two concurrent writers cannot both claim the same
//      slot, so even a race between a check-in and a heartbeat landing in
//      the same second cannot produce two rows.

import { prisma } from './prisma';

export type GeofenceEventType = 'ENTER' | 'EXIT';

export type GeofenceEventSource = 'HEARTBEAT' | 'CHECK_IN' | 'CHECK_OUT' | 'STATUS_CHECK';

/** GPS fixes looser than this are ignored for the geofence decision. */
export const MAX_USABLE_ACCURACY_M = 250;

/**
 * Is this fix good enough to decide anything?
 *
 * A missing accuracy is treated as usable (some browsers omit it), but a
 * known-loose fix — "you're within 500 metres of this spot" — is not allowed
 * to flip somebody from inside to outside. A stale or vague reading leaves
 * the previous state alone.
 */
export function isUsableAccuracy(accuracy: number | null | undefined): boolean {
  if (accuracy == null) return true;
  if (!Number.isFinite(accuracy)) return false;
  return accuracy <= MAX_USABLE_ACCURACY_M;
}

/**
 * What event (if any) does this new inside/outside state produce?
 *
 * `previous` is the type of the person's most recent recorded event, or null
 * when nothing has been recorded for them yet.
 *
 *   previous=null  + inside=true  → ENTER  (we've just found them inside)
 *   previous=null  + inside=false → null   (never seen inside; nothing to exit from)
 *   previous=ENTER + inside=true  → null   (still inside — not a transition)
 *   previous=ENTER + inside=false → EXIT
 *   previous=EXIT  + inside=true  → ENTER
 *   previous=EXIT  + inside=false → null   (still outside)
 *
 * A null `inside` means "no usable fix" and never produces an event.
 */
export function decideGeofenceEvent(
  previous: GeofenceEventType | null,
  inside: boolean | null,
): GeofenceEventType | null {
  if (inside === null) return null;
  const next: GeofenceEventType = inside ? 'ENTER' : 'EXIT';
  if (previous === next) return null;
  if (next === 'EXIT' && previous === null) return null;
  return next;
}

/** The most recent geofence event for this employee, or null. */
export async function lastGeofenceEvent(
  orgId: string,
  userId: string,
): Promise<{ eventType: GeofenceEventType; at: Date; seq: number } | null> {
  const row = await prisma.attendanceGeofenceEvent.findFirst({
    where: { orgId, userId },
    orderBy: [{ seq: 'desc' }],
    select: { eventType: true, at: true, seq: true },
  });
  if (!row) return null;
  return { eventType: row.eventType as GeofenceEventType, at: row.at, seq: row.seq };
}

export interface RecordGeofenceEventInput {
  orgId: string;
  userId: string;
  /** The attendance session this happened during, when there was one. */
  recordId?: string | null;
  officeLocationId?: string | null;
  officeName?: string | null;
  eventType: GeofenceEventType;
  lat: number;
  lng: number;
  accuracy?: number | null;
  source?: GeofenceEventSource;
  at?: Date;
}

/**
 * Records a transition, unless it isn't one.
 *
 * Returns the created row, or null when the event was a duplicate and was
 * deliberately not written.
 */
export async function recordGeofenceEvent(
  input: RecordGeofenceEventInput,
): Promise<{ id: string; eventType: GeofenceEventType; at: Date } | null> {
  const previous = await lastGeofenceEvent(input.orgId, input.userId);
  const at = input.at ?? new Date();

  // The caller decided this was a transition; make sure it still is against
  // the freshly-read previous event (two writers can race).
  if (previous && previous.eventType === input.eventType) return null;

  const seq = (previous?.seq ?? 0) + 1;
  try {
    const created = await prisma.attendanceGeofenceEvent.create({
      data: {
        orgId: input.orgId,
        userId: input.userId,
        recordId: input.recordId ?? null,
        officeLocationId: input.officeLocationId ?? null,
        officeName: input.officeName ?? null,
        eventType: input.eventType,
        at,
        lat: input.lat,
        lng: input.lng,
        accuracy: input.accuracy ?? null,
        source: input.source ?? 'HEARTBEAT',
        seq,
      },
      select: { id: true, eventType: true, at: true },
    });
    return { id: created.id, eventType: created.eventType as GeofenceEventType, at: created.at };
  } catch (err: any) {
    // P2002 = the (userId, seq) unique index: somebody else recorded the
    // same slot first. That is exactly the duplicate we wanted to avoid.
    if (err?.code === 'P2002') return null;
    throw err;
  }
}

/**
 * Records the transition implied by a new inside/outside reading, if any.
 *
 * The caller supplies the *new* state; this looks up the person's last event
 * and writes only when the state actually changed.
 */
export async function recordTransition(
  input: Omit<RecordGeofenceEventInput, 'eventType'> & { inside: boolean | null },
): Promise<{ id: string; eventType: GeofenceEventType; at: Date } | null> {
  const previous = await lastGeofenceEvent(input.orgId, input.userId);
  const eventType = decideGeofenceEvent(previous?.eventType ?? null, input.inside);
  if (!eventType) return null;
  return recordGeofenceEvent({ ...input, eventType });
}
