import crypto from 'crypto';

/**
 * Field-level encryption for secrets we have to store at rest but never want
 * sitting in the database as plain text — currently just the connected
 * mailbox (IMAP/SMTP) password on EmailAccount. Everything else that's
 * sensitive (refresh tokens, portal tokens, API keys, TOTP backup codes) is
 * already stored as a one-way hash; a mailbox password can't be, since we
 * need the original value back to actually authenticate with the mail
 * server, so this uses reversible AES-256-GCM instead.
 */

const ALGO = 'aes-256-gcm';
const FORMAT_PREFIX = 'v1';

/**
 * Constant-time comparison for shared secrets (cron-endpoint headers, etc.).
 * A plain `===` short-circuits at the first differing character, so response
 * timing leaks how much of a guess was right — slow to exploit remotely, but
 * free to close. Hashing both sides first normalises length (timingSafeEqual
 * throws on unequal lengths, which would itself leak the secret's length).
 */
export function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// Hash whatever string the operator provides down to a 32-byte key, so
// ENCRYPTION_KEY can be any passphrase rather than requiring exact hex.
function deriveKey(passphrase: string): Buffer {
  return crypto.createHash('sha256').update(passphrase).digest();
}

function getKey(passphrase?: string): Buffer {
  if (passphrase) return deriveKey(passphrase);
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is not set. Set it to a long random ' +
      'string — required to store connected mailbox credentials securely.',
    );
  }
  return deriveKey(secret);
}

/**
 * Encrypts a secret (e.g. a connected mailbox password) for storage.
 * `passphrase` overrides ENCRYPTION_KEY — only scripts/rotate-encryption-key.ts uses it.
 */
export function encryptSecret(plaintext: string, passphrase?: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(passphrase), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [FORMAT_PREFIX, iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
}

/** Decrypts a value produced by encryptSecret(). Throws if malformed. */
export function decryptSecret(stored: string, passphrase?: string): string {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== FORMAT_PREFIX) {
    throw new Error('Value is not in the expected encrypted format');
  }
  const [, ivHex, authTagHex, dataHex] = parts;
  const decipher = crypto.createDecipheriv(ALGO, getKey(passphrase), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Decrypts a value if it's in our encrypted format, otherwise returns it
 * unchanged. This lets mailbox credentials saved *before* this change keep
 * working with no manual data migration — every new save goes through
 * encryptSecret() and is in the versioned format from then on, and this
 * falls back gracefully for anything still stored as plain text.
 */
export function decryptSecretOrPlain(stored: string): string {
  if (!stored.startsWith(`${FORMAT_PREFIX}:`)) return stored;
  try {
    return decryptSecret(stored);
  } catch {
    return stored;
  }
}
