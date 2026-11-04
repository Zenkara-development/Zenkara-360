import { z } from 'zod';

/**
 * Validation helpers for PATCH/PUT bodies.
 *
 * ── The problem these solve ────────────────────────────────────────────────
 * A nullable column comes back from the API as `null`. An edit form that is
 * populated from a record — the normal way to build one — therefore holds
 * `null` for every column the row has not filled in, and sends `null` straight
 * back when the form is submitted.
 *
 * `z.string().optional()` accepts `undefined`, NOT `null`. So the round-trip
 * that every edit form performs — read a record, change one field, send it
 * back — fails validation on any field the record had left empty, and the user
 * is told their input is invalid when they never touched that input at all.
 *
 * That is exactly what happened on Edit User: `User.department` and
 * `User.phone` are both `String?`, so editing any user who had no department
 * or phone recorded (most of them) was rejected outright.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 * For an optional field, `null` and `''` both mean "the client is not setting
 * this", which is the same thing `undefined` means. Treating them as identical
 * makes a PATCH idempotent with respect to fields the caller did not touch,
 * which is what PATCH is supposed to be.
 *
 * Note this deliberately does NOT let `null` clear a stored value: a field
 * omitted from a PATCH must leave the column untouched, and since a form
 * cannot distinguish "was already empty" from "user cleared it", honouring
 * `null` as a wipe would let an unrelated edit silently erase data. Endpoints
 * that genuinely need clearing should keep an explicit `.nullable()` field and
 * handle it deliberately (several already do — see `logoUrl` and
 * `supportEmail` in platformAdmin.controller.ts).
 */

/** null / '' / undefined all collapse to undefined ("not provided"). */
const blankToUndefined = (v: unknown) => (v === null || v === '' ? undefined : v);

/**
 * Wraps a schema so a client echoing back a stored `null` (or an untouched
 * empty input) is treated as having said nothing about that field.
 *
 *   department: optionalField(z.string())
 *   avatarUrl:  optionalField(z.string().url())
 *   smtpPort:   optionalField(z.number().int())
 */
export function optionalField<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(blankToUndefined, schema.optional());
}

/** Shorthand for the overwhelmingly common case. */
export const optionalText = () => optionalField(z.string());

/**
 * Same tolerance, applied to every key of an existing object schema at once —
 * the null-safe equivalent of `Schema.partial()` for update endpoints.
 *
 *   const UpdateSchema = tolerantPartial(CreateSchema);
 *
 * Every field becomes optional AND accepts null/'' as "unchanged", so an
 * update route can safely be handed the same record it just served.
 */
export function tolerantPartial<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape = schema.shape;
  const next: Record<string, z.ZodTypeAny> = {};
  for (const key of Object.keys(shape)) {
    next[key] = z.preprocess(blankToUndefined, (shape[key] as z.ZodTypeAny).optional());
  }
  return z.object(next);
}

/**
 * Turns a ZodError into one sentence a person can act on, naming the field
 * that was rejected rather than saying "Validation error" and leaving them to
 * guess which of fifteen inputs is at fault.
 *
 * "department: expected string, received null" is what a developer needs;
 * "Department is required" is what a user needs. This aims at the second while
 * keeping the field name, which is the part that makes the message useful.
 */
export function describeZodError(err: z.ZodError): string {
  const parts = err.errors.slice(0, 3).map(issue => {
    const path = issue.path.filter(p => typeof p === 'string' || typeof p === 'number').join('.');
    const label = path || 'value';
    if (issue.code === 'invalid_type' && (issue as any).received === 'undefined') {
      return `${label} is required`;
    }
    return `${label}: ${issue.message.charAt(0).toLowerCase()}${issue.message.slice(1)}`;
  });
  const more = err.errors.length > parts.length ? ` (+${err.errors.length - parts.length} more)` : '';
  return parts.join('; ') + more;
}

/**
 * Canonical form of a login address: trimmed and lower-cased.
 *
 * Email domains are case-insensitive by specification, and while the local part
 * technically is not, no mail provider in practice treats `Kesava@` and
 * `kesava@` as different mailboxes. Users (and phone keyboards, which
 * capitalise the first letter automatically) therefore expect either spelling
 * to reach the same account.
 *
 * Before this, password login compared the address exactly while the Google and
 * Entra paths lower-cased theirs, so the two disagreed: an account registered
 * with any capital letter could not be found by SSO, which then provisioned a
 * second account for the same person.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Email input that normalises as it validates, so a controller can never
 * accidentally store or look up a non-canonical address. Use this for anything
 * that identifies a person for sign-in (users, invites, signup requests,
 * portal logins) — NOT for free-text contact details on a CRM record, where the
 * address is data the customer owns and should be preserved as entered.
 */
export const emailField = () =>
  z.string().trim().email().transform(normalizeEmail);
