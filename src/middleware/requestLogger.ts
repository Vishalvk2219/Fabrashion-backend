import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { logger } from '@/lib/logger';

/**
 * HTTP request logging with a per-request id. The id is taken from an incoming
 * `x-request-id` header when present, otherwise generated, and echoed back on
 * the response. Exposes `req.log` (request-scoped, carries the id) to handlers.
 */
export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers['x-request-id'];
    const id = (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});
