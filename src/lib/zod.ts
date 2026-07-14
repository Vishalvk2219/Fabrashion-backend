import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

/**
 * Zod, extended with `.openapi()` so a schema can carry its own documentation
 * (description, example, component name) next to its validation rules.
 *
 * Import `z` from here — not from 'zod' — in any schema that is part of the
 * public API surface. That keeps the OpenAPI spec generated from the exact
 * schemas the API validates against, so docs cannot drift from behaviour.
 *
 * `extendZodWithOpenApi` patches the Zod prototype, so it must run before any
 * `.openapi()` call; importing this module is what guarantees that.
 */
extendZodWithOpenApi(z);

export { z };
