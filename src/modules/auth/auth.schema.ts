import { z } from 'zod';

/** Register: email/password account (phone captured for later OTP + delivery). */
export const registerSchema = z.object({
  fullName: z.string().min(2, 'Enter your name').max(100),
  email: z.string().email('Enter a valid email').toLowerCase(),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
});
export type RefreshInput = z.infer<typeof refreshSchema>;
