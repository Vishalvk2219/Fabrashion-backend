import type { User } from '@prisma/client';

import { env } from '@/config/env';
import { ConflictError, UnauthorizedError } from '@/lib/errors';
import { signAccessToken } from '@/lib/jwt';
import { hashPassword, verifyPassword } from '@/lib/password';
import { generateRefreshToken, hashToken } from '@/lib/tokens';
import { type AuthResponseDTO, type AuthUserDTO, toAuthUser } from './auth.mapper';
import { authRepository } from './auth.repository';
import type { LoginInput, RegisterInput } from './auth.schema';

const REFRESH_TTL_MS = env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000;

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

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
  async register(input: RegisterInput): Promise<AuthResponseDTO> {
    const phone = `+91${input.phone}`;
    const existing = await authRepository.findUserByEmailOrPhone(input.email, phone);
    if (existing) {
      throw new ConflictError('An account with this email or phone already exists');
    }
    const user = await authRepository.createUser({
      fullName: input.fullName,
      email: input.email,
      phone,
      passwordHash: await hashPassword(input.password),
    });
    return { user: toAuthUser(user), ...(await issueTokens(user)) };
  },

  async login(input: LoginInput): Promise<AuthResponseDTO> {
    const user = await authRepository.findUserByEmail(input.email);
    // Same error whether the email is unknown or the password is wrong.
    if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, input.password))) {
      throw new UnauthorizedError('Invalid email or password');
    }
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
