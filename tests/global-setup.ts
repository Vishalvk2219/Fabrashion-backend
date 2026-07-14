import { execSync } from 'node:child_process';

/**
 * Seeds the database once, before the suite runs.
 *
 * The integration tests assert against the seed baseline (5 products, the Women
 * subtree, the BLR01 store, ...), so they only hold on a freshly seeded
 * database. Without this they passed on a clean DB and then failed on the next
 * run, because tests that create rows had left them behind — which made the
 * suite non-idempotent and useless as a CI gate.
 *
 * Seeding here rather than in each file keeps it to one wipe per run: `db:seed`
 * truncates every table before it inserts.
 */
export default function setup(): void {
  try {
    execSync('npm run db:seed', { stdio: 'pipe' });
  } catch (err) {
    const { stdout, stderr } = err as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      'Failed to seed the test database. Is Postgres up (`npm run docker:up`) and migrated ' +
        `(\`npm run db:migrate\`)?\n\n${stdout?.toString() ?? ''}${stderr?.toString() ?? ''}`,
    );
  }
}
