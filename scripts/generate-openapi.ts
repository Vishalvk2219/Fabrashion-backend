/**
 * Writes the OpenAPI spec to `docs/openapi.{json,yaml}`.
 *
 *   npm run docs:generate
 *
 * The generated files are committed so the spec is reviewable in diffs and
 * importable without running the server. `docs/openapi.test.ts` fails if they
 * drift from the schemas, so regenerate whenever you touch the API surface.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';

import { getOpenApiDocument } from '@/docs/openapi';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const document = getOpenApiDocument();

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'openapi.json'), `${JSON.stringify(document, null, 2)}\n`, 'utf8');
await writeFile(join(outDir, 'openapi.yaml'), stringify(document), 'utf8');

const operations = Object.values(document.paths ?? {}).reduce(
  (total, path) => total + Object.keys(path as object).length,
  0,
);
console.log(
  `✅ Wrote docs/openapi.json + docs/openapi.yaml — ${operations} operations, ` +
    `${Object.keys(document.components?.schemas ?? {}).length} schemas.`,
);
