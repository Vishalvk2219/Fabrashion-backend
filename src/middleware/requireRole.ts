import type { RequestHandler } from 'express';
import type { UserRole } from '@prisma/client';

import { ForbiddenError, UnauthorizedError } from '@/lib/errors';

/**
 * RBAC guard. Use after `authenticate`. Allows the request only if
 * `req.user.role` is one of `roles`, else 403.
 */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) throw new UnauthorizedError();
    if (!roles.includes(req.user.role)) throw new ForbiddenError();
    next();
  };
}
