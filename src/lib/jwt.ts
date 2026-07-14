import jwt from 'jsonwebtoken';
import type { UserRole } from '@prisma/client';

import { env } from '@/config/env';

/** Claims carried in the short-lived access token. */
export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'],
  });
}

/** Verify + narrow an access token. Throws if the signature/claims are invalid. */
export function verifyAccessToken(token: string): AccessTokenPayload {
  // Pin the algorithm so a token forged with `alg:none` or an HS/RS confusion is rejected
  // regardless of jsonwebtoken's defaults. Tokens are signed HS256 (symmetric secret). [SEC-002]
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  if (typeof decoded === 'string') {
    throw new Error('Unexpected string token payload');
  }
  const { sub, role } = decoded as jwt.JwtPayload & { role?: unknown };
  if (typeof sub !== 'string' || typeof role !== 'string') {
    throw new Error('Invalid token claims');
  }
  return { sub, role: role as UserRole };
}
