import type { RequestHandler } from 'express';

import { UnauthorizedError } from '@/lib/errors';
import { verifyAccessToken } from '@/lib/jwt';

/**
 * Require a valid Bearer access token; populates `req.user = { id, role }`.
 * Throws `UnauthorizedError` (401) when the header is missing/malformed or the
 * token is invalid/expired.
 */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or malformed Authorization header');
  }

  const token = header.slice('Bearer '.length).trim();
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new UnauthorizedError('Invalid or expired access token');
  }

  req.user = { id: payload.sub, role: payload.role };
  next();
};
