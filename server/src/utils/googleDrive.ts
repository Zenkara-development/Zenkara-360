import https from 'https';

// Raw HTTPS calls, no googleapis SDK — same convention as stripe.ts and
// whatsapp.ts elsewhere in this codebase (avoids a heavy dependency for a
// handful of REST endpoints).

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

// drive.file (not full drive access): the app can only see/manage files it
// itself created, which keeps Google's OAuth consent screen at the lowest
// "sensitive scope" tier rather than the "restricted scope" tier that full
// Drive access requires (restricted scopes need a costly annual security
// assessment from Google to use in production). userinfo.email is just to
// show which Google account is connected in the Settings UI.
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export function isGoogleDriveConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

/** Builds the URL to send the org admin to for the Google consent screen. */
export function getGoogleAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline', // required to get a refresh_token back
    prompt: 'consent',      // forces refresh_token on reconnect too, not just first-ever connect
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

function postForm<T = any>(hostname: string, path: string, body: Record<string, string>): Promise<T> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams(body).toString();
    const req = https.request(
      { hostname, path, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(params) } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 400) return reject(new Error(json.error_description || json.error || `Google API ${res.statusCode}`));
            resolve(json);
          } catch (e) { reject(e); }
        });
      },
    );
    req.on('error', reject);
    req.write(params);
    req.end();
  });
}

function driveRequest<T = any>(method: string, path: string, accessToken: string, opts: { body?: Buffer | string; contentType?: string; query?: Record<string, string> } = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const query = opts.query ? '?' + new URLSearchParams(opts.query).toString() : '';
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
    if (opts.body) {
      headers['Content-Type'] = opts.contentType || 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(opts.body as any));
    }
    const req = https.request(
      { hostname: 'www.googleapis.com', path: path + query, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode && res.statusCode >= 400) {
            return reject(new Error(`Google Drive API ${res.statusCode}: ${buf.toString('utf8').slice(0, 500)}`));
          }
          resolve(buf as any);
        });
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** Exchanges the one-time OAuth code from the callback for real tokens. */
export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<TokenResponse> {
  return postForm('oauth2.googleapis.com', '/token', {
    code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code',
  });
}

/** Refreshes an expired access token. Google does not return a new refresh_token here — the original keeps working indefinitely unless revoked. */
export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  return postForm('oauth2.googleapis.com', '/token', {
    refresh_token: refreshToken, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'refresh_token',
  });
}

export async function getConnectedEmail(accessToken: string): Promise<string> {
  const buf = await new Promise<Buffer>((resolve, reject) => {
    const req = https.request(
      { hostname: 'www.googleapis.com', path: '/oauth2/v2/userinfo', method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on('error', reject);
    req.end();
  });
  const json = JSON.parse(buf.toString('utf8'));
  return json.email || 'unknown';
}

/** Creates the dedicated app folder in the connected Drive that every upload for this org lives under. */
export async function createAppFolder(accessToken: string, name: string): Promise<string> {
  const body = JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' });
  const res = await driveRequest<Buffer>('POST', '/drive/v3/files', accessToken, { body, contentType: 'application/json' });
  const json = JSON.parse(res.toString('utf8'));
  return json.id;
}

export interface UploadedFile {
  id: string;
  webViewLink: string;
}

/** Multipart upload (metadata + bytes in one request) — Drive API's standard approach for smaller files. */
export async function uploadFile(accessToken: string, folderId: string, file: { buffer: Buffer; filename: string; mimeType: string }): Promise<UploadedFile> {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({ name: file.filename, parents: [folderId] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${file.mimeType}\r\n\r\n`),
    file.buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await new Promise<Buffer>((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'www.googleapis.com',
        path: '/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (r) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (r.statusCode && r.statusCode >= 400) return reject(new Error(`Google Drive upload ${r.statusCode}: ${buf.toString('utf8').slice(0, 500)}`));
          resolve(buf);
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  const json = JSON.parse(res.toString('utf8'));
  return { id: json.id, webViewLink: json.webViewLink };
}

/** Downloads the raw bytes of a file — used to proxy attachments through our own backend rather than exposing direct Drive links/permissions to end users. */
export async function downloadFile(accessToken: string, fileId: string): Promise<Buffer> {
  return driveRequest<Buffer>('GET', `/drive/v3/files/${fileId}`, accessToken, { query: { alt: 'media' } });
}

export async function deleteFile(accessToken: string, fileId: string): Promise<void> {
  await driveRequest('DELETE', `/drive/v3/files/${fileId}`, accessToken);
}
