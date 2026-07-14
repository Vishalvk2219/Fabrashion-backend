import pino from 'pino';
import { env } from '@/config/env';

/**
 * Application logger. JSON in production; pretty-printed in development.
 * Prefer `req.log` (request-scoped, carries the request-id) inside handlers.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  // Defense-in-depth: pino-http's default request serializer logs headers. Never write the
  // Bearer token / cookies to logs. [SEC-001]
  redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], censor: '[redacted]' },
  ...(env.isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
});
