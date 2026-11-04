import dns from 'dns/promises';
import net from 'net';

/**
 * SSRF guard for outbound requests to ADMIN-SUPPLIED URLs (workflow webhook
 * actions, custom-module external sync). Without it, an org admin — or an
 * attacker who reached an admin session — can point these at
 * http://169.254.169.254/ (cloud metadata), internal service IPs, or
 * localhost, and use this server as a pivot into infrastructure the tenant
 * should never be able to reach. Custom-module sync even parses and imports
 * the response body, so blind SSRF becomes full read access.
 *
 * Known limitation (documented, accepted): the hostname is resolved here and
 * again by fetch(), so a DNS-rebinding attacker with a sub-second TTL could
 * in principle pass the check and rebind before the request; closing that
 * fully needs a pinned-address HTTP agent. This guard still blocks the
 * practical direct cases (IP-literal URLs, stable DNS names). Callers must
 * also pass `redirect: 'manual'` to fetch — otherwise a public URL that
 * 302s to a private one walks straight around the check.
 */

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;          // this-net, private, loopback
  if (a === 169 && b === 254) return true;                    // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true;           // private
  if (a === 192 && b === 168) return true;                    // private
  if (a === 100 && b >= 64 && b <= 127) return true;          // CGNAT
  if (a >= 224) return true;                                  // multicast/reserved/broadcast
  return false;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIP(ip) === 4) return isPrivateIPv4(ip);
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;         // unspecified, loopback
  if (lower.startsWith('fe80:')) return true;                 // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local fc00::/7
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

/**
 * Throws (with a message safe to surface to the org admin) unless the URL is
 * http(s) and its host resolves only to public addresses.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Only http(s) URLs are allowed (got ${url.protocol}//)`);
  }

  // url.hostname strips the [] off IPv6 literals already.
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new Error('URLs pointing at internal hosts are not allowed');
  }

  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('URLs pointing at private or internal IP addresses are not allowed');
    return;
  }

  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`Could not resolve host: ${host}`);
  }
  for (const { address } of addrs) {
    if (isPrivateIp(address)) {
      throw new Error('URLs resolving to private or internal IP addresses are not allowed');
    }
  }
}
