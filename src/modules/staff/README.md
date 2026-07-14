# module: staff (Store Ops)

Store-scoped back-office APIs for the mobile **staff shell** (plan `plans/18-back-office-apis.md`).
All routes require auth + role **STAFF or ADMIN**, and (except where noted) operate on the caller's
boutique — `User.storeId`, set by the admin. A staff account with no store gets
`409 NO_STORE_ASSIGNED`.

## Endpoints
| Method | Path | What |
|---|---|---|
| GET | `/staff/summary` | Dashboard stats: `store`, `toPack`, `ready`, `tryAtHome`, `lowStock`, `updatedToday`, `packedToday` ("today" = IST day, `lib/time.ts`) |
| GET | `/staff/inventory` | Store inventory rows (paginated, `q` on name/SKU): `floor`/`counter`/`reserved` buckets + variant info + `version` |
| PATCH | `/staff/inventory/:variantId` | `{ deltas: { floor?, counter?, reserved? }, eventId }` — atomic bucket deltas |
| GET | `/staff/orders` | Fulfilment board (paginated, `stage` filter: `TO_PACK` · `TRY_AT_HOME` · `READY` · `HANDED_OVER`) |
| POST | `/staff/orders/:id/advance` | One legal step: PAID→FULFILLING→SHIPPED→DELIVERED |
| GET | `/staff/trials` | Try-at-Home board: active trial bookings this store fulfils |
| POST | `/staff/trials/:id/advance` | REQUESTED→CONFIRMED (**requires captured payment**, else 409 `PAYMENT_PENDING`) →OUT_FOR_TRIAL→IN_TRIAL (starts the keep/return window) |

## Buckets ↔ schema
`floor` = `Inventory.quantityAvailable` (online-sellable), `counter` = `quantityOnCounter`
(fitting room / billing — **not** online-sellable), `reserved` = `quantityReserved`. A floor→counter
move is one call: `{ deltas: { floor: -1, counter: 1 } }`. Status (In Stock / Low / On Counter /
Out) is **derived on the client**, never stored — `lowStock` here mirrors the mobile `deriveStatus`
precedence.

## Adjustments: deltas + eventId idempotency (the offline-queue contract)
Adjustments are **deltas, not absolute values**, and every call carries a client-generated
`eventId` (UUID). Applying writes an `InventorySyncLog` row with
`externalEventId = eventId`; the `@@unique([source, externalEventId])` constraint makes replays
no-ops that return current state. So the mobile offline queue can flush the same op twice (lost
response, retry) without double-applying. Negativity is rejected atomically
(`409 INSUFFICIENT_STOCK`) via guarded `updateMany`.
*Design note:* the plan originally suggested a per-op `version` guard; deltas made it wrong — a
queued second op would always carry a stale version and jam the flush. Deltas are commutative, so
the negativity guard is the only check needed. `version` is still returned (and bumped) for future
absolute writes.

## Fulfilment
Stages map to `OrderStatus`: To Pack = PAID · Ready = FULFILLING · Handed Over = SHIPPED/DELIVERED.
`TRY_AT_HOME` is trial bookings — served by `/staff/trials` since plan 19 (see `modules/trial`). Advancing
PAID→FULFILLING **consumes the checkout reservation at the warehouse** (v1 fulfils online orders
from the warehouse regardless of the staffer's store), sync-logged per row with
`externalEventId = pack:<orderId>:<rowId>` and payload `{ orderId }` — which is also what
`packedToday` counts (distinct orderIds in today's logs). Illegal transitions →
`409 ILLEGAL_TRANSITION`.

## Layering
`route → controller → service → repository → mapper`, same as catalog/cart. Money is integer paise.
Tests: `staff.test.ts` (gates, summary, list+search, idempotent adjust, negativity, board, full
advance walk incl. reservation consumption).
