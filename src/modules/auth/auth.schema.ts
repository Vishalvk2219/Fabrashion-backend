import { z } from '@/lib/zod';

/** A 10-digit Indian mobile number (without the +91 prefix). */
const phone = z
  .string()
  .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number')
  .openapi({
    description:
      'Indian mobile number: 10 digits starting 6-9, no country code. Stored as +91XXXXXXXXXX.',
    example: '9876543210',
  });

/** Step 1 — request an OTP for a phone number. */
export const otpRequestSchema = z.object({ phone }).openapi('OtpRequest');
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;

/** Step 2 — verify the 4-digit OTP and sign in (creating a CUSTOMER account on first login). */
export const otpVerifySchema = z
  .object({
    phone,
    code: z
      .string()
      .regex(/^\d{4}$/, 'Enter the 4-digit code')
      .openapi({ description: 'The 4-digit code sent by SMS.', example: '1234' }),
  })
  .openapi('OtpVerifyRequest');
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

export const refreshSchema = z
  .object({
    refreshToken: z.string().min(1, 'refreshToken is required').openapi({
      description: 'The opaque refresh token last issued by OTP verify or refresh.',
      example: '3f6d1c9a5b8e4d2f7a0c1e9b4d6f8a2c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f',
    }),
  })
  .openapi('RefreshRequest');
export type RefreshInput = z.infer<typeof refreshSchema>;
