import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '@/lib/errors';

/**
 * Central error handler. Must be registered LAST. Produces the uniform shape:
 *   { error: { code, message, details? } }
 * Never leaks stack traces to clients; unknown errors are logged and 500'd.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: err.flatten(),
      },
    });
    return;
  }

  req.log.error({ err }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
    },
  });
};
