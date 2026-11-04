// Per-user Google Calendar sync — hand-rolled REST calls (fetch), no
// googleapis SDK dependency, matching this codebase's existing pattern of
// talking to third-party APIs directly (see the Twilio REST client in
// inbox.controller.ts). One-way push only: Activities (due date) and
// assigned Tickets (SLA due date) become calendar events; nothing is ever
// pulled back from Google into this app.
//
// Requires GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (same OAuth 2.0 Client as
// Google SSO, see utils/googleAuth.ts, or a separate one — either works as
// long as "Google Calendar API" is enabled for it in Google Cloud Console
// and the redirect URI below is registered).

import crypto from 'crypto';
import { prisma } from './prisma';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events email';

export function isCalendarSyncConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// Reuses APP_URL — the same env var storage.controller.ts's Google Drive
// OAuth flow and mailer.ts already rely on for building a redirect URI, so
// there's nothing new to configure if Drive is already connected. Same
// GOOGLE_CLIENT_ID/SECRET too — one OAuth client can register multiple
// redirect URIs, so Drive and Calendar sync can share it (just make sure
// both /api/storage/google/callback and /api/calendar/callback are added
// as Authorized redirect URIs in Google Cloud Console).
function redirectUri(): string {
  const appUrl = process.env.APP_URL || 'http://localhost:4000';
  return `${appUrl.replace(/\/$/, '')}/api/calendar/callback`;
}

/** Builds the Google consent-screen URL. `state` should be a short-lived signed token identifying the requesting user. */
export function buildCalendarAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string; refreshToken?: string; expiresIn: number; email?: string;
}> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
  const json = (await res.json()) as GoogleTokenResponse;

  // The id_token is a JWT; we only need the email claim out of it for display
  // purposes (calendar sync doesn't need to *verify* it the way login does —
  // it's just a label — but we still only trust it because it came straight
  // back from Google's own token endpoint over TLS, not from the client).
  let email: string | undefined;
  if (json.id_token) {
    try {
      const payload = JSON.parse(Buffer.from(json.id_token.split('.')[1], 'base64').toString());
      email = payload.email;
    } catch { /* best-effort */ }
  }

  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresIn: json.expires_in, email };
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`);
  const json = (await res.json()) as GoogleTokenResponse;
  return { accessToken: json.access_token, expiresIn: json.expires_in };
}

/** Returns a valid access token for this user's connection, refreshing (and persisting) it if expired. */
async function getValidAccessToken(userId: string): Promise<{ accessToken: string; calendarId: string } | null> {
  const conn = await prisma.calendarConnection.findUnique({ where: { userId } });
  if (!conn) return null;

  if (conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() > Date.now() + 60_000) {
    return { accessToken: conn.accessToken, calendarId: conn.calendarId };
  }
  if (!conn.refreshToken) return { accessToken: conn.accessToken, calendarId: conn.calendarId }; // best effort, will 401 if truly expired

  const refreshed = await refreshAccessToken(conn.refreshToken);
  await prisma.calendarConnection.update({
    where: { userId },
    data: { accessToken: refreshed.accessToken, tokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000) },
  });
  return { accessToken: refreshed.accessToken, calendarId: conn.calendarId };
}

interface EventInput {
  /** Stable id for this app-side entity, used to upsert (create-or-update) the same calendar event on re-sync rather than duplicating it. */
  sourceId: string;
  summary: string;
  description?: string;
  start: Date;
  end: Date;
}

// Google Calendar event ids must be lowercase base32hex, 5-1024 chars — derive
// a deterministic one from our own entity id so re-syncing the same
// Activity/Ticket updates the existing event instead of creating a duplicate.
function deterministicEventId(sourceId: string): string {
  return 'crmitdesk' + crypto.createHash('sha1').update(sourceId).digest('hex').slice(0, 20);
}

/** Creates or updates (upserts) a calendar event for this user. Silently returns false if the user has no connection or sync is off. */
export async function pushCalendarEvent(userId: string, kind: 'activities' | 'tickets', event: EventInput): Promise<boolean> {
  const conn = await prisma.calendarConnection.findUnique({ where: { userId } });
  if (!conn) return false;
  if (kind === 'activities' && !conn.syncActivities) return false;
  if (kind === 'tickets' && !conn.syncTickets) return false;

  const auth = await getValidAccessToken(userId);
  if (!auth) return false;

  const eventId = deterministicEventId(event.sourceId);
  const body = {
    summary: event.summary,
    description: event.description || '',
    start: { dateTime: event.start.toISOString() },
    end: { dateTime: event.end.toISOString() },
  };

  const url = `${CALENDAR_API}/calendars/${encodeURIComponent(auth.calendarId)}/events/${eventId}`;
  let res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${auth.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 404) {
    // Doesn't exist yet — create it with our deterministic id instead of a Google-assigned one.
    res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(auth.calendarId)}/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, id: eventId }),
    });
  }
  if (!res.ok) {
    console.error('[googleCalendar] push failed:', await res.text().catch(() => res.statusText));
    return false;
  }
  await prisma.calendarConnection.update({ where: { userId }, data: { lastSyncAt: new Date() } });
  return true;
}
