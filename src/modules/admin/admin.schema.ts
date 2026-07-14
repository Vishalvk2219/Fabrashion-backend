import { z } from 'zod';

/** A 10-digit Indian mobile number (without the +91 prefix) — same rule as auth. */
const phone = z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number');

const pageQuery = {
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
};

export const adminStaffQuerySchema = z.object(pageQuery);
export type AdminStaffQuery = z.infer<typeof adminStaffQuerySchema>;

/**
 * POST /admin/staff — the Add Staff / Send Invite screen. Creates the account
 * with the role; the person signs in via the same phone-OTP flow and lands in
 * their shell (role is stored on the account, never chosen at login).
 */
export const createStaffSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  phone,
  role: z.enum(['STAFF', 'ADMIN']),
  storeId: z.string().uuid().optional(),
  /** Permission toggles, persisted verbatim; authorization stays role-based for now. */
  permissions: z.record(z.string().max(40), z.boolean()).optional(),
});
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const adminCatalogQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type AdminCatalogQuery = z.infer<typeof adminCatalogQuerySchema>;

const variantInput = z
  .object({
    size: z.string().trim().min(1).max(12),
    colorName: z.string().trim().min(1).max(40),
    colorHex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'colorHex must be #RRGGBB')
      .optional(),
    pricePaise: z.number().int().positive(),
    mrpPaise: z.number().int().positive(),
  })
  .refine((v) => v.mrpPaise >= v.pricePaise, {
    message: 'mrpPaise must be at least pricePaise',
  });

/** POST /admin/products — the New Product screen (catalog write path). */
export const createProductSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().min(1).max(2000),
    categoryId: z.string().uuid(),
    department: z.enum(['MEN', 'WOMEN', 'UNISEX', 'KIDS']),
    brand: z.string().trim().min(1).max(60).optional(),
    fit: z.string().trim().min(1).max(40).optional(),
    material: z.string().trim().min(1).max(80).optional(),
    gstRatePct: z.number().int().min(0).max(28).default(12),
    hsnCode: z.string().trim().min(2).max(10).optional(),
    trialEligible: z.boolean().default(false),
    /** Hosted image URL for now; S3 presigned uploads are a later phase. */
    imageUrl: z.string().url().optional(),
    /** Opening stock for every variant at the main warehouse. */
    initialWarehouseQty: z.number().int().min(0).max(10000).default(0),
    variants: z.array(variantInput).min(1).max(60),
  })
  .refine(
    (p) => new Set(p.variants.map((v) => `${v.size}|${v.colorName.toLowerCase()}`)).size === p.variants.length,
    { message: 'Duplicate size + color combination in variants' },
  );
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const ADMIN_ORDER_STATUSES = ['NEW', 'PACKED', 'DELIVERED', 'CANCELLED'] as const;
export type AdminOrderStatusFilter = (typeof ADMIN_ORDER_STATUSES)[number];

export const adminOrdersQuerySchema = z.object({
  status: z.enum(ADMIN_ORDER_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export type AdminOrdersQuery = z.infer<typeof adminOrdersQuerySchema>;
