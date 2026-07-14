import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '@/app';
import { prisma } from '@/config/db';
import { trialService } from './trial.service';

const app = createApp();

async function signIn(phone: string): Promise<string> {
  const otp = await request(app).post('/api/v1/auth/otp/request').send({ phone });
  const verify = await request(app)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, code: otp.body.devCode });
  return verify.body.accessToken as string;
}

const freshPhone = () => `7${String(Date.now() + Math.floor(Math.random() * 100000)).slice(-9)}`;

/** Fresh customer with a saved address in `city`. */
async function customerWithAddress(city: string) {
  const phone = freshPhone();
  const token = await signIn(phone);
  const me = await request(app).get('/api/v1/auth/me').set({ Authorization: `Bearer ${token}` });
  const address = await prisma.address.create({
    data: { userId: me.body.id, line1: '1 Trial Lane', city, state: 'KA', pincode: '560001' },
  });
  return { token, userId: me.body.id as string, addressId: address.id };
}

const storeRow = (variantId: string, storeId: string) =>
  prisma.inventory.findFirstOrThrow({
    where: { variantId, storeId },
    select: { quantityAvailable: true, quantityOnTrial: true },
  });

describe('trial module', () => {
  let custA = { token: '', userId: '', addressId: '' };
  let staffToken = '';
  let storeId = '';
  // Distinct-product trial-eligible variants with store stock ≥ 2 at BLR01.
  let v1 = { id: '', pricePaise: 0 };
  let v2 = { id: '', pricePaise: 0 };
  let v3 = { id: '', pricePaise: 0 };
  let ineligibleVariantId = '';
  let slotStart = '';

  const asUser = (token: string) => ({ Authorization: `Bearer ${token}` });
  const auth = () => asUser(custA.token);
  const asStaff = () => asUser(staffToken);

  const book = (token: string, items: { variantId: string; qty: number }[], addressId: string) =>
    request(app).post('/api/v1/trials').set(asUser(token)).send({ items, addressId, slotStart });

  beforeAll(async () => {
    custA = await customerWithAddress('Bengaluru');

    const blr = await prisma.store.findUniqueOrThrow({ where: { code: 'BLR01' } });
    storeId = blr.id;
    // A dedicated staff account at BLR01 (fresh phone: parallel suites own the seeded ones).
    const staffPhone = freshPhone();
    await prisma.user.create({
      data: { phone: `+91${staffPhone}`, fullName: 'Trial Staffer', role: 'STAFF', storeId: blr.id, phoneVerified: true },
    });
    staffToken = await signIn(staffPhone);

    const rows = await prisma.inventory.findMany({
      where: {
        storeId: blr.id,
        quantityAvailable: { gte: 2 },
        variant: { product: { trialEligible: true } },
      },
      select: {
        variant: { select: { id: true, pricePaise: true, product: { select: { id: true } } } },
      },
    });
    const byProduct = new Map<string, { id: string; pricePaise: number }>();
    for (const r of rows) {
      if (!byProduct.has(r.variant.product.id)) {
        byProduct.set(r.variant.product.id, { id: r.variant.id, pricePaise: r.variant.pricePaise });
      }
    }
    const picks = [...byProduct.values()];
    expect(picks.length).toBeGreaterThanOrEqual(3);
    [v1, v2, v3] = picks as [typeof v1, typeof v2, typeof v3];

    const ineligible = await prisma.productVariant.findFirstOrThrow({
      where: { product: { trialEligible: false } },
      select: { id: true },
    });
    ineligibleVariantId = ineligible.id;
  });

  it('reports eligibility, the serviceable store, and a 7-day slot grid', async () => {
    const res = await request(app)
      .get(`/api/v1/trials/eligibility?variantIds=${v1.id},${ineligibleVariantId}&addressId=${custA.addressId}`)
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.addressServiceable).toBe(true);
    expect(res.body.store.code).toBe('BLR01');
    const items = res.body.items as { variantId: string; eligible: boolean; reason: string | null }[];
    expect(items.find((i) => i.variantId === v1.id)).toMatchObject({ eligible: true, reason: null });
    expect(items.find((i) => i.variantId === ineligibleVariantId)?.eligible).toBe(false);
    expect(res.body.slots).toHaveLength(7);
    expect(res.body.slots[0].windows).toHaveLength(3);
    slotStart = res.body.slots[0].windows[0].slotStart;
  });

  it('rejects an address no boutique services', async () => {
    const remote = await customerWithAddress('Pune');
    const eligibility = await request(app)
      .get(`/api/v1/trials/eligibility?variantIds=${v1.id}&addressId=${remote.addressId}`)
      .set(asUser(remote.token));
    expect(eligibility.body.addressServiceable).toBe(false);

    const res = await book(remote.token, [{ variantId: v1.id, qty: 1 }], remote.addressId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_SERVICEABLE');
  });

  it('books a trial: REQUESTED, unpaid, stock moved available → onTrial', async () => {
    const before1 = await storeRow(v1.id, storeId);
    const before2 = await storeRow(v2.id, storeId);

    const res = await book(
      custA.token,
      [
        { variantId: v1.id, qty: 1 },
        { variantId: v2.id, qty: 1 },
      ],
      custA.addressId,
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'REQUESTED',
      paid: false,
      authAmountPaise: v1.pricePaise + v2.pricePaise,
      store: { code: 'BLR01' },
    });
    expect(res.body.items).toHaveLength(2);

    const after1 = await storeRow(v1.id, storeId);
    const after2 = await storeRow(v2.id, storeId);
    expect(after1.quantityAvailable).toBe(before1.quantityAvailable - 1);
    expect(after1.quantityOnTrial).toBe(before1.quantityOnTrial + 1);
    expect(after2.quantityAvailable).toBe(before2.quantityAvailable - 1);
    expect(after2.quantityOnTrial).toBe(before2.quantityOnTrial + 1);
  });

  it('enforces the piece cap and the active-bookings cap', async () => {
    const tooMany = await book(
      custA.token,
      [
        { variantId: v1.id, qty: 3 },
        { variantId: v2.id, qty: 3 },
      ],
      custA.addressId,
    );
    expect(tooMany.status).toBe(400); // 6 pieces > TRIAL_MAX_ITEMS (5)

    const second = await book(custA.token, [{ variantId: v3.id, qty: 1 }], custA.addressId);
    expect(second.status).toBe(201);
    const third = await book(custA.token, [{ variantId: v3.id, qty: 1 }], custA.addressId);
    expect(third.status).toBe(409); // TRIAL_MAX_ACTIVE (2) reached

    // Cancel the unpaid second booking: stock restored, nothing to refund.
    const beforeCancel = await storeRow(v3.id, storeId);
    const cancelled = await request(app)
      .post(`/api/v1/trials/${second.body.id}/cancel`)
      .set(auth());
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', refundPaise: 0 });
    const afterCancel = await storeRow(v3.id, storeId);
    expect(afterCancel.quantityAvailable).toBe(beforeCancel.quantityAvailable + 1);
  });

  it('walks staff logistics: payment gate → Confirm → Dispatch → Deliver', async () => {
    const trials = await request(app).get('/api/v1/trials').set(auth());
    const booking = trials.body.data.find((t: { status: string }) => t.status === 'REQUESTED');
    expect(booking).toBeTruthy();

    // Staff cannot confirm an unpaid booking.
    const unpaid = await request(app)
      .post(`/api/v1/staff/trials/${booking.id}/advance`)
      .set(asStaff());
    expect(unpaid.status).toBe(409);
    expect(unpaid.body.error.code).toBe('PAYMENT_PENDING');

    // Dev stand-in captures the charge (idempotent).
    const paid = await request(app).post(`/api/v1/trials/${booking.id}/confirm-dev`).set(auth());
    expect(paid.body.paid).toBe(true);
    const replay = await request(app).post(`/api/v1/trials/${booking.id}/confirm-dev`).set(auth());
    expect(replay.body.paid).toBe(true);

    // The booking shows on the staff Try-at-Home board.
    const board = await request(app).get('/api/v1/staff/trials').set(asStaff());
    expect(board.body.data.some((t: { id: string }) => t.id === booking.id)).toBe(true);

    const confirmed = await request(app)
      .post(`/api/v1/staff/trials/${booking.id}/advance`)
      .set(asStaff());
    expect(confirmed.body.status).toBe('CONFIRMED');
    const dispatched = await request(app)
      .post(`/api/v1/staff/trials/${booking.id}/advance`)
      .set(asStaff());
    expect(dispatched.body.status).toBe('OUT_FOR_TRIAL');
    const delivered = await request(app)
      .post(`/api/v1/staff/trials/${booking.id}/advance`)
      .set(asStaff());
    expect(delivered.body.status).toBe('IN_TRIAL');
    expect(delivered.body.trialEndsAt).toBeTruthy();

    const beyond = await request(app)
      .post(`/api/v1/staff/trials/${booking.id}/advance`)
      .set(asStaff());
    expect(beyond.status).toBe(409);
    expect(beyond.body.error.code).toBe('ILLEGAL_TRANSITION');
  });

  it('records outcomes: kept becomes a PAID conversion order, returns restock + refund', async () => {
    const trials = await request(app).get('/api/v1/trials').set(auth());
    const booking = trials.body.data.find((t: { status: string }) => t.status === 'IN_TRIAL');
    const [keep, giveBack] = booking.items;

    // Partial outcomes are rejected.
    const partial = await request(app)
      .post(`/api/v1/trials/${booking.id}/outcome`)
      .set(auth())
      .send({ items: [{ trialItemId: keep.trialItemId, outcome: 'KEPT' }] });
    expect(partial.status).toBe(400);

    const beforeKeep = await storeRow(keep.variantId, storeId);
    const beforeReturn = await storeRow(giveBack.variantId, storeId);

    const res = await request(app)
      .post(`/api/v1/trials/${booking.id}/outcome`)
      .set(auth())
      .send({
        items: [
          { trialItemId: keep.trialItemId, outcome: 'KEPT' },
          { trialItemId: giveBack.trialItemId, outcome: 'RETURNED' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'COMPLETED', refundPaise: giveBack.unitPricePaise });
    expect(res.body.conversionOrderId).toBeTruthy();

    // Kept: leaves onTrial and the building. Returned: back on the shelf.
    const afterKeep = await storeRow(keep.variantId, storeId);
    const afterReturn = await storeRow(giveBack.variantId, storeId);
    expect(afterKeep.quantityOnTrial).toBe(beforeKeep.quantityOnTrial - 1);
    expect(afterKeep.quantityAvailable).toBe(beforeKeep.quantityAvailable);
    expect(afterReturn.quantityOnTrial).toBe(beforeReturn.quantityOnTrial - 1);
    expect(afterReturn.quantityAvailable).toBe(beforeReturn.quantityAvailable + 1);

    // The conversion order is a real PAID order for the kept value only.
    const order = await request(app)
      .get(`/api/v1/orders/${res.body.conversionOrderId}`)
      .set(auth());
    expect(order.status).toBe(200);
    expect(order.body).toMatchObject({
      status: 'PAID',
      source: 'TRIAL_CONVERSION',
      totalPaise: keep.unitPricePaise,
      shippingPaise: 0,
    });

    // A completed trial cannot be cancelled.
    const noCancel = await request(app).post(`/api/v1/trials/${booking.id}/cancel`).set(auth());
    expect(noCancel.status).toBe(409);
  });

  it('cancels a paid booking with a full refund recorded', async () => {
    const cust = await customerWithAddress('Bengaluru');
    const booking = await book(cust.token, [{ variantId: v3.id, qty: 1 }], cust.addressId);
    expect(booking.status).toBe(201);
    await request(app).post(`/api/v1/trials/${booking.body.id}/confirm-dev`).set(asUser(cust.token));

    const res = await request(app)
      .post(`/api/v1/trials/${booking.body.id}/cancel`)
      .set(asUser(cust.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'CANCELLED', refundPaise: v3.pricePaise });
  });

  it('auto-returns an expired trial (sweeper)', async () => {
    const cust = await customerWithAddress('Bengaluru');
    const booking = await book(cust.token, [{ variantId: v1.id, qty: 1 }], cust.addressId);
    await request(app).post(`/api/v1/trials/${booking.body.id}/confirm-dev`).set(asUser(cust.token));
    for (let i = 0; i < 3; i++) {
      await request(app).post(`/api/v1/staff/trials/${booking.body.id}/advance`).set(asStaff());
    }
    await prisma.trialBooking.update({
      where: { id: booking.body.id },
      data: { trialEndsAt: new Date(Date.now() - 1000) },
    });
    const before = await storeRow(v1.id, storeId);

    const swept = await trialService.sweepExpiredTrials();
    expect(swept).toBeGreaterThanOrEqual(1);

    const after = await request(app)
      .get(`/api/v1/trials/${booking.body.id}`)
      .set(asUser(cust.token));
    expect(after.body).toMatchObject({ status: 'COMPLETED', refundPaise: v1.pricePaise });
    expect(after.body.items[0].outcome).toBe('RETURNED');
    expect(after.body.conversionOrderId).toBeNull(); // nothing kept
    const restocked = await storeRow(v1.id, storeId);
    expect(restocked.quantityAvailable).toBe(before.quantityAvailable + 1);
  });

  it("blocks reading another user's trial (403)", async () => {
    const trials = await request(app).get('/api/v1/trials').set(auth());
    const other = await customerWithAddress('Bengaluru');
    const res = await request(app)
      .get(`/api/v1/trials/${trials.body.data[0].id}`)
      .set(asUser(other.token));
    expect(res.status).toBe(403);
  });
});
