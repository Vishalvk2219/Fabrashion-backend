# Module: `cart`

The signed-in user's shopping cart. **Auth required** on every route; the ACTIVE cart always belongs
to the token's user (created lazily). Server is authoritative on totals and stock. Plan
`plans/17-phase-4-cart-checkout.md`.

## Endpoints (`/api/v1/cart`)
| Method | Path | Body | Result |
|--------|------|------|--------|
| GET | `/cart` | — | 200 `Cart` (ACTIVE, lazily created) |
| POST | `/cart/items` | `{ variantId, quantity }` | 200 `Cart` — adds/increments; validates stock |
| PATCH | `/cart/items/:itemId` | `{ quantity }` | 200 `Cart` — set qty (0 removes); re-validates stock |
| DELETE | `/cart/items/:itemId` | — | 200 `Cart` |

Every mutation returns the whole updated cart. Insufficient stock → 409 `CONFLICT`; another user's
item → 403; unknown variant/item → 404.

## Shape
`Cart = { id, lines[], totals }`. `line = { itemId, productId, variantId, name, brand, size,
colorName, colorHex, imageUrl, pricePaise, mrpPaise, qty, availableQty, lineTotalPaise }`.
`totals = { count, subtotalPaise, discountPaise, taxPaise, shippingPaise, totalPaise }` — prices are
GST-inclusive paise; `taxPaise` is GST broken out via each product's `gstRatePct` (`lib/money`);
shipping = `SHIPPING_FLAT_PAISE`, or 0 at/above `FREE_SHIPPING_THRESHOLD_PAISE`.

## Notes
- `computeCartTotals` (in `cart.mapper`) is the single money source, reused by checkout.
- `availableQty` = online availability (warehouses + `syncEnabled` stores) via `lib/inventory`.
- Layering mirrors `catalog`/`auth`: route→controller→service→repository→mapper. Tests in `cart.test.ts`.
