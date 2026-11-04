import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { optionalField, optionalText, emailField } from '../../../utils/zodHelpers';
import { prisma } from '../../../utils/prisma';
import { Prisma } from '@prisma/client';
import { AppError } from '../../../middleware/errorHandler';
import { AuthRequest } from '../../../middleware/authenticate';
import { logAction } from '../../../utils/auditLog';
import { verifyTotpLogin } from '../../totp/totp.controller';
import { sendMail, emailTemplates } from '../../../utils/mailer';
// New logins become employees automatically — see utils/employeeProvisioning.ts.
import { ensureEmployeeForUser } from '../../../utils/employeeProvisioning';
import { assertSeatAvailable } from '../../../utils/licensing';
import { demoLoginEmail, DEMO_VERTICAL_SLUGS, DEFAULT_VERTICAL, loginEmailFor } from '../../../utils/seedDemoData';
import { verifyGoogleIdToken, isGoogleSsoConfigured } from '../../../utils/googleAuth';
import { decryptSecret } from '../../../utils/crypto';
import { buildEntraAuthUrl, exchangeEntraCode, fetchEntraProfile, fetchEntraGroups } from '../../../utils/entraAuth';
import { resolveRoleForGroups } from '../../directory/roleMapping';

const RegisterSchema = z.object({
  name: z.string().min(2),
  email: emailField(),
  password: z.string().min(8),
  organizationName: z.string().min(2),
});

const ApproveOrgSignupSchema = z.object({
  token: z.string(),
  action: z.enum(['approve', 'reject']).default('approve'),
});

// Every new-org signup is emailed here for review before anything is created —
// see register()/approveOrgSignup() below. Comes ONLY from the environment:
// a personal inbox hardcoded as a fallback meant every white-label deployment
// silently routed its customers' signup requests to the original developer.
// When unset, the request is still saved durably (an admin can approve it
// from the platform console); only the courtesy email is skipped.
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const LoginSchema = z.object({
  email: emailField(),
  password: z.string(),
  // 6-digit TOTP code, or an 8-char backup code — only required when the
  // account has 2FA enabled (see login() below).
  totpToken: z.string().optional(),
});

const AcceptInviteSchema = z.object({
  token: z.string(),
  name: z.string().min(2),
  password: z.string().min(8),
});

const ForgotPasswordSchema = z.object({
  email: emailField(),
});

const ResetPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(8),
});

const GoogleLoginSchema = z.object({
  // The ID token returned by Google's Sign-In JS SDK on the client — verified
  // server-side against Google's public keys before we trust the email/sub
  // claims inside it. See utils/googleAuth.ts.
  idToken: z.string(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function uniqueSlug(base: string) {
  let slug = base;
  let i = 1;
  while (await prisma.organization.findUnique({ where: { slug } })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function signAccessToken(user: { id: string; role: string; email: string; orgId: string }) {
  return jwt.sign(user, process.env.JWT_SECRET!, {
    expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as jwt.SignOptions['expiresIn'],
  });
}

function generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

async function storeRefreshToken(userId: string, rawToken: string) {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashToken(rawToken), expiresAt },
  });
}

/** Build the full user response payload */
function userPayload(user: any, org: any) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    orgId: user.orgId || org?.id || '',
    avatarUrl: user.avatarUrl ?? null,
    org: org ? { id: org.id, name: org.name, slug: org.slug } : null,
  };
}

// ─── Controllers ─────────────────────────────────────────────────────────────

/**
 * POST /auth/register — no org/user is created here. The submission is held
 * as a pending OrgSignupRequest and emailed to ADMIN_NOTIFY_EMAIL for review;
 * the org + first SUPER_ADMIN user are only created once that request is
 * approved via approveOrgSignup() below (email link -> /approve-org page).
 */
export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const data = RegisterSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new AppError(409, 'Email already registered');

    const passwordHash = await bcrypt.hash(data.password, 12);
    const token = crypto.randomBytes(32).toString('hex');

    // Re-submitting while still pending (e.g. the admin hasn't gotten to the
    // first email, or the requester mistyped something) refreshes the same
    // request in place — new token, latest details, one more email — rather
    // than piling up duplicate requests or hard-rejecting a good-faith retry.
    const existingRequest = await prisma.orgSignupRequest.findFirst({
      where: { email: data.email, status: 'PENDING' },
    });
    if (existingRequest) {
      await prisma.orgSignupRequest.update({
        where: { id: existingRequest.id },
        data: { organizationName: data.organizationName, name: data.name, passwordHash, token },
      });
    } else {
      await prisma.orgSignupRequest.create({
        data: {
          organizationName: data.organizationName,
          name: data.name,
          email: data.email,
          passwordHash,
          token,
        },
      });
    }

    // Fire-and-forget — the request is already durably saved above; the
    // client shouldn't hang waiting on SMTP (same pattern as ticket/deal
    // notification emails elsewhere in this codebase).
    const approveLink = `${FRONTEND_URL}/approve-org?token=${token}`;
    if (ADMIN_NOTIFY_EMAIL) {
      sendMail(emailTemplates.orgSignupRequest(ADMIN_NOTIFY_EMAIL, {
        organizationName: data.organizationName, name: data.name, email: data.email,
      }, approveLink)).catch(() => {});
    } else {
      console.warn('[auth] ADMIN_NOTIFY_EMAIL is not set — org signup request saved but no notification email sent');
    }

    res.status(202).json({
      pending: true,
      message: "Your request has been submitted for approval. You'll get an email once it's approved.",
    });
  } catch (err) { next(err); }
}

/** GET /auth/org-signup-info?token=... — validate token before the approval page renders */
export async function orgSignupInfo(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.query.token as string;
    if (!token) throw new AppError(400, 'Token required');
    const request = await prisma.orgSignupRequest.findUnique({ where: { token } });
    if (!request) throw new AppError(404, 'Signup request not found');
    res.json({
      organizationName: request.organizationName,
      name: request.name,
      email: request.email,
      status: request.status,
      createdAt: request.createdAt,
    });
  } catch (err) { next(err); }
}

/**
 * POST /auth/approve-org-signup — the only place that actually creates the
 * org + SUPER_ADMIN user for a signup request. Secured by the random token
 * (mirrors accept-invite/portal-verify), not a login, since the person
 * clicking it is reviewing an email, not authenticated in the app.
 */
export async function approveOrgSignup(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, action } = ApproveOrgSignupSchema.parse(req.body);

    const request = await prisma.orgSignupRequest.findUnique({ where: { token } });
    if (!request) throw new AppError(404, 'Signup request not found');
    if (request.status !== 'PENDING') throw new AppError(400, `Request already ${request.status.toLowerCase()}`);

    if (action === 'reject') {
      await prisma.orgSignupRequest.update({
        where: { id: request.id },
        data: { status: 'REJECTED', decidedAt: new Date() },
      });
      return res.json({ status: 'REJECTED' });
    }

    // Re-check — email could've been registered by another route since the request was submitted
    const existing = await prisma.user.findUnique({ where: { email: request.email } });
    if (existing) {
      await prisma.orgSignupRequest.update({
        where: { id: request.id },
        data: { status: 'REJECTED', decidedAt: new Date() },
      });
      throw new AppError(409, 'Email was already registered elsewhere — request auto-rejected');
    }

    const slug = await uniqueSlug(slugify(request.organizationName));
    const { user, org } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const org = await tx.organization.create({
        data: { name: request.organizationName, slug },
      });
      const user = await tx.user.create({
        data: { name: request.name, email: request.email, passwordHash: request.passwordHash, role: 'SUPER_ADMIN', orgId: org.id },
        select: { id: true, name: true, email: true, role: true, orgId: true, avatarUrl: true },
      });
      return { user, org };
    });

    await prisma.orgSignupRequest.update({
      where: { id: request.id },
      data: { status: 'APPROVED', decidedAt: new Date() },
    });

    // The founder is staff too — without this their own org has an employee
    // list that doesn't contain them.
    await ensureEmployeeForUser(user.id);

    // orgId included for consistency, though a just-created org will always
    // fall through to the platform mailer here (no EmailAccount yet).
    sendMail({ ...emailTemplates.orgSignupApproved(user.email, user.name, org.name, `${FRONTEND_URL}/login`), orgId: org.id }).catch(() => {});

    res.json({ status: 'APPROVED', org: { id: org.id, name: org.name, slug: org.slug } });
  } catch (err) { next(err); }
}

/** POST /auth/login */
export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const data = LoginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email: data.email },
      include: { org: { select: { id: true, name: true, slug: true } } },
    });
    if (!user || !user.isActive) throw new AppError(401, 'Invalid credentials');
    const valid = await bcrypt.compare(data.password, user.passwordHash);
    if (!valid) throw new AppError(401, 'Invalid credentials');

    // 2FA gate — previously verifyTotpLogin() was implemented but never
    // invoked here, so enabling 2FA had no effect on the login flow at all.
    // If the account has TOTP enabled, require a valid code (or backup code)
    // before issuing any tokens. A password-only request from a 2FA-enabled
    // account gets a `requires2FA` flag back instead of a 401, so the client
    // can prompt for the code and resubmit — it isn't a failed login.
    const totpRecord = await prisma.tOTPSecret.findUnique({
      where: { userId: user.id },
      select: { enabled: true },
    });
    if (totpRecord?.enabled) {
      if (!data.totpToken) {
        return res.json({ requires2FA: true });
      }
      const totpValid = await verifyTotpLogin(user.id, data.totpToken);
      if (!totpValid) throw new AppError(401, 'Invalid or expired 2FA code');
    }

    const orgId = user.orgId ?? '';
    const rawRefresh = generateRefreshToken();
    await storeRefreshToken(user.id, rawRefresh);

    const access = signAccessToken({ id: user.id, role: user.role, email: user.email, orgId });
    logAction(user.id, 'LOGIN', 'User', user.id, { email: user.email });
    res.json({ user: userPayload(user, user.org), access, refresh: rawRefresh });
  } catch (err) { next(err); }
}

/**
 * POST /auth/demo-login — public, no credentials required. Logs in as the
 * fixed showcase account (see utils/seedDemoData.ts) so a "Try Demo" button
 * on the public demo landing page can drop a visitor straight into a
 * populated workspace. Deliberately narrow: this only ever authenticates
 * that one hardcoded account — it cannot be used to log into anything else,
 * and skips the password/2FA checks entirely since there's no credential
 * being supplied by the caller in the first place.
 */
export async function demoLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const requested = String(req.query.vertical || '');
    const vertical = DEMO_VERTICAL_SLUGS.includes(requested) ? requested : DEFAULT_VERTICAL;
    const loginEmail = vertical === DEFAULT_VERTICAL ? demoLoginEmail() : loginEmailFor(vertical);
    const user = await prisma.user.findUnique({
      where: { email: loginEmail },
      include: { org: { select: { id: true, name: true, slug: true } } },
    });
    if (!user || !user.isActive) {
      // "Try again shortly" is only honest if waiting could actually help. A
      // missing demo user means the seed has not run — waiting changes nothing,
      // so say what does. GET /demo/status reports which verticals exist.
      throw new AppError(
        503,
        `The "${vertical}" demo has not been set up on this server yet. Run \`npm run db:seed\` in the server directory to create it.`
      );
    }

    const orgId = user.orgId ?? '';
    const rawRefresh = generateRefreshToken();
    await storeRefreshToken(user.id, rawRefresh);

    const access = signAccessToken({ id: user.id, role: user.role, email: user.email, orgId });
    logAction(user.id, 'LOGIN', 'User', user.id, { email: user.email, demo: true });
    res.json({ user: userPayload(user, user.org), access, refresh: rawRefresh });
  } catch (err) { next(err); }
}

/** POST /auth/accept-invite — invited user sets name + password */
export async function acceptInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const data = AcceptInviteSchema.parse(req.body);

    const invite = await prisma.inviteToken.findUnique({
      where: { token: data.token },
      include: { org: { select: { id: true, name: true, slug: true } } },
    });
    if (!invite) throw new AppError(404, 'Invite not found');
    if (invite.usedAt) throw new AppError(400, 'Invite already used');
    if (invite.expiresAt < new Date()) throw new AppError(400, 'Invite expired');

    const existing = await prisma.user.findUnique({ where: { email: invite.email } });
    if (existing) throw new AppError(409, 'Email already registered');

    // Re-check the seat limit here too — seats can fill up in the gap between
    // an invite being sent and it being accepted (e.g. several invites sent
    // concurrently, or the org's plan got downgraded in the meantime).
    await assertSeatAvailable(invite.orgId, invite.role);

    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const u = await tx.user.create({
        data: {
          name: data.name,
          email: invite.email,
          passwordHash,
          role: invite.role,
          // Carries a custom role through the invite. Without this the new
          // user would land on `invite.role`'s enum value only — so someone
          // invited as "Regional Sales Head" would silently become whatever
          // base access level that role maps to, and lose every permission
          // the custom role actually grants.
          roleId: invite.roleId ?? undefined,
          orgId: invite.orgId,
        },
        select: { id: true, name: true, email: true, role: true, orgId: true, avatarUrl: true },
      });
      await tx.inviteToken.update({ where: { id: invite.id }, data: { usedAt: new Date() } });
      return u;
    });

    // Accepting an invite is the most common way a person joins — provisioning
    // here is what makes HR → Employees correct without anyone re-typing them.
    await ensureEmployeeForUser(user.id);

    const rawRefresh = generateRefreshToken();
    await storeRefreshToken(user.id, rawRefresh);

    const access = signAccessToken({ id: user.id, role: user.role, email: user.email, orgId: invite.orgId });
    res.status(201).json({ user: userPayload(user, invite.org), access, refresh: rawRefresh });
  } catch (err) { next(err); }
}

/** GET /auth/invite-info?token=... — validate invite before the accept page renders */
export async function inviteInfo(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.query.token as string;
    if (!token) throw new AppError(400, 'Token required');
    const invite = await prisma.inviteToken.findUnique({
      where: { token },
      include: { org: { select: { name: true } } },
    });
    if (!invite) throw new AppError(404, 'Invite not found');
    if (invite.usedAt) throw new AppError(400, 'Invite already used');
    if (invite.expiresAt < new Date()) throw new AppError(400, 'Invite expired');
    res.json({ email: invite.email, orgName: invite.org.name, role: invite.role });
  } catch (err) { next(err); }
}

/** POST /auth/refresh — validate stored token, issue new pair (rotation) */
export async function refreshToken(req: Request, res: Response, next: NextFunction) {
  try {
    const { refresh } = req.body;
    if (!refresh) throw new AppError(400, 'Refresh token required');

    const tokenHash = hashToken(refresh);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored) throw new AppError(401, 'Invalid refresh token');
    if (stored.expiresAt < new Date()) {
      await prisma.refreshToken.delete({ where: { id: stored.id } });
      throw new AppError(401, 'Refresh token expired');
    }

    const user = await prisma.user.findUnique({
      where: { id: stored.userId },
      include: { org: { select: { id: true, name: true, slug: true } } },
    });
    if (!user || !user.isActive) throw new AppError(401, 'User not found or inactive');

    // Rotate: delete old token, issue new pair (deleteMany avoids P2025 on race conditions)
    await prisma.refreshToken.deleteMany({ where: { id: stored.id } });
    const rawRefresh = generateRefreshToken();
    await storeRefreshToken(user.id, rawRefresh);

    const orgId = user.orgId ?? '';
    const access = signAccessToken({ id: user.id, role: user.role, email: user.email, orgId });
    res.json({ access, refresh: rawRefresh });
  } catch (err) { next(err); }
}

/** POST /auth/logout — revoke refresh token */
export async function logout(req: Request, res: Response) {
  const { refresh } = req.body;
  if (refresh) {
    const tokenHash = hashToken(refresh);
    await prisma.refreshToken.deleteMany({ where: { tokenHash } }).catch(() => {});
  }
  res.json({ message: 'Logged out' });
}

/** GET /auth/me */
export async function me(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true, name: true, email: true, role: true, orgId: true,
        department: true, avatarUrl: true, createdAt: true,
        org: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!user) throw new AppError(404, 'User not found');
    res.json(user);
  } catch (err) { next(err); }
}

// Same round-trip hazard as the admin Update schema above: department and
// avatarUrl are both String? on User, so a profile that has never set them
// sends null back on save.
const UpdateProfileSchema = z.object({
  name:       z.string().min(2).optional(),
  email:      emailField().optional(),
  department: optionalText(),
  avatarUrl:  optionalField(z.string().url()),
});

/** PUT /auth/me — update own profile */
export async function updateMe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const body = UpdateProfileSchema.parse(req.body);
    if (body.email) {
      const existing = await prisma.user.findFirst({
        where: { email: body.email, NOT: { id: req.user!.id } },
      });
      if (existing) throw new AppError(409, 'Email already in use');
    }
    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: body,
      select: {
        id: true, name: true, email: true, role: true, orgId: true,
        department: true, avatarUrl: true, createdAt: true,
        org: { select: { id: true, name: true, slug: true } },
      },
    });
    logAction(req.user!.id, 'UPDATE', 'User', req.user!.id);
    res.json(updated);
  } catch (err) { next(err); }
}

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword:     z.string().min(8),
});

/** PUT /auth/me/password — change own password */
export async function changePassword(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { currentPassword, newPassword } = ChangePasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new AppError(404, 'User not found');
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new AppError(400, 'Current password is incorrect');
    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user!.id }, data: { passwordHash: hash } });
    // Revoke all refresh tokens so other sessions are invalidated
    await prisma.refreshToken.deleteMany({ where: { userId: req.user!.id } });
    logAction(req.user!.id, 'UPDATE', 'User', req.user!.id, { action: 'password_change' });
    sendMail({ ...emailTemplates.passwordChanged(user.email, user.name), orgId: user.orgId ?? undefined }).catch(() => {});
    res.json({ message: 'Password changed successfully' });
  } catch (err) { next(err); }
}

// ─── Forgot / Reset Password ────────────────────────────────────────────────

/**
 * POST /auth/forgot-password — public. Always returns the same generic
 * success message whether or not the email exists (same email-enumeration
 * protection as the customer portal's request-access flow), and only
 * proceeds to actually send an email for an active, password-based account
 * (a Google-only account with no usable password still gets the generic
 * response, since telling the caller "use Google instead" would leak which
 * emails are registered).
 */
export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = ForgotPasswordSchema.parse(req.body);
    const GENERIC = { message: "If that email is registered, we've sent a password reset link." };

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) return res.json(GENERIC);

    // Invalidate any earlier outstanding reset requests for this user before
    // issuing a new one, so only the most recently requested link works.
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const rawToken = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
      },
    });

    const resetLink = `${FRONTEND_URL}/reset-password?token=${rawToken}`;
    sendMail({ ...emailTemplates.passwordReset(user.email, user.name, resetLink), orgId: user.orgId ?? undefined }).catch(() => {});

    res.json(GENERIC);
  } catch (err) { next(err); }
}

/** POST /auth/reset-password — consumes a forgot-password token, sets a new password */
export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, password } = ResetPasswordSchema.parse(req.body);
    const tokenHash = hashToken(token);
    const stored = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.usedAt) throw new AppError(400, 'Reset link is invalid or has already been used');
    if (stored.expiresAt < new Date()) throw new AppError(400, 'Reset link has expired — request a new one');

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.$transaction([
      prisma.user.update({ where: { id: stored.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
      // Revoke every existing session — a password reset is a strong signal
      // the old credential shouldn't keep working anywhere.
      prisma.refreshToken.deleteMany({ where: { userId: stored.userId } }),
    ]);

    logAction(stored.userId, 'UPDATE', 'User', stored.userId, { action: 'password_reset' });
    const user = await prisma.user.findUnique({ where: { id: stored.userId } });
    if (user) sendMail({ ...emailTemplates.passwordChanged(user.email, user.name), orgId: user.orgId ?? undefined }).catch(() => {});

    res.json({ message: 'Password reset — you can log in with your new password now.' });
  } catch (err) { next(err); }
}

// ─── Google SSO ──────────────────────────────────────────────────────────────

/**
 * POST /auth/google — logs in a staff user who has already linked a Google
 * account from their Profile page (see linkGoogleAccount below). Deliberately
 * does NOT create new users or organizations — SSO is an alternate login
 * method for an existing account, not a second signup path, so it can't be
 * used to route around the admin-approval-gated org creation flow.
 */
export async function googleLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const { idToken } = GoogleLoginSchema.parse(req.body);
    const claims = await verifyGoogleIdToken(idToken).catch((e: Error) => { throw new AppError(401, e.message); });

    const user = await prisma.user.findUnique({
      where: { googleId: claims.sub },
      include: { org: { select: { id: true, name: true, slug: true } } },
    });
    if (!user || !user.isActive) {
      throw new AppError(404, 'No account is linked to this Google account yet. Log in with your password and link Google from your Profile page first.');
    }

    const orgId = user.orgId ?? '';
    const rawRefresh = generateRefreshToken();
    await storeRefreshToken(user.id, rawRefresh);

    const access = signAccessToken({ id: user.id, role: user.role, email: user.email, orgId });
    logAction(user.id, 'LOGIN', 'User', user.id, { email: user.email, method: 'google' });
    res.json({ user: userPayload(user, user.org), access, refresh: rawRefresh });
  } catch (err) { next(err); }
}

/** GET /auth/google/status — whether Google SSO is configured + whether the caller has linked it */
export async function googleStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { googleId: true } });
    res.json({ configured: isGoogleSsoConfigured(), linked: !!user?.googleId, clientId: process.env.GOOGLE_CLIENT_ID || null });
  } catch (err) { next(err); }
}

/** POST /auth/google/link — authenticated user links their Google account for future SSO login */
export async function linkGoogleAccount(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { idToken } = GoogleLoginSchema.parse(req.body);
    const claims = await verifyGoogleIdToken(idToken).catch((e: Error) => { throw new AppError(401, e.message); });

    const existing = await prisma.user.findUnique({ where: { googleId: claims.sub } });
    if (existing && existing.id !== req.user!.id) {
      throw new AppError(409, 'This Google account is already linked to a different user');
    }
    if (claims.email.toLowerCase() !== req.user!.email.toLowerCase()) {
      throw new AppError(400, `This Google account's email (${claims.email}) doesn't match your account email (${req.user!.email})`);
    }

    await prisma.user.update({ where: { id: req.user!.id }, data: { googleId: claims.sub } });
    logAction(req.user!.id, 'UPDATE', 'User', req.user!.id, { action: 'google_linked' });
    res.json({ linked: true });
  } catch (err) { next(err); }
}

/** DELETE /auth/google/link — unlink Google, falling back to password-only login */
export async function unlinkGoogleAccount(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.user.update({ where: { id: req.user!.id }, data: { googleId: null } });
    logAction(req.user!.id, 'UPDATE', 'User', req.user!.id, { action: 'google_unlinked' });
    res.json({ linked: false });
  } catch (err) { next(err); }
}

// ─── Microsoft Entra ID SSO ──────────────────────────────────────────────────
//
// Phase 1: SSO login only, for an existing (already invited/created) user —
// same "alternate login method for an existing account" boundary as Google
// above, not a second signup path. Org resolution happens via a per-org
// login URL (DirectoryConfig.loginSlug, e.g. /login/acme) rather than a
// shared login page, since — unlike Google — each org configures its own
// Entra tenant, so we have to know which org before redirecting to Microsoft.
//
// The OAuth round trip carries state the same way modules/calendar's Google
// Calendar connection flow does: a short-lived JWT signed with JWT_SECRET
// (see calendar.controller.ts getOAuthUrl/oauthCallback), not a DB row or
// cookie — Microsoft's redirect back to /callback has no session of its own,
// so this is how we know which org's config to use when it lands.

/** GET /auth/entra/:slug/login — public; redirects to the org's Microsoft sign-in */
export async function entraLoginRedirect(req: Request, res: Response) {
  try {
    const config = await prisma.directoryConfig.findUnique({ where: { loginSlug: req.params.slug } });
    if (!config) return res.redirect(`${FRONTEND_URL}/login?error=sso_not_found`);
    if (!config.isEnabled) return res.redirect(`${FRONTEND_URL}/login?error=sso_disabled`);

    const state = jwt.sign({ orgId: config.orgId }, process.env.JWT_SECRET!, { expiresIn: '10m' });
    res.redirect(buildEntraAuthUrl({ tenantId: config.tenantId, clientId: config.clientId, state }));
  } catch (err) {
    console.error('[entra] login redirect failed:', err);
    res.redirect(`${FRONTEND_URL}/login?error=sso_error`);
  }
}

/** GET /auth/entra/callback — public; Microsoft redirects the browser here after sign-in */
export async function entraCallback(req: Request, res: Response) {
  const fail = (reason: string) => res.redirect(`${FRONTEND_URL}/sso-callback#error=${encodeURIComponent(reason)}`);
  try {
    const { code, state, error, error_description } = req.query as Record<string, string>;
    if (error) return fail(error_description || error);
    if (!code || !state) return fail('Missing sign-in response from Microsoft.');

    let orgId: string;
    try {
      ({ orgId } = jwt.verify(state, process.env.JWT_SECRET!) as { orgId: string });
    } catch {
      return fail('Your sign-in link expired — please try again.');
    }

    const config = await prisma.directoryConfig.findUnique({ where: { orgId } });
    if (!config || !config.isEnabled) return fail('Single sign-on is not available for this organization.');

    const { accessToken } = await exchangeEntraCode({
      tenantId: config.tenantId, clientId: config.clientId,
      clientSecret: decryptSecret(config.clientSecretEnc), code,
    }).catch((e: Error) => { throw new AppError(401, e.message); });

    const profile = await fetchEntraProfile(accessToken);
    const email = (profile.mail || profile.userPrincipalName || '').toLowerCase();

    let user = await prisma.user.findFirst({
      where: { entraObjectId: profile.id, orgId },
      include: { org: { select: { id: true, name: true, slug: true } } },
    });

    // First SSO login for this person — link by matching email within the
    // same org instead of creating a new account (phase 1 has no
    // auto-provisioning; see entraObjectId's schema comment).
    if (!user && email) {
      const byEmail = await prisma.user.findFirst({
        where: { email, orgId },
        include: { org: { select: { id: true, name: true, slug: true } } },
      });
      if (byEmail) {
        user = await prisma.user.update({
          where: { id: byEmail.id },
          data: { entraObjectId: profile.id },
          include: { org: { select: { id: true, name: true, slug: true } } },
        });
      }
    }

    // Phase 2: still no match — create an account if the org has opted into
    // auto-provisioning, using group membership to pick a role (falling back
    // to the org's default role). Off by default; see DirectoryConfig's
    // schema comment.
    if (!user && config.autoProvisioningEnabled) {
      if (!email) return fail('Microsoft did not provide an email address for your account.');

      const groupIds = await fetchEntraGroups(accessToken).catch(() => [] as string[]);
      const role = await resolveRoleForGroups(orgId, groupIds, config.defaultRole);

      try {
        await assertSeatAvailable(orgId, role);
      } catch {
        return fail('Your organization has reached its user limit. Contact your admin.');
      }

      // Directory-provisioned accounts never use a password — a random,
      // never-surfaced hash keeps User.passwordHash satisfied (it's a
      // required column) without anyone being able to guess or brute-force
      // their way in through the password form. If password login is ever
      // wanted for this account, the existing "forgot password" flow works
      // regardless of how the account was created.
      const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
      user = await prisma.user.create({
        data: {
          name: profile.displayName, email, passwordHash, role, orgId,
          entraObjectId: profile.id, provisionedVia: 'DIRECTORY',
        },
        include: { org: { select: { id: true, name: true, slug: true } } },
      });
      logAction(user.id, 'CREATE', 'User', user.id, { method: 'entra_jit', role });
      // Directory-provisioned staff are still staff.
      await ensureEmployeeForUser(user.id);
    }

    if (!user) return fail('No CRMITdesk account was found for you. Ask your admin to invite you first.');
    if (!user.isActive) return fail('Your account is deactivated. Contact your admin.');

    const rawRefresh = generateRefreshToken();
    await storeRefreshToken(user.id, rawRefresh);
    const access = signAccessToken({ id: user.id, role: user.role, email: user.email, orgId: user.orgId ?? '' });
    logAction(user.id, 'LOGIN', 'User', user.id, { email: user.email, method: 'entra' });

    res.redirect(`${FRONTEND_URL}/sso-callback#access=${encodeURIComponent(access)}&refresh=${encodeURIComponent(rawRefresh)}`);
  } catch (err: any) {
    console.error('[entra] callback failed:', err);
    fail(err?.message || 'Sign-in failed — please try again.');
  }
}
