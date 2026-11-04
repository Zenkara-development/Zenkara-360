// ─── Attendance verification rules ───────────────────────────────────────────
//
// An org decides, separately for check-in and check-out, which signals must
// hold and how they combine:
//
//   location — GPS inside an office geofence
//   network  — client IP on an office's allowlist (skipped when no office has one)
//   face     — live face matches the user's FaceEnrollment
//
//   mode ALL → every enabled signal must pass (AND)
//   mode ANY → at least one enabled signal must pass (OR)
//   enforce  → block the action on failure; otherwise record the result only
//
// Defaults reproduce the pre-existing behaviour: check-in requires location
// AND network and blocks; check-out records the same signals without blocking.

import { z } from 'zod';

export type SignalKey = 'location' | 'network' | 'face';

export interface VerificationRule {
  location: boolean;
  network: boolean;
  face: boolean;
  mode: 'ALL' | 'ANY';
  enforce: boolean;
}

export const RuleSchema = z.object({
  location: z.boolean(),
  network: z.boolean(),
  face: z.boolean(),
  mode: z.enum(['ALL', 'ANY']),
  enforce: z.boolean(),
});

export const DEFAULT_CHECK_IN_RULE: VerificationRule  = { location: true, network: true, face: false, mode: 'ALL', enforce: true };
export const DEFAULT_CHECK_OUT_RULE: VerificationRule = { location: true, network: true, face: false, mode: 'ALL', enforce: false };

export function parseRule(value: unknown, fallback: VerificationRule): VerificationRule {
  const r = RuleSchema.safeParse(value);
  return r.success ? r.data : fallback;
}

/** Per-signal outcome. `null` = not applicable (e.g. no IP allowlist configured), which never counts against the user. */
export interface SignalResults {
  location: boolean | null;
  network: boolean | null;
  face: boolean | null;
}

export interface RuleEvaluation {
  passed: boolean;
  /** Enabled signals that were checked and failed */
  failed: SignalKey[];
  /** Enabled signals that were actually evaluated (not n/a) */
  checked: SignalKey[];
}

export function evaluateRule(rule: VerificationRule, results: SignalResults): RuleEvaluation {
  const enabled = (['location', 'network', 'face'] as SignalKey[]).filter(k => rule[k]);
  const checked = enabled.filter(k => results[k] !== null);
  const failed = checked.filter(k => results[k] === false);
  if (checked.length === 0) return { passed: true, failed, checked };
  const passed = rule.mode === 'ALL' ? failed.length === 0 : failed.length < checked.length;
  return { passed, failed, checked };
}

export function describeRule(rule: VerificationRule): string {
  const parts: string[] = [];
  if (rule.location) parts.push('being at an office');
  if (rule.network) parts.push('the office network');
  if (rule.face) parts.push('face verification');
  if (parts.length === 0) return 'no verification';
  return parts.join(rule.mode === 'ALL' ? ' and ' : ' or ');
}
