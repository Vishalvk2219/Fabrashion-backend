import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';

import { registry } from './registry';
import './components';

// Feature modules describe themselves; importing them populates the registry.
// Add one line here per new module (catalog, cart, order, trial, sync, ...).
import '@/routes/health.openapi';
import '@/modules/auth/auth.openapi';

/**
 * Builds the OpenAPI document from the Zod schemas the API validates with.
 *
 * Targets **3.0.3** rather than 3.1: the two differ on how nullable fields are
 * expressed (`nullable: true` vs a `["string","null"]` type array), and 3.0 is
 * what the widest set of clients — Apidog, Postman, code generators — round-trip
 * without surprises. Switch `OpenApiGeneratorV3` to `OpenApiGeneratorV31` and
 * bump the version string below if that ever stops being true.
 */

/** Bump on a breaking API change; keep in step with `package.json`. */
const API_VERSION = '0.1.0';

const DESCRIPTION = `
Backend for **Fabrashion**, a premium clothing store: catalogue, cart, orders, and at-home trials.
This spec is generated from the Zod schemas the server validates against, so it always matches the running code.

## Authentication
Everything except \`/health\` and the auth entry points expects a bearer token:

1. \`POST /api/v1/auth/otp/request\` with a phone number, then \`POST /api/v1/auth/otp/verify\` with the code → returns \`{ user, accessToken, refreshToken }\`. Phone-OTP is the only login method; first verify creates the account.
2. Send \`Authorization: Bearer <accessToken>\` on subsequent calls.
3. The access token lasts **15 minutes**. On a 401, call \`POST /api/v1/auth/refresh\` with your refresh token and retry.

Refresh tokens are **single-use and rotated**: each refresh returns a new one and kills the old. Persist the new pair every time, and never run two refreshes concurrently — replaying a rotated token is read as theft and signs the user out of every device.

## Errors
Every failure uses one envelope — see the \`Error\` schema:

\`\`\`json
{ "error": { "code": "UNAUTHORIZED", "message": "Invalid email or password" } }
\`\`\`

Branch on \`error.code\` (stable), never on \`message\` (copy, may change). A 422 adds \`details.fieldErrors\`, mapping each rejected field to its messages — render those inline on the form.

## Conventions
- **Money** is always an integer count of **paise** (₹1 = 100 paise), in fields suffixed \`Paise\`. Never floats.
- **Timestamps** are UTC ISO-8601 strings.
- **Ids** are UUIDs.
- **Phone numbers** are submitted as 10 digits and stored E.164 (\`+91XXXXXXXXXX\`).
- Every response carries an **\`x-request-id\`**; send your own to correlate, and quote it in bug reports.

## Rate limits
The \`/auth/*\` endpoints allow **30 requests per 15 minutes per IP**. Over that you get a 429 with \`Retry-After\`.
`.trim();

/** The generated document's type, taken from the generator so we own no OpenAPI typings. */
export type OpenApiDocument = ReturnType<OpenApiGeneratorV3['generateDocument']>;

let cached: OpenApiDocument | undefined;

/** The generated OpenAPI 3.0.3 document. Built once, then memoised. */
export function getOpenApiDocument(): OpenApiDocument {
  cached ??= new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Fabrashion API',
      version: API_VERSION,
      description: DESCRIPTION,
      contact: { name: 'Fabrashion Engineering', email: 'support@teachtotech.in' },
    },
    // Add staging/production entries here once the API is deployed; clients
    // (Apidog, Postman) turn each one into a switchable environment.
    servers: [{ url: 'http://localhost:4000', description: 'Local development' }],
    tags: [
      { name: 'Auth', description: 'Registration, sign-in, token rotation, and the current user.' },
      { name: 'System', description: 'Probes and service metadata. No authentication required.' },
    ],
  });
  return cached;
}
