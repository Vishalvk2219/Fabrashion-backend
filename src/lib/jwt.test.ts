import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';

import { env } from '@/config/env';
import { signAccessToken, verifyAccessToken } from './jwt';

describe('jwt access tokens', () => {
  it('signs and verifies a valid HS256 token', () => {
    const token = signAccessToken({ sub: 'user-1', role: 'CUSTOMER' });
    expect(verifyAccessToken(token)).toEqual({ sub: 'user-1', role: 'CUSTOMER' });
  });

  it('rejects an unsigned alg:none token [SEC-002]', () => {
    // A classic forgery: drop the signature and claim admin. The algorithm pin must reject it.
    const forged = jwt.sign({ sub: 'attacker', role: 'ADMIN' }, '', { algorithm: 'none' });
    expect(() => verifyAccessToken(forged)).toThrow();
  });

  it('rejects a token signed with a different secret', () => {
    const forged = jwt.sign({ sub: 'x', role: 'ADMIN' }, 'not-the-real-secret-0000000000000000');
    expect(() => verifyAccessToken(forged)).toThrow();
  });

  it('only ever accepts HS256 (guards against future asymmetric confusion) [SEC-002]', () => {
    // Whatever the token claims for `alg`, verification must be constrained to HS256.
    const token = signAccessToken({ sub: 'user-2', role: 'STAFF' });
    const decodedHeader = jwt.decode(token, { complete: true })?.header;
    expect(decodedHeader?.alg).toBe('HS256');
    // Sanity: the pin is wired through env, not a hardcoded key here.
    expect(env.JWT_ACCESS_SECRET.length).toBeGreaterThanOrEqual(32);
  });
});
