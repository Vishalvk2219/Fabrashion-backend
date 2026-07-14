import { Router } from 'express';

import { authenticate } from '@/middleware/auth';
import { authLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import * as controller from './auth.controller';
import { loginSchema, refreshSchema, registerSchema } from './auth.schema';

export const authRouter = Router();

authRouter.post('/register', authLimiter, validate(registerSchema), controller.register);
authRouter.post('/login', authLimiter, validate(loginSchema), controller.login);
authRouter.post('/refresh', authLimiter, validate(refreshSchema), controller.refresh);
authRouter.post('/logout', validate(refreshSchema), controller.logout);
authRouter.get('/me', authenticate, controller.me);
