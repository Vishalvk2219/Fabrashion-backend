import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';

type Source = 'body' | 'query' | 'params';

/**
 * Validate a request part against a Zod schema, replacing it with the parsed
 * (coerced) value. On failure the `ZodError` is forwarded to the central
 * `errorHandler`, which maps it to a 422 `VALIDATION_ERROR`.
 *
 * Note: Express 5 makes `req.query`/`req.params` getter-only, so those are
 * mutated in place; `req.body` is reassigned.
 */
export function validate(schema: ZodTypeAny, source: Source = 'body'): RequestHandler {
  return (req, _res, next) => {
    const target = source === 'body' ? req.body : source === 'query' ? req.query : req.params;
    const result = schema.safeParse(target);
    if (!result.success) {
      next(result.error);
      return;
    }
    if (source === 'body') {
      req.body = result.data;
    } else {
      Object.assign(target as object, result.data);
    }
    next();
  };
}
