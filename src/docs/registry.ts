import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

/**
 * The single OpenAPI registry every module writes into.
 *
 * It lives in its own module (rather than in `openapi.ts`) so that feature
 * modules can register their routes without importing the document builder —
 * which would create an import cycle, since the builder imports the modules.
 *
 * A feature module documents itself in `<module>.openapi.ts` and is wired up by
 * `openapi.ts`; see `modules/auth/auth.openapi.ts` for the pattern to copy.
 */
export const registry = new OpenAPIRegistry();

/**
 * Mount prefix of the versioned API. Paths are registered in full (e.g.
 * `/api/v1/auth/login`) rather than relative to a base URL, because `/health`
 * lives outside the prefix — so the `servers` entry is the bare origin and
 * every path in the spec is exactly what you call.
 */
export const API_V1 = '/api/v1';

/**
 * Bearer-JWT scheme, referenced by any route that requires authentication:
 *   `security: [{ [bearerAuth.name]: [] }]`
 */
export const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description:
    'Short-lived (15 min) access token from `POST /auth/login`, sent as `Authorization: Bearer <accessToken>`. ' +
    'When it expires the API returns 401 UNAUTHORIZED — exchange the refresh token at `POST /auth/refresh` for a new pair.',
});
