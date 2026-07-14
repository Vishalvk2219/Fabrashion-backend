import { Router } from 'express';
import helmet from 'helmet';
import { stringify } from 'yaml';

import { getOpenApiDocument } from '@/docs/openapi';

export const docsRouter = Router();

const SPEC_CDN = 'https://cdn.jsdelivr.net';

/**
 * The API reference UI is the one page that must pull a script from a CDN, so
 * it gets its own relaxed CSP — scoped to this route only, leaving helmet's
 * strict default policy in force for the rest of the API.
 */
const docsCsp = helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", SPEC_CDN],
    styleSrc: ["'self'", "'unsafe-inline'", SPEC_CDN],
    fontSrc: ["'self'", SPEC_CDN, 'data:'],
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: ["'self'"],
    workerSrc: ["'self'", 'blob:'],
  },
});

/** Machine-readable spec. Import this URL into Apidog/Postman, or generate a client from it. */
docsRouter.get('/openapi.json', (_req, res) => {
  res.type('application/json').send(JSON.stringify(getOpenApiDocument(), null, 2));
});

docsRouter.get('/openapi.yaml', (_req, res) => {
  res.type('text/yaml').send(stringify(getOpenApiDocument()));
});

/** Human-readable reference, rendered client-side from the JSON above. */
docsRouter.get('/', docsCsp, (_req, res) => {
  res.type('html').send(`<!doctype html>
<html>
  <head>
    <title>Fabrashion API — Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script id="api-reference" data-url="/docs/openapi.json"></script>
    <script src="${SPEC_CDN}/npm/@scalar/api-reference"></script>
  </body>
</html>`);
});
