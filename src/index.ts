import { createApp } from '@/app';
import { env } from '@/config/env';
import { logger } from '@/lib/logger';
import { prisma } from '@/config/db';
import { redis } from '@/config/redis';
import { trialService } from '@/modules/trial/trial.service';

/** How often the trial auto-return sweep runs (also runs lazily on trial reads). */
const TRIAL_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

async function main() {
  // Warm the Redis connection (non-fatal if it fails; /health reflects status,
  // and ioredis reconnects in the background once Redis is available).
  redis.connect().catch((err: Error) => {
    logger.warn({ err: err.message }, 'Initial Redis connect failed (will retry in background)');
  });

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`🚀 API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  // Trials past their keep/return window auto-return (plan 07 policy).
  const trialSweep = setInterval(() => {
    trialService
      .sweepExpiredTrials()
      .then((n) => n > 0 && logger.info({ swept: n }, 'Auto-returned expired trials'))
      .catch((err: Error) => logger.warn({ err: err.message }, 'Trial sweep failed'));
  }, TRIAL_SWEEP_INTERVAL_MS);
  trialSweep.unref();

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(async () => {
      await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
      logger.info('Shutdown complete');
      process.exit(0);
    });
    // Force-exit if graceful shutdown hangs.
    setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception — exiting');
    process.exit(1);
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error during boot');
  process.exit(1);
});
