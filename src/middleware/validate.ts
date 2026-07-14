import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';

type Source = 'body' | 'query' | 'params';

/**
 * Validate a request part against a Zod schema, replacing it with the parsed
 * (coerced, default-filled) value. On failure the `ZodError` is forwarded to the
 * central `errorHandler`, which maps it to a 422 `VALIDATION_ERROR`.
 *
 * Note: Express 5 makes `req.query` a getter with no setter (and returns a fresh
 * object per access), so `Object.assign` on it is lost. We redefine the property
 * with the parsed value instead, so downstream handlers read the coerced result
 * (with Zod defaults applied). `req.body` is a plain property and is reassigned.
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
      Object.defineProperty(req, source, {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
    next();
  };
}
