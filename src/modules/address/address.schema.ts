import { z } from 'zod';

const label = z.enum(['HOME', 'WORK', 'OTHER']);

export const createAddressSchema = z.object({
  label: label.default('HOME'),
  recipientName: z.string().trim().min(1, 'Name is required').max(100),
  recipientPhone: z.string().trim().min(5, 'Phone is required').max(20),
  line1: z.string().trim().min(1, 'Address is required').max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, 'City is required').max(100),
  state: z.string().trim().min(1, 'State is required').max(100),
  pincode: z.string().regex(/^\d{6}$/, 'Enter a valid 6-digit pincode'),
  isDefault: z.boolean().optional(),
});
export type CreateAddressInput = z.infer<typeof createAddressSchema>;

export const updateAddressSchema = createAddressSchema.partial();
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;

export const addressParamsSchema = z.object({ id: z.string().uuid() });
export type AddressParams = z.infer<typeof addressParamsSchema>;
