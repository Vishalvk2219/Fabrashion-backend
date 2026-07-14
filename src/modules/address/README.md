# Module: `address`

Saved shipping addresses for the signed-in user. **Auth required**; every address belongs to the
token's user. Feeds checkout (`POST /checkout { addressId }`). Plan `plans/17-phase-4-cart-checkout.md`.

## Endpoints (`/api/v1/addresses`)
| Method | Path | Body | Result |
|--------|------|------|--------|
| GET | `/addresses` | — | 200 `Address[]` (default first, then newest) |
| POST | `/addresses` | `Address` fields | 201 `Address` |
| PATCH | `/addresses/:id` | partial | 200 `Address` |
| DELETE | `/addresses/:id` | — | 200 `{ addresses }` (the remaining list) |

`Address = { id, label(HOME|WORK|OTHER), recipientName, recipientPhone, line1, line2?, city, state,
pincode, isDefault }`. Unknown id → 404; another user's → 403; bad pincode → 422.

## Default handling (atomic)
The **first** address a user creates is the default. Creating/updating with `isDefault: true` clears
the flag on the others (in a transaction). Deleting the default **promotes** the next most-recent
address. Exactly one default is maintained.

## Layering
`address.route → controller → service → repository → Prisma`; Zod in `address.schema`, DTO in
`address.mapper`. Default bookkeeping lives in the service transactions. Tests in `address.test.ts`.
