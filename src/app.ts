import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from '@/config/env';
import { requestLogger } from '@/middleware/requestLogger';
import { errorHandler } from '@/middleware/errorHandler';
import { notFound } from '@/middleware/notFound';
import { apiRouter } from '@/routes';
import { healthRouter } from '@/routes/health.route';

/**
 * Builds the Express application. Kept free of `listen()` so tests can import
 * and drive it with supertest without opening a port.
 */
export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestLogger);

  // Health at root (probes/load balancers hit /health).
  app.use('/', healthRouter);
  // Versioned API.
  app.use('/api/v1', apiRouter);

  // 404 + centralized error handling (must be last).
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
