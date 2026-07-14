# module: trial (At-Home Trials)

Customers book trial-eligible pieces to try at home, keep some, return the rest — **only kept
pieces are charged**. Design: `plans/07-home-trial.md` (state machine, stock invariants, payment
Strategy A); build plan: `plans/19-phase-6-trials.md`. All routes require auth.

## Endpoints
| Method | Path | What |
|---|---|---|
| GET | `/trials/eligibility?variantIds=&addressId=` | Per-variant eligibility + serviceable store + the bookable slot grid |
| POST | `/trials` | Book: `{ items, addressId, slotStart, note? }` → REQUESTED, stock held, charge pending |
| GET | `/trials` · `/trials/:id` | The user's bookings (owner only) |
| POST | `/trials/:id/outcome` | `{ items: [{trialItemId, outcome: KEPT\|RETURNED}] }` — IN_TRIAL only, every piece resolved |
| POST | `/trials/:id/cancel` | REQUESTED/CONFIRMED only: release holds, record full refund |
| POST | `/trials/:id/confirm-dev` | **DEV-only** stand-in for the PhonePe capture (`markTrialPaid`, idempotent) |

Staff logistics live in `modules/staff`: `GET /staff/trials` (the Try-at-Home board) +
`POST /staff/trials/:id/advance` (REQUESTED→CONFIRMED **requires captured payment** →
OUT_FOR_TRIAL → IN_TRIAL, which starts the keep/return window).

## Payment (Strategy A; PhonePe lands in 4c)
Full basket value is charged at booking, returned value refunded at completion. Until PhonePe:
booking is created **charge-pending** (`paymentCapturedAt` null — the analog of a PENDING order);
`confirm-dev` captures via the same idempotent `markTrialPaid` the 4c webhook will call. Refunds
are **recorded** (`refundPaise`); the real refund call slots into the same seams in 4c.

## Stock invariants (plan 07)
At the fulfilling store, every move is version-guarded + sync-logged (source `trial`, dedupe
event ids `trial-hold/keep/return/cancel:*`):
book `available−q, onTrial+q` · keep `onTrial−q` (sold) · return/cancel `onTrial−q, available+q`.
Completion **claims the booking status-guarded first**, so a concurrent sweeper/outcome can never
double-apply.

## Completion & the sweeper
`POST /outcome` (all pieces resolved) → single TX: stock moves, KEPT pieces become a
**PAID `TRIAL_CONVERSION` order** (GST broken out, shipping 0, CAPTURED payment for the kept
value), `refundPaise = returned value`, booking COMPLETED. Past `trialEndsAt`
(`TRIAL_WINDOW_HOURS` after delivery) the **sweeper auto-returns undecided pieces** — plan 07's
default policy — running lazily on trial reads plus a 10-min interval in `src/index.ts`.

## Serviceability, slots, limits (v1)
Fulfilling store = same-city (case-insensitive) `syncEnabled` store stocking the whole basket,
else `409 NOT_SERVICEABLE`. Slots: fixed IST windows (11–1, 2–4, 5–7) for the next 7 days,
`TRIAL_SLOT_CAPACITY` bookings per store-day. Guards: `TRIAL_MAX_ITEMS` pieces,
`TRIAL_MAX_VALUE_PAISE` basket value, `TRIAL_MAX_ACTIVE` concurrent bookings per user.

## Layering
`route → controller → service → repository → mapper`, like every module. Money is integer paise.
Tests: `trial.test.ts` (eligibility/serviceability, holds + caps, payment gate, staff chain,
partial-keep completion incl. order + stock + refund, paid cancel, sweeper, ownership).
