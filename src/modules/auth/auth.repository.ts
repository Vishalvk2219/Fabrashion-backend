import type { OtpChallenge, Prisma, RefreshToken, User } from '@prisma/client';

import { prisma } from '@/config/db';

/** Only layer that touches Prisma for auth. */
export const authRepository = {
  findUserById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },

  findUserByPhone(phone: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { phone } });
  },

  createUser(data: Prisma.UserCreateInput): Promise<User> {
    return prisma.user.create({ data });
  },

  markPhoneVerified(id: string): Promise<User> {
    return prisma.user.update({ where: { id }, data: { phoneVerified: true } });
  },

  // ── OTP challenges ──
  createOtpChallenge(phone: string, codeHash: string, expiresAt: Date): Promise<OtpChallenge> {
    return prisma.otpChallenge.create({ data: { phone, codeHash, expiresAt } });
  },

  /** Newest un-consumed, un-expired LOGIN challenge for a phone. */
  findActiveOtpChallenge(phone: string): Promise<OtpChallenge | null> {
    return prisma.otpChallenge.findFirst({
      where: { phone, purpose: 'LOGIN', consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
  },

  /** Newest challenge of any state — used to enforce the resend cooldown. */
  findLatestOtpChallenge(phone: string): Promise<OtpChallenge | null> {
    return prisma.otpChallenge.findFirst({ where: { phone }, orderBy: { createdAt: 'desc' } });
  },

  incrementOtpAttempts(id: string): Promise<OtpChallenge> {
    return prisma.otpChallenge.update({ where: { id }, data: { attempts: { increment: 1 } } });
  },

  consumeOtpChallenge(id: string): Promise<OtpChallenge> {
    return prisma.otpChallenge.update({ where: { id }, data: { consumedAt: new Date() } });
  },

  // ── Refresh tokens ──
  createRefreshToken(userId: string, tokenHash: string, expiresAt: Date): Promise<RefreshToken> {
    return prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
  },

  findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    return prisma.refreshToken.findUnique({ where: { tokenHash } });
  },

  revokeRefreshToken(id: string): Promise<RefreshToken> {
    return prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
  },

  revokeAllForUser(userId: string): Promise<Prisma.BatchPayload> {
    return prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },
};
