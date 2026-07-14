import { z } from '@/lib/zod';

/** Register: email/password account (phone captured for later OTP + delivery). */
export const registerSchema = z
  .object({
    fullName: z
      .string()
      .min(2, 'Enter your name')
      .max(100)
      .openapi({ description: 'Customer full name.', example: 'Aarav Sharma' }),
    email: z.string().email('Enter a valid email').toLowerCase().openapi({
      description: 'Login email. Normalised to lowercase; must not already be in use.',
      example: 'aarav.sharma@example.com',
    }),
    phone: z
      .string()
      .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number')
      .openapi({
        description:
          'Indian mobile number: 10 digits starting 6-9, no country code. Stored as +91XXXXXXXXXX.',
        example: '9876543210',
      }),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128)
      .openapi({ description: '8-128 characters.', example: 'Password123!', format: 'password' }),
  })
  .openapi('RegisterRequest');
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    email: z
      .string()
      .email('Enter a valid email')
      .toLowerCase()
      .openapi({ example: 'customer@shop.test' }),
    password: z
      .string()
      .min(1, 'Password is required')
      .openapi({ example: 'Password123!', format: 'password' }),
  })
  .openapi('LoginRequest');
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z
  .object({
    refreshToken: z.string().min(1, 'refreshToken is required').openapi({
      description: 'The opaque refresh token last issued by register, login, or refresh.',
      example: '3f6d1c9a5b8e4d2f7a0c1e9b4d6f8a2c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f',
    }),
  })
  .openapi('RefreshRequest');
export type RefreshInput = z.infer<typeof refreshSchema>;
