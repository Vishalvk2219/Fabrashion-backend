import 'dotenv/config';
import { PrismaClient, Department, UserRole } from '@prisma/client';

import { hashPassword } from '@/lib/password';

const prisma = new PrismaClient();

/** Dev password for all seeded users (email/password login). */
const DEV_PASSWORD = 'Password123!';

const rupees = (r: number) => Math.round(r * 100); // ₹ -> paise

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
  await prisma.warehouse.deleteMany();
  await prisma.store.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.otpChallenge.deleteMany();
  await prisma.address.deleteMany();
  await prisma.user.deleteMany();
}

async function main() {
  await reset();

  // ── Users (email/password + phone; all share DEV_PASSWORD for local login) ──
  const passwordHash = await hashPassword(DEV_PASSWORD);

  const admin = await prisma.user.create({
    data: {
      email: 'admin@shop.test',
      phone: '+919000000001',
      fullName: 'Store Admin',
      role: UserRole.ADMIN,
      phoneVerified: true,
      passwordHash,
    },
  });

  const staff = await prisma.user.create({
    data: {
      email: 'staff@shop.test',
      phone: '+919000000002',
      fullName: 'Store Staff',
      role: UserRole.STAFF,
      phoneVerified: true,
      passwordHash,
    },
  });

  const customer = await prisma.user.create({
    data: {
      email: 'customer@shop.test',
      phone: '+919000000003',
      fullName: 'Aarav Sharma',
      role: UserRole.CUSTOMER,
      phoneVerified: true,
      passwordHash,
      addresses: {
        create: {
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
      gstRatePct: 12,
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
      gstRatePct: 12,
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
      gstRatePct: 12,
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
      gstRatePct: 12,
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
      gstRatePct: 12,
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
  const trialEligibleVariantIds: string[] = [];

  for (const p of products) {
    const { variants, ...productData } = p;
    const created = await prisma.product.create({
      data: {
        ...productData,
        variants: { create: variants },
        images: {
          create: [{ url: `https://picsum.photos/seed/${p.slug}/800/1000`, position: 0 }],
        },
      },
      include: { variants: true },
    });
    for (const v of created.variants) {
      createdVariantIds.push(v.id);
      if (p.trialEligible) trialEligibleVariantIds.push(v.id);
    }
  }

  // ── Locations ──
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

  // ── Inventory: every variant stocked at the warehouse; trial-eligible
  //    variants also stocked in the Bengaluru store. ──
  for (const variantId of createdVariantIds) {
    await prisma.inventory.create({
      data: { variantId, warehouseId: warehouse.id, quantityAvailable: 20 },
    });
  }
  for (const variantId of trialEligibleVariantIds) {
    await prisma.inventory.create({
      data: { variantId, storeId: blr.id, quantityAvailable: 5 },
    });
  }

  const counts = {
    users: 3,
    categories: 6,
    products: products.length,
    variants: createdVariantIds.length,
    warehouses: 1,
    stores: 2,
    inventoryRows: createdVariantIds.length + trialEligibleVariantIds.length,
  };
  console.log('✅ Seed complete:', counts);
  console.log(`   Admin: ${admin.email} · Staff: ${staff.email} · Customer: ${customer.email}`);
  console.log(`   Dev password for all seeded users: ${DEV_PASSWORD}`);
  console.log(`   Stores: ${blr.code}, ${mum.code} · Warehouse: ${warehouse.code}`);
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
