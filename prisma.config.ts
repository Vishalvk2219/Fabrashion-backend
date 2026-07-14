// Replaces the deprecated `package.json#prisma` block (removed in Prisma 7).
// Note: when a Prisma config file is present, Prisma no longer auto-loads .env,
// so we load it here — the CLI reads DATABASE_URL from process.env.
import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
