# Module: `catalog`

Public product browsing — categories, product list (search/filter/sort/paginate), product detail,
and availability. Read-only; admin catalog writes are a later (back-office) phase. Contract:
`plans/05-api-design.md`, plan `plans/16-phase-2-catalog.md`.

## Endpoints (`/api/v1`)
| Method | Path | Query / Params | Success |
|--------|------|----------------|---------|
| GET | `/categories` | — | 200 `Category[]` (flat; client builds the tree) |
| GET | `/products` | `q, categoryId, minPrice, maxPrice, sort, page, limit` | 200 `Paginated<Product>` |
| GET | `/products/:id` | id **or** slug | 200 `Product` · 404 if missing/inactive |
| GET | `/products/:id/availability` | id or slug | 200 `{ productId, variants[], stores[] }` |

`sort ∈ popular | newest | price_asc | price_desc` (default `popular`). `page≥1`, `limit≤50` (default
20). Prices are integer **paise**. Only `isActive` products are returned. All routes use `readLimiter`.

### Shapes
`Product = { id, name, slug, description, brand, department, trialEligible, images[], variants[] }`;
`ProductVariant = { id, sku, size, colorName, colorHex, pricePaise, mrpPaise, availableQty }`;
`Paginated<T> = { data, meta:{ page, limit, total, totalPages } }`. These mirror
`ecommerce-mobile/src/features/catalog/schema.ts` exactly, so the app swaps preview→live with no UI change.

## `availableQty` (computed, never stored raw)
Sellable-now stock summed across **online** locations only = every warehouse + stores with
`syncEnabled = true`. Folded from `inventory` in `catalog.mapper` (`onlineAvailableQty`); the public
API never exposes per-location stock. `/availability` additionally lists which sync-enabled stores
carry the product.

## Layers
`catalog.route → controller → service → repository → Prisma`. Zod query/param validation in
`catalog.schema`; DTO shaping + the availability fold in `catalog.mapper`. The Prisma `include`s and
their payload types live in `catalog.repository` (single source of the query shape).

## Design notes
- **Price sort/filter** uses denormalized `Product.minPricePaise` / `maxPricePaise` (indexed) — Prisma
  can't `orderBy` a to-many aggregate. The seed populates them; the future catalog **write** path must
  recompute them when variant prices change. A product's range must overlap `[minPrice, maxPrice]`.
- **`popular`** is newest-first for now — real popularity needs orders/reviews (later phase).
- `categoryId` matches the category **and its children** (two-level tree).
- List uses one `$transaction([findMany, count])` so `meta.total` is consistent with the filter; a
  single `include` folds images + variant availability (no N+1).

## Tests
`catalog.test.ts` (supertest + seeded DB): categories, list+pagination, category/price/search filters,
price sort, detail 200/404, invalid-query 422, availability shape.
