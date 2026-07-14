# fabrashion-backend

Fabrashion — premium clothing commerce API — **Express 5 + TypeScript + Prisma + PostgreSQL + Redis**.

This is the backend repo. The mobile app lives in a separate repo (`fabrashion-mobile`).
System design and per-feature plans live in `../plans/`.

## Requirements

- **Node 22 LTS** (see `.nvmrc` guidance in the root plans; odd Node versions are unsupported)
- **Docker Desktop** (for local Postgres + Redis)
- npm

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Copy env and adjust if needed
cp .env.example .env

# 3. Start Postgres + Redis
npm run docker:up

# 4. Generate the Prisma client
npm run db:generate

# 5. Run the API (hot reload)
npm run dev
```

Then open http://localhost:4000/health — you should see:

```json
{ "status": "ok", "services": { "db": "up", "redis": "up" } }
```

> If Docker isn't running, the server still boots and `/health` reports the down
> dependency as `"down"` (status `"degraded"`) instead of crashing.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Run the API with hot reload (tsx) |
| `npm run build` | Bundle to `dist/` (tsup) |
| `npm start` | Run the built server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run format` | Prettier write |
| `npm test` | Vitest (unit + supertest) |
| `npm run docs:generate` | Regenerate `docs/openapi.{json,yaml}` from the Zod schemas |
| `npm run docs:lint` | Check the spec against OpenAPI best practice (Redocly) |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Create/apply a dev migration |
| `npm run db:seed` | Seed sample data + dev user passwords |
| `npm run db:studio` | Open Prisma Studio |
| `npm run docker:up` / `docker:down` | Start/stop Postgres + Redis |

## API documentation (OpenAPI)

The API is described by an **OpenAPI 3.0.3** spec that is **generated from the Zod schemas the
server validates with** — not hand-written. Change a schema and the docs change with it; they
cannot silently drift.

| Where | What |
| --- | --- |
| http://localhost:4000/docs | Browsable API reference (Scalar) |
| http://localhost:4000/docs/openapi.json | The spec, live from the running server |
| http://localhost:4000/docs/openapi.yaml | Same, as YAML |
| [`docs/openapi.json`](docs/openapi.json) / [`.yaml`](docs/openapi.yaml) | The committed spec — reviewable in diffs, importable without running the server |

Run `npm run docs:generate` after any change to the API surface. `src/docs/openapi.test.ts` fails
if the committed spec drifts from the schemas, so CI catches a forgotten regeneration.

### Importing into Apidog (or Postman / Insomnia)

Two options — prefer the URL, it re-syncs on its own:

1. **From URL (auto-syncing).** Start the API (`npm run dev`), then in Apidog:
   *Project Settings → Import → OpenAPI/Swagger → URL* → `http://localhost:4000/docs/openapi.json`.
   Enable **Auto-sync** and Apidog re-pulls on a schedule, so the collection tracks the code.
2. **From file.** Import `docs/openapi.json` (or the `.yaml`). No server needed.

After importing, set the Apidog environment's base URL to `http://localhost:4000` (the spec's
`servers` entry). Auth is pre-wired: `/auth/login` returns an `accessToken`, and every protected
endpoint declares the `bearerAuth` scheme — paste the token into Apidog's **Bearer Token** auth
and it is sent as `Authorization: Bearer <token>`.

### Documenting a new module

Each feature module describes itself, next to its routes:

1. Write request schemas in `<module>.schema.ts`, importing `z` from **`@/lib/zod`** (not `zod`) —
   that is the Zod instance extended with `.openapi()`.
2. Add `<module>.openapi.ts` that calls `registry.registerPath(...)` per endpoint, reusing those
   schemas for request bodies and the shared `responses.*` helpers from `@/docs/components` for
   errors. Copy [`src/modules/auth/auth.openapi.ts`](src/modules/auth/auth.openapi.ts) — it is the
   reference implementation, and it `satisfies`-checks its response schemas against the mapper's
   DTOs so an undocumented shape change fails `npm run typecheck`.
3. Import the new file in [`src/docs/openapi.ts`](src/docs/openapi.ts) (one line) and add the route
   to `EXPECTED_OPERATIONS` in `src/docs/openapi.test.ts`.
4. `npm run docs:generate && npm run docs:lint`.

> The spec targets **3.0.3**, not 3.1, because 3.0's `nullable: true` round-trips through Apidog,
> Postman, and client generators more reliably than 3.1's type-array form. Deliberate lint
> exceptions live in [`redocly.yaml`](redocly.yaml), each with its reason.

## Architecture

Layered, feature-module structure (full detail in `../plans/03-backend-structure.md`):

```
routes → controller → service → repository → Prisma → DB
```

Current layout (through Phase 1a — auth):

```
src/
├── index.ts            # boot: connect, listen, graceful shutdown
├── app.ts              # express app: middleware + routers (import for tests)
├── config/             # env (Zod-validated), db (Prisma), redis, queue (BullMQ)
├── middleware/         # requestLogger, errorHandler, notFound, validate, auth, requireRole, rateLimit
├── lib/                # errors, logger, money, jwt, password, tokens, zod (OpenAPI-extended)
├── docs/               # OpenAPI: registry, shared error responses, document builder
├── modules/
│   └── auth/           # register/login/refresh/logout/me (route→controller→service→repository→+openapi)
├── routes/             # health.route, docs.route, api v1 index (mounts /auth)
└── types/              # express Request augmentation (req.user)
```

Remaining feature modules (`catalog`, `cart`, `order`, `trial`, `sync`, ...) land in later
phases, each with its own README.

### Auth API (`/api/v1/auth`) — Phase 1a
`POST /register`, `POST /login`, `POST /refresh`, `POST /logout`, `GET /me` (Bearer).
JWT access (15m) + opaque rotated refresh (hashed at rest, reuse-detected); argon2id passwords;
rate-limited. Full contract in `src/modules/auth/README.md`.

**Dev login** (from seed): `customer@shop.test` / `admin@shop.test` / `staff@shop.test`, password `Password123!`.

## Conventions

- **Money** is integer **paise** everywhere (see `src/lib/money.ts`).
- **Env** is read only via `src/config/env.ts` (validated once at boot).
- **Errors** are thrown as typed `AppError`s (`src/lib/errors.ts`) and formatted once by the
  central error handler into `{ error: { code, message, details? } }`.
- **Every request** carries an `x-request-id` (generated or propagated) for tracing.
