import crypto from 'crypto';

// ─── Base32 helpers ───────────────────────────────────────────────────────────

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, output = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(str: string): Buffer {
  const s = str.toUpperCase().replace(/=+$/, '');
  const bytes: number[] = [];
  let bits = 0, value = 0;
  for (const char of s) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

// ─── TOTP core ────────────────────────────────────────────────────────────────

export function generateSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function generateTOTP(secret: string, counter?: number): string {
  const t = counter ?? Math.floor(Date.now() / 30_000);
  const buf = Buffer.alloc(8);
  // Write 64-bit big-endian counter
  const high = Math.floor(t / 0x100000000);
  const low  = t >>> 0;
  buf.writeUInt32BE(high, 0);
  buf.writeUInt32BE(low, 4);

  const key = base32Decode(secret);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (
    ((hmac[offset]     & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) <<  8) |
     (hmac[offset + 3] & 0xff)
  ) % 1_000_000;

  return code.toString().padStart(6, '0');
}

export function verifyTOTP(secret: string, token: string, window = 1): boolean {
  const t = Math.floor(Date.now() / 30_000);
  for (let i = -window; i <= window; i++) {
    if (generateTOTP(secret, t + i) === token) return true;
  }
  return false;
}

export function otpAuthUri(secret: string, email: string, issuer = 'CRM & IT Desk'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function generateBackupCodes(count = 8): string[] {
  return Array.from({ length: count }, () => crypto.randomBytes(4).toString('hex').toUpperCase());
}
