// Google Sign-In verification — deliberately dependency-free (no
// google-auth-library), matching this codebase's pattern elsewhere of
// hand-rolled HTTP calls over an SDK (see the Twilio REST client in
// utils/whatsapp.ts). Google's tokeninfo endpoint validates the ID token's
// signature/expiry for us and hands back its claims; we still re-check `aud`
// ourselves so a token minted for a *different* Google OAuth client can't be
// replayed against this app.
//
// Requires GOOGLE_CLIENT_ID to be set (the OAuth 2.0 Client ID created in
// Google Cloud Console for this app — see Appendix A / README for setup).
// Until it's set, googleLogin()/linkGoogleAccount() reject with a clear
// "not configured" error rather than silently accepting unverifiable tokens.

interface GoogleTokenInfo {
  sub: string;
  email: string;
  email_verified: string | boolean;
  name?: string;
  aud: string;
  exp: string;
}

export function isGoogleSsoConfigured(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID;
}

/**
 * Verifies a Google-issued ID token and returns its claims, or throws if the
 * token is invalid/expired/unverified/minted for a different client.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<{ sub: string; email: string; name: string }> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error('Google SSO is not configured on this server (GOOGLE_CLIENT_ID missing)');
  }

  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!res.ok) {
    throw new Error('Invalid or expired Google token');
  }
  const info = (await res.json()) as GoogleTokenInfo;

  if (info.aud !== clientId) {
    throw new Error('Google token was not issued for this application');
  }
  if (info.email_verified !== 'true' && info.email_verified !== true) {
    throw new Error('Google account email is not verified');
  }

  return { sub: info.sub, email: info.email.toLowerCase(), name: info.name || info.email };
}
