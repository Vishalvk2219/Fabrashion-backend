# Module: `auth`

Identity + session for the platform. Email/password login (Phase 1a); phone-OTP is Phase 1b.

## Endpoints (`/api/v1/auth`)
| Method | Path | Auth | Body | Success |
|--------|------|------|------|---------|
| POST | `/register` | — | `{ fullName, email, phone, password }` | 201 `{ user, accessToken, refreshToken }` |
| POST | `/login` | — | `{ email, password }` | 200 `{ user, accessToken, refreshToken }` |
| POST | `/refresh` | — | `{ refreshToken }` | 200 `{ accessToken, refreshToken }` (rotated) |
| POST | `/logout` | — | `{ refreshToken }` | 204 |
| GET | `/me` | Bearer | — | 200 `{ id, fullName, email, phone, role }` |

`user = { id, fullName, email, phone, role }`. Errors use `{ error: { code, message } }`.

## Layers
`auth.route → auth.controller → auth.service → auth.repository → Prisma`. Zod in `auth.schema`,
response shaping in `auth.mapper`.

## Security
- Passwords hashed with **argon2id** (`lib/password`); never returned/logged. Login returns a generic error.
- **Access token**: JWT (`lib/jwt`), 15 min, carries `{ sub, role }`.
- **Refresh token**: opaque random (`lib/tokens`), stored **SHA-256-hashed** as `RefreshToken.tokenHash`,
  **rotated on every use**; replay of a revoked token revokes the whole family (theft detection).
- `/auth/*` is rate-limited per IP (`middleware/rateLimit`).

## Tables
`User` (email/phone/passwordHash/role), `RefreshToken` (tokenHash/expiresAt/revokedAt). `OtpChallenge` reserved for Phase 1b.

## Config
`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (dev defaults; real values required in prod),
`JWT_ACCESS_TTL` (`15m`), `JWT_REFRESH_TTL_DAYS` (`30`).

## Dev credentials (from seed)
`customer@shop.test` / `admin@shop.test` / `staff@shop.test`, password `Password123!`.
