import { createHash, randomBytes } from 'node:crypto';

/**
 * Opaque refresh token. Returned to the client once; we persist only its hash
 * (see `hashToken`) in `RefreshToken.tokenHash`, so a DB leak can't be replayed.
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

/** SHA-256 hex of a token — the value stored and looked up in the DB. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
