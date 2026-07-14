# fabrashion-backend

Premium-clothing e-commerce API — **Express 5 + TypeScript + Prisma + PostgreSQL + Redis**.

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
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Create/apply a dev migration |
| `npm run db:seed` | Seed sample data + dev user passwords |
| `npm run db:studio` | Open Prisma Studio |
| `npm run docker:up` / `docker:down` | Start/stop Postgres + Redis |

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
├── lib/                # errors, logger, money, jwt, password, tokens
├── modules/
│   └── auth/           # register/login/refresh/logout/me (route→controller→service→repository)
├── routes/             # health.route, api v1 index (mounts /auth)
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
