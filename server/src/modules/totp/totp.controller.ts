import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { generateSecret, verifyTOTP, otpAuthUri, generateBackupCodes } from '../../utils/totp';

// ─── Setup: generate secret + QR URI ─────────────────────────────────────────

export async function setupTotp(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) throw new AppError(404, 'User not found');

    // Check if already enabled
    const existing = await prisma.tOTPSecret.findUnique({ where: { userId } });
    if (existing?.enabled) throw new AppError(400, '2FA is already enabled');

    const secret = generateSecret();
    await prisma.tOTPSecret.upsert({
      where: { userId },
      create: { userId, secret, enabled: false, backupCodes: [] },
      update: { secret, enabled: false },
    });

    const uri = otpAuthUri(secret, user.email);
    res.json({ secret, uri, message: 'Scan the QR code with your authenticator app, then verify.' });
  } catch (err) { next(err); }
}

// ─── Verify + enable ──────────────────────────────────────────────────────────

export async function enableTotp(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { token } = z.object({ token: z.string().length(6) }).parse(req.body);

    const record = await prisma.tOTPSecret.findUnique({ where: { userId } });
    if (!record) throw new AppError(400, 'Run setup first');
    if (record.enabled) throw new AppError(400, '2FA already enabled');

    if (!verifyTOTP(record.secret, token)) throw new AppError(400, 'Invalid code');

    const backupCodes = generateBackupCodes(8);
    await prisma.tOTPSecret.update({
      where: { userId },
      data: { enabled: true, backupCodes },
    });

    res.json({ message: '2FA enabled', backupCodes });
  } catch (err) { next(err); }
}

// ─── Disable ──────────────────────────────────────────────────────────────────

export async function disableTotp(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { token } = z.object({ token: z.string().length(6) }).parse(req.body);

    const record = await prisma.tOTPSecret.findUnique({ where: { userId } });
    if (!record?.enabled) throw new AppError(400, '2FA is not enabled');
    if (!verifyTOTP(record.secret, token)) throw new AppError(400, 'Invalid code');

    await prisma.tOTPSecret.delete({ where: { userId } });
    res.json({ message: '2FA disabled' });
  } catch (err) { next(err); }
}

// ─── Status ───────────────────────────────────────────────────────────────────

export async function getStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const record = await prisma.tOTPSecret.findUnique({
      where: { userId: req.user!.id },
      select: { enabled: true, createdAt: true },
    });
    res.json({ enabled: record?.enabled ?? false, setupAt: record?.createdAt ?? null });
  } catch (err) { next(err); }
}

// ─── Verify during login (called from auth controller) ───────────────────────

export async function verifyTotpLogin(userId: string, token: string): Promise<boolean> {
  const record = await prisma.tOTPSecret.findUnique({ where: { userId } });
  if (!record?.enabled) return true; // 2FA not enabled, allow through
  if (verifyTOTP(record.secret, token)) return true;
  // Check backup codes
  if (record.backupCodes.includes(token.toUpperCase())) {
    // Consume the backup code
    await prisma.tOTPSecret.update({
      where: { userId },
      data: { backupCodes: record.backupCodes.filter(c => c !== token.toUpperCase()) },
    });
    return true;
  }
  return false;
}
