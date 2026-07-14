# Module: `auth`

Identity + session for the platform. **Login is phone-OTP only** — a 4-digit code to a mobile
number. Email is optional profile data, **never a credential**. The account's `role`
(CUSTOMER/STAFF/ADMIN) is returned on verify and selects the app shell; roles are set on the account
(admin is seeded, admin creates staff), never chosen at login.

## Endpoints (`/api/v1/auth`)
| Method | Path | Auth | Body | Success |
|--------|------|------|------|---------|
| POST | `/otp/request` | — | `{ phone }` (10-digit) | 200 `{ expiresInSec, devCode? }` |
| POST | `/otp/verify` | — | `{ phone, code }` (4-digit) | 200 `{ user, accessToken, refreshToken }` |
| POST | `/refresh` | — | `{ refreshToken }` | 200 `{ accessToken, refreshToken }` (rotated) |
| POST | `/logout` | — | `{ refreshToken }` | 204 |
| GET | `/me` | Bearer | — | 200 `{ id, fullName, email, phone, role }` |

`user = { id, fullName, email, phone, role }`. Errors use `{ error: { code, message } }`.
Verifying an unknown phone **creates a CUSTOMER account** (self-signup); seeded ADMIN/STAFF phones
return their stored role.

`devCode` is present only outside production (`OTP_EXPOSE_CODE`), so the flow is walkable without an
SMS provider — the code is also written to the server log. Production sends via MSG91 (TODO in
`auth.service`).

Machine-readable contract: **`auth.openapi.ts`** → `docs/openapi.json` (browse it at `/docs`).
It reuses `auth.schema` for request bodies, so the spec and the validation can never disagree.

## Layers
`auth.route → auth.controller → auth.service → auth.repository → Prisma`. Zod in `auth.schema`,
response shaping in `auth.mapper`.

## Security
- OTP is a random 4-digit code, stored **SHA-256-hashed and salted by phone** in `OtpChallenge`
  (`lib/tokens`); never logged in prod. Codes expire (`OTP_TTL_MINUTES`), cap attempts
  (`OTP_MAX_ATTEMPTS`), are single-use (`consumedAt`), and have a resend cooldown
  (`OTP_RESEND_COOLDOWN_SECONDS`) on top of the per-IP rate limiter. Like the rate limiters,
  the cooldown is skipped under `NODE_ENV=test` (parallel suites sign seeded phones in repeatedly).
- A successful verify sets `phoneVerified` on existing accounts too — this is what flips an
  admin-invited staff account from **Invited** to **Active** in the admin directory (see
  `modules/admin`).
- **Access token**: JWT (`lib/jwt`), 15 min, carries `{ sub, role }`.
- **Refresh token**: opaque random (`lib/tokens`), stored **SHA-256-hashed** as `RefreshToken.tokenHash`,
  **rotated on every use**; replay of a revoked token revokes the whole family (theft detection).
- `/auth/*` is rate-limited per IP (`middleware/rateLimit`).

## Tables
`User` (email?/phone?/role; `passwordHash` unused by the OTP flow), `RefreshToken`
(tokenHash/expiresAt/revokedAt), `OtpChallenge` (phone/codeHash/attempts/expiresAt/consumedAt).

## Config
`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (dev defaults; real values required in prod),
`JWT_ACCESS_TTL` (`15m`), `JWT_REFRESH_TTL_DAYS` (`30`), `OTP_TTL_MINUTES` (`5`),
`OTP_MAX_ATTEMPTS` (`5`), `OTP_RESEND_COOLDOWN_SECONDS` (`30`), `OTP_EXPOSE_CODE` (`true`; forced off in prod).

## Dev accounts (from seed) — sign in by phone
Admin `+919000000001` · Staff `+919000000002` · Customer `+919000000003`. Get the code from the
`/otp/request` response `devCode` (or the server log), then `/otp/verify`.
