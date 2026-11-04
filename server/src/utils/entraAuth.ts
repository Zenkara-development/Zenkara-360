// Microsoft Entra ID SSO — hand-rolled REST calls (fetch), no @azure/msal-node
// or passport dependency, matching this codebase's existing pattern for
// third-party OAuth (see the Google Calendar client in utils/googleCalendar.ts,
// which this file mirrors almost exactly: same authorization-code flow, same
// signed-JWT `state` param carried by the caller rather than PKCE — this is a
// confidential client (client_secret held server-side, code exchanged
// server-to-server), so PKCE's interception protection doesn't add much here
// and skipping it keeps this consistent with how Calendar's flow already
// works in this app).
//
// Each *org* configures its own Entra tenant/client (see DirectoryConfig,
// modules/directory/) rather than this app having one global app
// registration — every customer registers CRMITdesk as an app in their own
// Entra tenant and pastes the tenant ID/client ID/secret into their org's
// Single Sign-On settings page.

const GRAPH_ME_URL = 'https://graph.microsoft.com/v1.0/me';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// GroupMember.Read.All is only needed for phase 2's role-mapping lookup
// (fetchEntraGroups below); User.Read alone is enough for phase 1's identity
// check. Requesting it unconditionally at sign-in keeps this file's flow
// simple — Microsoft may prompt the user (or their tenant admin) to consent
// to it the first time regardless of whether the org has any role mappings
// configured yet.
const DELEGATED_SCOPE = 'openid profile email User.Read GroupMember.Read.All';

// Reuses APP_URL — the same env var googleCalendar.ts/storage.controller.ts
// already rely on for building a redirect URI. This one callback URL is
// shared by every org (the org is resolved from the signed `state` param on
// the way back, not from the URL) — each customer registers this exact URI
// as a Redirect URI in their own Entra app registration.
export function entraRedirectUri(): string {
  const appUrl = process.env.APP_URL || 'http://localhost:4000';
  return `${appUrl.replace(/\/$/, '')}/api/auth/entra/callback`;
}

/** Builds the Microsoft sign-in URL for a specific org's tenant/client. */
export function buildEntraAuthUrl(opts: { tenantId: string; clientId: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    response_type: 'code',
    redirect_uri: entraRedirectUri(),
    response_mode: 'query',
    scope: DELEGATED_SCOPE,
    state: opts.state,
  });
  return `https://login.microsoftonline.com/${encodeURIComponent(opts.tenantId)}/oauth2/v2.0/authorize?${params.toString()}`;
}

interface EntraTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

/** Exchanges an authorization code for an access token (server-to-server, uses the org's client secret). */
export async function exchangeEntraCode(opts: {
  tenantId: string; clientId: string; clientSecret: string; code: string;
}): Promise<{ accessToken: string }> {
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(opts.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: entraRedirectUri(),
      scope: DELEGATED_SCOPE,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as EntraTokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || `Microsoft token exchange failed (${res.status})`);
  }
  return { accessToken: json.access_token };
}

interface EntraProfile { id: string; mail: string | null; userPrincipalName: string; displayName: string }

/**
 * Fetches the signed-in user's profile from Microsoft Graph using the access
 * token we just received. This is what actually verifies the token — if
 * Graph accepts the bearer token and returns a profile, Microsoft has vouched
 * for this identity (same trust model as Google's tokeninfo endpoint in
 * utils/googleAuth.ts, just via a different Microsoft endpoint — we don't
 * need to independently validate the id_token's signature/JWKS ourselves).
 */
export async function fetchEntraProfile(accessToken: string): Promise<EntraProfile> {
  const res = await fetch(GRAPH_ME_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error('Could not verify your Microsoft account (Graph /me request failed)');
  // Node's global fetch types Body.json() as Promise<unknown> (stricter than
  // DOM's `any`) — cast once here rather than at every property access below.
  const data = await res.json() as any;
  if (!data.id) throw new Error('Microsoft Graph did not return a user id');
  return { id: data.id, mail: data.mail ?? null, userPrincipalName: data.userPrincipalName, displayName: data.displayName ?? data.userPrincipalName };
}

/**
 * Phase 2: the signed-in user's Entra security group memberships, for
 * DirectoryRoleMapping lookup — see auth.controller.ts entraCallback(). Uses
 * the `/microsoft.graph.group` OData cast so Graph filters out non-group
 * directory objects (other apps/roles a user can be a "member of") for us,
 * and pages through `@odata.nextLink` in case the user belongs to more
 * groups than fit in one response page.
 */
export async function fetchEntraGroups(accessToken: string): Promise<string[]> {
  const ids: string[] = [];
  let url: string | undefined = `${GRAPH_BASE}/me/memberOf/microsoft.graph.group?$select=id`;
  while (url) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error('Could not read your Microsoft group memberships (Graph /memberOf request failed)');
    const data = await res.json() as any;
    for (const g of data.value || []) if (g.id) ids.push(g.id);
    url = data['@odata.nextLink'];
  }
  return ids;
}

interface AppTokenResponse { access_token: string; error?: string; error_description?: string }

/**
 * Phase 3: an app-only (client_credentials) token, for the scheduled sync
 * job — unlike the rest of this file, this isn't tied to any one user
 * signing in, so it can't use a delegated access token. Reuses the same
 * tenant/client ID/secret already stored for interactive sign-in; the only
 * new requirement is that the org's Entra admin grants this app the
 * *application* permission GroupMember.Read.All (not the delegated one
 * above) with admin consent — see the phase 3 testing notes.
 */
export async function getAppOnlyToken(opts: { tenantId: string; clientId: string; clientSecret: string }): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(opts.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      grant_type: 'client_credentials',
      scope: 'https://graph.microsoft.com/.default',
    }),
  });
  const json = (await res.json().catch(() => ({}))) as AppTokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || `Microsoft app-only token request failed (${res.status})`);
  }
  return json.access_token;
}

export interface EntraGroupMember { id: string; mail: string | null; userPrincipalName: string; displayName: string; accountEnabled: boolean }

/** Phase 3: every member of one Entra security group, app-only, paginated. */
export async function fetchGroupMembers(appToken: string, groupId: string): Promise<EntraGroupMember[]> {
  const members: EntraGroupMember[] = [];
  let url: string | undefined =
    `${GRAPH_BASE}/groups/${encodeURIComponent(groupId)}/members?$select=id,mail,userPrincipalName,displayName,accountEnabled`;
  while (url) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${appToken}` } });
    if (!res.ok) throw new Error(`Could not read members of group ${groupId} (Graph request failed, ${res.status})`);
    const data = await res.json() as any;
    for (const m of data.value || []) {
      // /members can include non-user objects (nested groups, service
      // principals) — only rows with a userPrincipalName are actual people.
      if (m.id && m.userPrincipalName) {
        members.push({ id: m.id, mail: m.mail ?? null, userPrincipalName: m.userPrincipalName, displayName: m.displayName ?? m.userPrincipalName, accountEnabled: m.accountEnabled ?? true });
      }
    }
    url = data['@odata.nextLink'];
  }
  return members;
}

/**
 * Lightweight "does this tenant exist" check for the admin settings page's
 * Test Connection button — fetches the tenant's OIDC discovery document.
 * This confirms the tenant ID is real and reachable; it does NOT validate
 * the client ID/secret (that only happens on an actual sign-in attempt,
 * since there's no credential-check endpoint short of a real token exchange).
 */
export async function testEntraTenant(tenantId: string): Promise<{ ok: boolean; issuer?: string; error?: string }> {
  try {
    const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/v2.0/.well-known/openid-configuration`);
    if (!res.ok) return { ok: false, error: `Tenant not found or not reachable (${res.status})` };
    const json = await res.json() as any;
    return { ok: true, issuer: json.issuer };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Could not reach Microsoft Entra ID' };
  }
}
