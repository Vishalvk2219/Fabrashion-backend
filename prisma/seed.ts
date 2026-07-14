import 'dotenv/config';
import { PrismaClient, Department, OrderStatus, UserRole, type Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const rupees = (r: number) => Math.round(r * 100); // ₹ -> paise

// Mirror the cart/checkout money rules (lib/money + env defaults) without importing src/.
const GST_RATE_PCT = 12;
const SHIPPING_FLAT_PAISE = 4900;
const FREE_SHIPPING_THRESHOLD_PAISE = 499900;
const gstFromInclusive = (inclusivePaise: number, ratePct: number) =>
  ratePct <= 0 ? 0 : Math.round((inclusivePaise * ratePct) / (100 + ratePct));

const daysAgo = (days: number, minutesAgo = 0) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000 - minutesAgo * 60 * 1000);

/** Wipe in child→parent order so re-seeding is idempotent. */
async function reset() {
  await prisma.inventorySyncLog.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.trialItem.deleteMany();
  await prisma.trialBooking.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.productImage.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.otpChallenge.deleteMany();
  await prisma.address.deleteMany();
  await prisma.user.deleteMany();
  await prisma.warehouse.deleteMany();
  await prisma.store.deleteMany();
}

async function main() {
  await reset();

  // ── Locations (before users: staff accounts reference their store) ──
  const warehouse = await prisma.warehouse.create({
    data: { name: 'Main Warehouse', code: 'WH-MAIN' },
  });
  const blr = await prisma.store.create({
    data: {
      name: 'Bengaluru — Indiranagar',
      code: 'BLR01',
      addressLine: '100 Feet Road, Indiranagar',
      city: 'Bengaluru',
      pincode: '560038',
      geoLat: 12.9719,
      geoLng: 77.6412,
      syncEnabled: true,
    },
  });
  const mum = await prisma.store.create({
    data: {
      name: 'Mumbai — Bandra',
      code: 'MUM01',
      addressLine: 'Linking Road, Bandra West',
      city: 'Mumbai',
      pincode: '400050',
      geoLat: 19.0606,
      geoLng: 72.8365,
      syncEnabled: true,
    },
  });

  // ── Users (phone-OTP login; email is optional profile data, never a credential) ──
  const admin = await prisma.user.create({
    data: {
      email: 'admin@shop.test',
      phone: '+919000000001',
      fullName: 'Store Admin',
      role: UserRole.ADMIN,
      phoneVerified: true,
    },
  });

  const staff = await prisma.user.create({
    data: {
      email: 'staff@shop.test',
      phone: '+919000000002',
      fullName: 'Priya Nair',
      role: UserRole.STAFF,
      phoneVerified: true,
      storeId: blr.id,
    },
  });

  // Invited by the admin, never signed in yet → directory shows "Invited".
  const invitedStaff = await prisma.user.create({
    data: {
      phone: '+919000000004',
      fullName: 'Farhan Ali',
      role: UserRole.STAFF,
      phoneVerified: false,
      storeId: mum.id,
    },
  });

  const customer = await prisma.user.create({
    data: {
      email: 'customer@shop.test',
      phone: '+919000000003',
      fullName: 'Aarav Sharma',
      role: UserRole.CUSTOMER,
      phoneVerified: true,
      addresses: {
        create: {
          label: 'HOME',
          recipientName: 'Aarav Sharma',
          recipientPhone: '+919000000003',
          line1: '12 Residency Road',
          line2: 'Apt 4B',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560025',
          isDefault: true,
          geoLat: 12.9716,
          geoLng: 77.5946,
        },
      },
    },
  });

  const customer2 = await prisma.user.create({
    data: {
      phone: '+919000000005',
      fullName: 'Meera Kapoor',
      role: UserRole.CUSTOMER,
      phoneVerified: true,
      addresses: {
        create: {
          label: 'HOME',
          recipientName: 'Meera Kapoor',
          recipientPhone: '+919000000005',
          line1: '5 Marine Drive',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400002',
          isDefault: true,
        },
      },
    },
  });

  // ── Categories (two-level tree) ──
  const men = await prisma.category.create({ data: { name: 'Men', slug: 'men' } });
  const women = await prisma.category.create({ data: { name: 'Women', slug: 'women' } });
  const menShirts = await prisma.category.create({
    data: { name: 'Shirts', slug: 'men-shirts', parentId: men.id },
  });
  const menKnitwear = await prisma.category.create({
    data: { name: 'Knitwear', slug: 'men-knitwear', parentId: men.id },
  });
  const womenDresses = await prisma.category.create({
    data: { name: 'Dresses', slug: 'women-dresses', parentId: women.id },
  });
  const womenTops = await prisma.category.create({
    data: { name: 'Tops', slug: 'women-tops', parentId: women.id },
  });

  // ── Products with size × color variants ──
  const buildVariants = (
    skuBase: string,
    colors: { name: string; hex: string }[],
    sizes: string[],
    pricePaise: number,
    mrpPaise: number,
  ) =>
    colors.flatMap((c) =>
      sizes.map((size) => ({
        sku: `${skuBase}-${c.name.replace(/\s+/g, '').toUpperCase()}-${size}`,
        size,
        colorName: c.name,
        colorHex: c.hex,
        pricePaise,
        mrpPaise,
      })),
    );

  const products = [
    {
      name: 'Oxford Linen Shirt',
      slug: 'oxford-linen-shirt',
      description: 'A breathable 100% linen shirt with a relaxed Oxford weave.',
      categoryId: menShirts.id,
      department: Department.MEN,
      fit: 'Regular',
      material: '100% Linen',
      brand: 'Atelier',
      gstRatePct: GST_RATE_PCT,
      hsnCode: '6205',
      trialEligible: true,
      variants: buildVariants(
        'OXF-LIN',
        [
          { name: 'White', hex: '#F5F5F0' },
          { name: 'Sky Blue', hex: '#A7C7E7' },
        ],
        ['S', 'M', 'L', 'XL'],
        rupees(2999),
        rupees(3999),
      ),
    },
    {
      name: 'Merino Wool Sweater',
      slug: 'merino-wool-sweater',
      description: 'Fine-gauge merino knit, warm without the bulk.',
      categoryId: menKnitwear.id,
      department: Department.MEN,
      fit: 'Slim',
      material: '100% Merino Wool',
      brand: 'Atelier',
      gstRatePct: GST_RATE_PCT,
      hsnCode: '6110',
      trialEligible: true,
      variants: buildVariants(
        'MER-SWT',
        [
          { name: 'Charcoal', hex: '#36454F' },
          { name: 'Navy', hex: '#1F2A44' },
        ],
        ['M', 'L', 'XL'],
        rupees(4999),
        rupees(6499),
      ),
    },
    {
      name: 'Silk Wrap Dress',
      slug: 'silk-wrap-dress',
      description: 'Fluid 100% silk wrap dress with a flattering tie waist.',
      categoryId: womenDresses.id,
      department: Department.WOMEN,
      fit: 'Regular',
      material: '100% Silk',
      brand: 'Maison',
      gstRatePct: GST_RATE_PCT,
      hsnCode: '6204',
      trialEligible: true,
      variants: buildVariants(
        'SLK-WRP',
        [
          { name: 'Blush', hex: '#E8B4B8' },
          { name: 'Emerald', hex: '#046307' },
        ],
        ['XS', 'S', 'M', 'L'],
        rupees(5499),
        rupees(6999),
      ),
    },
    {
      name: 'Cotton Poplin Top',
      slug: 'cotton-poplin-top',
      description: 'Crisp cotton poplin top, an everyday premium staple.',
      categoryId: womenTops.id,
      department: Department.WOMEN,
      fit: 'Regular',
      material: '100% Cotton',
      brand: 'Maison',
      gstRatePct: GST_RATE_PCT,
      hsnCode: '6206',
      trialEligible: false,
      variants: buildVariants(
        'COT-POP',
        [
          { name: 'White', hex: '#FFFFFF' },
          { name: 'Black', hex: '#101010' },
        ],
        ['XS', 'S', 'M', 'L', 'XL'],
        rupees(1299),
        rupees(1799),
      ),
    },
    {
      name: 'Cashmere Overshirt',
      slug: 'cashmere-overshirt',
      description: 'Unstructured cashmere overshirt — a luxe layer for any season.',
      categoryId: menKnitwear.id,
      department: Department.UNISEX,
      fit: 'Oversized',
      material: '100% Cashmere',
      brand: 'Atelier',
      gstRatePct: GST_RATE_PCT,
      hsnCode: '6110',
      trialEligible: true,
      variants: buildVariants(
        'CSH-OVS',
        [{ name: 'Camel', hex: '#C19A6B' }],
        ['S', 'M', 'L'],
        rupees(8999),
        rupees(10999),
      ),
    },
  ];

  const createdVariantIds: string[] = [];
  /** First variant of each product — used to compose the seeded orders. */
  const firstVariants: { id: string; pricePaise: number }[] = [];

  for (const p of products) {
    const { variants, ...productData } = p;
    const prices = variants.map((v) => v.pricePaise);
    const created = await prisma.product.create({
      data: {
        ...productData,
        minPricePaise: Math.min(...prices),
        maxPricePaise: Math.max(...prices),
        variants: { create: variants },
        images: {
          create: [{ url: `https://picsum.photos/seed/${p.slug}/800/1000`, position: 0 }],
        },
      },
      include: { variants: { orderBy: { sku: 'asc' } } },
    });
    for (const v of created.variants) createdVariantIds.push(v.id);
    const first = created.variants[0];
    if (!first) throw new Error(`Product ${p.slug} seeded without variants`);
    firstVariants.push({ id: first.id, pricePaise: first.pricePaise });
  }

  // ── Inventory ──
  // Every variant is stocked at the warehouse (online orders ship from here) …
  for (const variantId of createdVariantIds) {
    await prisma.inventory.create({
      data: { variantId, warehouseId: warehouse.id, quantityAvailable: 20 },
    });
  }
  // … and every variant has a row at the Bengaluru store so the staff shell has a full board.
  // Varied levels exercise the derived statuses (In Stock / Low / Out) + a few "on counter" units.
  const storeLevels = [6, 2, 0, 5, 1, 8];
  for (const [i, variantId] of createdVariantIds.entries()) {
    await prisma.inventory.create({
      data: {
        variantId,
        storeId: blr.id,
        quantityAvailable: storeLevels[i % storeLevels.length] ?? 0,
        quantityOnCounter: i % 7 === 0 ? 1 : 0,
      },
    });
  }

  // ── Historical orders (drive the fulfilment queue + admin KPIs/7-day revenue) ──
  const addressSnapshots: Record<string, Prisma.InputJsonObject> = {
    [customer.id]: {
      line1: '12 Residency Road',
      line2: 'Apt 4B',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560025',
      geoLat: 12.9716,
      geoLng: 77.5946,
    },
    [customer2.id]: {
      line1: '5 Marine Drive',
      line2: null,
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400002',
      geoLat: null,
      geoLng: null,
    },
  };

  type SeedOrder = {
    userId: string;
    status: OrderStatus;
    placedAt: Date;
    lines: { variant: { id: string; pricePaise: number }; qty: number }[];
  };
  const [oxford, merino, silk, cotton, cashmere] = firstVariants;
  if (!oxford || !merino || !silk || !cotton || !cashmere) {
    throw new Error('Expected five seeded products');
  }
  const seedOrders: SeedOrder[] = [
    { userId: customer.id, status: 'PAID', placedAt: daysAgo(0, 10), lines: [{ variant: silk, qty: 1 }, { variant: cotton, qty: 1 }] },
    { userId: customer2.id, status: 'PAID', placedAt: daysAgo(0, 32), lines: [{ variant: merino, qty: 1 }] },
    { userId: customer.id, status: 'FULFILLING', placedAt: daysAgo(1), lines: [{ variant: oxford, qty: 2 }] },
    { userId: customer2.id, status: 'SHIPPED', placedAt: daysAgo(2), lines: [{ variant: cashmere, qty: 1 }] },
    { userId: customer.id, status: 'DELIVERED', placedAt: daysAgo(3), lines: [{ variant: cotton, qty: 2 }] },
    { userId: customer2.id, status: 'DELIVERED', placedAt: daysAgo(4), lines: [{ variant: silk, qty: 1 }] },
    { userId: customer.id, status: 'DELIVERED', placedAt: daysAgo(6), lines: [{ variant: merino, qty: 1 }, { variant: oxford, qty: 1 }] },
    { userId: customer2.id, status: 'CANCELLED', placedAt: daysAgo(1, 120), lines: [{ variant: cotton, qty: 1 }] },
  ];

  for (const o of seedOrders) {
    const subtotalPaise = o.lines.reduce((s, l) => s + l.variant.pricePaise * l.qty, 0);
    const taxPaise = o.lines.reduce(
      (s, l) => s + gstFromInclusive(l.variant.pricePaise * l.qty, GST_RATE_PCT),
      0,
    );
    const shippingPaise = subtotalPaise >= FREE_SHIPPING_THRESHOLD_PAISE ? 0 : SHIPPING_FLAT_PAISE;
    const totalPaise = subtotalPaise + shippingPaise;
    const cancelled = o.status === 'CANCELLED';
    const shippingAddress = addressSnapshots[o.userId];
    if (!shippingAddress) throw new Error('Seed order references a user without an address snapshot');
    await prisma.order.create({
      data: {
        userId: o.userId,
        status: o.status,
        source: 'ONLINE',
        subtotalPaise,
        taxPaise,
        shippingPaise,
        totalPaise,
        shippingAddress,
        placedAt: cancelled ? null : o.placedAt,
        createdAt: o.placedAt,
        items: {
          create: o.lines.map((l) => ({
            variantId: l.variant.id,
            quantity: l.qty,
            unitPricePaise: l.variant.pricePaise,
          })),
        },
        payment: {
          create: {
            amountPaise: totalPaise,
            provider: 'phonepe',
            status: cancelled ? 'FAILED' : 'CAPTURED',
            capturedAt: cancelled ? null : o.placedAt,
          },
        },
      },
    });
    // PAID orders still hold their reservation at the warehouse (fulfilment consumes it later) —
    // mirror checkout's available → reserved move so advancing them keeps stock consistent.
    if (o.status === 'PAID') {
      for (const l of o.lines) {
        await prisma.inventory.updateMany({
          where: { variantId: l.variant.id, warehouseId: warehouse.id },
          data: {
            quantityAvailable: { decrement: l.qty },
            quantityReserved: { increment: l.qty },
          },
        });
      }
    }
  }

  const counts = {
    users: 5,
    categories: 6,
    products: products.length,
    variants: createdVariantIds.length,
    warehouses: 1,
    stores: 2,
    inventoryRows: createdVariantIds.length * 2,
    orders: seedOrders.length,
  };
  console.log('✅ Seed complete:', counts);
  console.log('   Login is phone-OTP only. Sign in with these phones (get the code from the');
  console.log('   /auth/otp/request response `devCode` or the server log):');
  console.log(`   Admin    ${admin.phone}  (role ADMIN → admin shell)`);
  console.log(`   Staff    ${staff.phone}  (role STAFF → staff shell, store ${blr.code})`);
  console.log(`   Invited  ${invitedStaff.phone}  (STAFF, never signed in → "Invited")`);
  console.log(`   Customer ${customer.phone} / ${customer2.phone} (role CUSTOMER → shop)`);
  console.log(`   Stores: ${blr.code}, ${mum.code} · Warehouse: ${warehouse.code}`);
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
