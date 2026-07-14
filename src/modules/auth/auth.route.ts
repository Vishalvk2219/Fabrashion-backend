import { Router } from 'express';

import { authenticate } from '@/middleware/auth';
import { authLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import * as controller from './auth.controller';
import { otpRequestSchema, otpVerifySchema, refreshSchema } from './auth.schema';

export const authRouter = Router();

// Phone-OTP login (the only login method). Email is profile data, never a credential.
authRouter.post('/otp/request', authLimiter, validate(otpRequestSchema), controller.requestOtp);
authRouter.post('/otp/verify', authLimiter, validate(otpVerifySchema), controller.verifyOtp);
authRouter.post('/refresh', authLimiter, validate(refreshSchema), controller.refresh);
authRouter.post('/logout', validate(refreshSchema), controller.logout);
authRouter.get('/me', authenticate, controller.me);
