import { PrismaClient } from '@prisma/client';
import { env } from '@/config/env';

/**
 * Prisma client singleton. In dev we stash it on globalThis so hot-reload
 * (tsx watch) doesn't open a new connection pool on every reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isDev ? ['warn', 'error'] : ['error'],
  });

if (!env.isProd) {
  globalForPrisma.prisma = prisma;
}
