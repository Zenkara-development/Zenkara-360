/**
 * Direct-DB helpers for e2e tests that need to reach past what the UI can
 * do — e.g. registration no longer logs a user in immediately (see
 * OrgSignupRequest / approveOrgSignup in auth.controller.ts): the real
 * approval link only ever reaches an inbox, which tests can't click. This
 * mirrors seed-admin.ts's approach of loading server/.env directly so
 * Prisma can talk to the same DB the dev server is using.
 */
import { PrismaClient } from '@prisma/client';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../server/.env') });

export const prisma = new PrismaClient();

/** Fetches the token for a pending OrgSignupRequest so a test can "click"
 *  the approve link via API request instead of an actual email. */
export async function getPendingOrgSignupToken(email: string): Promise<string> {
  const req = await prisma.orgSignupRequest.findFirst({
    where: { email, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  });
  if (!req) throw new Error(`No pending OrgSignupRequest found for ${email}`);
  return req.token;
}
