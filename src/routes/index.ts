import { Router } from 'express';

import { authRouter } from '@/modules/auth/auth.route';

/**
 * Versioned API router (mounted at /api/v1). Feature module routers
 * (auth, catalog, cart, ...) are mounted here as they land.
 */
export const apiRouter = Router();

apiRouter.get('/', (_req, res) => {
  res.json({
    name: 'fabrashion-backend',
    version: 'v1',
    status: 'ok',
  });
});

apiRouter.use('/auth', authRouter);
