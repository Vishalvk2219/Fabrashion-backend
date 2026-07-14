import { randomInt } from 'node:crypto';

import type { User } from '@prisma/client';

import { env } from '@/config/env';
import { BadRequestError, UnauthorizedError } from '@/lib/errors';
import { signAccessToken } from '@/lib/jwt';
import { logger } from '@/lib/logger';
import { generateRefreshToken, hashToken } from '@/lib/tokens';
import { type AuthResponseDTO, type AuthUserDTO, toAuthUser } from './auth.mapper';
import { authRepository } from './auth.repository';

const REFRESH_TTL_MS = env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000;
const OTP_TTL_MS = env.OTP_TTL_MINUTES * 60 * 1000;

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface OtpRequestResult {
  /** Seconds until the code expires. */
  expiresInSec: number;
  /** The code itself — dev/test only (never sent in production). */
  devCode?: string;
}

/** Normalize a 10-digit Indian mobile to E.164 (+91XXXXXXXXXX). */
const toE164 = (phone: string): string => `+91${phone}`;
/** Codes are stored hashed and salted by phone so a DB leak can't be replayed. */
const hashOtp = (phone: string, code: string): string => hashToken(`${phone}:${code}`);

/** Sign an access token and persist a fresh (hashed) refresh token. */
async function issueTokens(user: User): Promise<TokenPair> {
  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  const refreshToken = generateRefreshToken();
  await authRepository.createRefreshToken(
    user.id,
    hashToken(refreshToken),
    new Date(Date.now() + REFRESH_TTL_MS),
  );
  return { accessToken, refreshToken };
}

export const authService = {
  /**
   * Step 1: create + "send" a login OTP for a phone. In dev/test the code is logged and (if
   * OTP_EXPOSE_CODE) returned so the flow works without an SMS provider. Prod sends via SMS (MSG91).
   */
  async requestOtp(phoneRaw: string): Promise<OtpRequestResult> {
    const phone = toE164(phoneRaw);

    // Resend cooldown (in addition to the route's rate limiter). Skipped under test
    // like the rate limiters: parallel suites sign seeded phones in back-to-back.
    const last = env.isTest ? null : await authRepository.findLatestOtpChallenge(phone);
    if (last) {
      const since = (Date.now() - last.createdAt.getTime()) / 1000;
      if (since < env.OTP_RESEND_COOLDOWN_SECONDS) {
        throw new BadRequestError(
          `Please wait ${Math.ceil(env.OTP_RESEND_COOLDOWN_SECONDS - since)}s before requesting a new code`,
        );
      }
    }

    const code = String(randomInt(1000, 10000)); // 4 digits, 1000–9999
    await authRepository.createOtpChallenge(phone, hashOtp(phone, code), new Date(Date.now() + OTP_TTL_MS));

    // Send via SMS (MSG91) in prod — TODO(4c). The code is logged ONLY outside production so the
    // dev flow is walkable without an SMS provider; a plaintext OTP in production logs is an
    // account-takeover vector (login is phone-OTP only), so it must never reach prod logs. [SEC-001]
    if (!env.isProd) logger.info({ phone }, `OTP for ${phone}: ${code}`);

    return {
      expiresInSec: env.OTP_TTL_MINUTES * 60,
      ...(env.exposeOtpCode ? { devCode: code } : {}),
    };
  },

  /**
   * Step 2: verify the code and sign in. First-time phones get a CUSTOMER account; seeded
   * ADMIN/STAFF phones return their stored role, which drives the app shell.
   */
  async verifyOtp(phoneRaw: string, code: string): Promise<AuthResponseDTO> {
    const phone = toE164(phoneRaw);
    const challenge = await authRepository.findActiveOtpChallenge(phone);
    if (!challenge) throw new BadRequestError('Code expired or not found. Request a new one.');

    if (challenge.attempts >= env.OTP_MAX_ATTEMPTS) {
      throw new BadRequestError('Too many attempts. Request a new code.');
    }

    if (challenge.codeHash !== hashOtp(phone, code)) {
      await authRepository.incrementOtpAttempts(challenge.id);
      throw new UnauthorizedError('Incorrect code');
    }

    await authRepository.consumeOtpChallenge(challenge.id);

    // Find or create the account for this phone. New = self-signup customer.
    let user =
      (await authRepository.findUserByPhone(phone)) ??
      (await authRepository.createUser({
        phone,
        fullName: 'ANDRÓ Member',
        phoneVerified: true,
      }));
    // Admin-invited accounts start unverified; passing the OTP is the verification
    // (also flips the admin directory's "Invited" → "Active").
    if (!user.phoneVerified) user = await authRepository.markPhoneVerified(user.id);

    return { user: toAuthUser(user), ...(await issueTokens(user)) };
  },

  async refresh(refreshToken: string): Promise<TokenPair> {
    const record = await authRepository.findRefreshTokenByHash(hashToken(refreshToken));
    if (!record || record.expiresAt < new Date()) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }
    if (record.revokedAt) {
      // A rotated token is being replayed → probable theft; revoke the whole family.
      await authRepository.revokeAllForUser(record.userId);
      throw new UnauthorizedError('Refresh token has been revoked');
    }

    const user = await authRepository.findUserById(record.userId);
    if (!user) throw new UnauthorizedError('Invalid refresh token');

    await authRepository.revokeRefreshToken(record.id); // rotate
    return issueTokens(user);
  },

  async logout(refreshToken: string): Promise<void> {
    const record = await authRepository.findRefreshTokenByHash(hashToken(refreshToken));
    if (record && !record.revokedAt) {
      await authRepository.revokeRefreshToken(record.id);
    }
  },

  async me(userId: string): Promise<AuthUserDTO> {
    const user = await authRepository.findUserById(userId);
    if (!user) throw new UnauthorizedError();
    return toAuthUser(user);
  },
};
