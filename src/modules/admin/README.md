# module: admin

Management APIs for the mobile **admin shell** (plan `plans/18-back-office-apis.md`). All routes
require auth + role **ADMIN**.

## Endpoints
| Method | Path | What |
|---|---|---|
| GET | `/admin/overview` | KPIs (today, IST): revenue / orders / AOV / active customers + bps deltas, 7-day revenue series, per-channel revenue |
| GET | `/admin/staff` | Team directory (STAFF + ADMIN accounts), paginated |
| POST | `/admin/staff` | Add Staff / Send Invite: `{ fullName, phone, role, storeId?, permissions? }` |
| GET | `/admin/catalog` | Product list incl. inactive (paginated, `q`): prices + cross-location `totalStock` |
| POST | `/admin/products` | New Product: product + variants (+ optional opening warehouse stock + `imageUrl`) |
| GET | `/admin/orders` | All orders (paginated, `status` filter `NEW·PACKED·DELIVERED·CANCELLED`) |

## Overview semantics
Revenue counts **realized** orders (PAID/FULFILLING/SHIPPED/DELIVERED) by `placedAt`, bucketed on
the **IST** business day (`lib/time.ts`). Deltas are **basis points** vs yesterday (customers: last
30d vs prior 30d); `null` when the baseline is 0 — the client renders "—". `storePerf` reports the
online channel from real orders; physical-store rows are honestly **0 until POS sale ingestion**
lands (plan 06) — no invented splits.

## Staff lifecycle
`POST /admin/staff` creates the account with its role/boutique and `phoneVerified: false` → the
directory shows **INVITED**. There is no SMS invite yet (MSG91 is a later phase): the account
existing IS the invite. The person signs in through the same phone-OTP flow everyone uses; the
first successful verify flips `phoneVerified` (auth module) → **ACTIVE**, and their role routes
them into the right shell. Duplicate phone → 409. `permissions` toggles are persisted verbatim on
`User.staffPermissions` but **not yet enforced** — authorization is role-based.

## Catalog write path (important invariant)
`POST /admin/products` generates a unique slug (suffixing `-2`, `-3` on collisions), deterministic
SKUs (`SLUG-COLOR-SIZE`), and **must maintain the denormalized `Product.minPricePaise` /
`maxPricePaise` pair** — public catalog sort/price filters read them. Every variant gets a
warehouse inventory row (`initialWarehouseQty`, default 0). Duplicate size+color in the payload →
422. New products are live in the public catalog immediately.

## Order statuses (design ↔ DB)
NEW = PAID · PACKED = FULFILLING/SHIPPED · DELIVERED = DELIVERED · CANCELLED = CANCELLED/REFUNDED.
**PENDING never appears** — it isn't a sale yet.

## Layering
`route → controller → service → repository → mapper`, same as the other modules. Money is integer
paise; the client formats. Tests: `admin.test.ts` (gates, overview math, directory statuses,
invite→OTP-login→ACTIVE walk, duplicate phone, catalog list/search, product create incl. min/max +
public visibility + slug suffix + 422s, order filters).
