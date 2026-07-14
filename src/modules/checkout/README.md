# Module: `checkout` (+ orders)

Turns the active cart into an order, reserving stock. **Auth required.** PhonePe payment is a later
phase (4c); a DEV endpoint stands in for capture so the loop completes today. Plan
`plans/17-phase-4-cart-checkout.md`.

## Endpoints (`/api/v1`)
| Method | Path | Body | Result |
|--------|------|------|--------|
| POST | `/checkout` | `{ addressId }` | 201 `Order` (PENDING) — reserves stock, snapshots address; **idempotent** |
| GET | `/orders` | `?page,limit` | 200 `Paginated<Order>` (own orders) |
| GET | `/orders/:id` | — | 200 `Order` (owner only; 403 otherwise) |
| POST | `/orders/:id/cancel` | — | 200 `Order` (PENDING→CANCELLED, **releases reservation**) |
| POST | `/orders/:id/confirm-dev` | — | 200 `Order` (PAID) — **DEV only**, 404 in prod |

Empty cart → 400; unknown address → 404; insufficient stock → 409.

## Order shape
`{ id, status, source, subtotalPaise, taxPaise, shippingPaise, totalPaise, itemCount, shippingAddress,
placedAt, createdAt, items[], payment }`. Items are price **snapshots** (`unitPricePaise`). Totals are
recomputed server-side from the cart (`computeCartTotals`) — the client total is never trusted.

## Stock reservation
`POST /checkout` runs in a **transaction**: validate → reserve each variant from **warehouse** stock
(online orders ship from the warehouse) by moving `quantityAvailable → quantityReserved`, guarded by
the row `version` (optimistic concurrency) → create `Order(PENDING)` + `OrderItem` snapshots + a
`Payment(CREATED)` → mark the cart `CONVERTED`. **Idempotent:** an existing PENDING order is returned
without re-reserving. `cancel` releases the reservation; fulfilment (consuming reserved stock) is the
back-office phase.

## Capture path
`markOrderPaid(orderId)` is the single idempotent PENDING→PAID transition (sets `placedAt`, marks the
payment `CAPTURED`). Phase 4c wires the **PhonePe webhook** (`X-VERIFY`-checksum-verified) to it;
`POST /orders/:id/confirm-dev` triggers the same function in dev.

## Notes
Layering mirrors the other modules; the reservation lives in the service transaction (uses `tx.*`
directly for atomicity). Tests in `checkout.test.ts` drive the full loop. Config:
`SHIPPING_FLAT_PAISE`, `FREE_SHIPPING_THRESHOLD_PAISE`.
