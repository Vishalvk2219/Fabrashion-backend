import { Router } from 'express';

import { addressRouter } from '@/modules/address/address.route';
import { adminRouter } from '@/modules/admin/admin.route';
import { authRouter } from '@/modules/auth/auth.route';
import { cartRouter } from '@/modules/cart/cart.route';
import { categoriesRouter, productsRouter } from '@/modules/catalog/catalog.route';
import { checkoutRouter, ordersRouter } from '@/modules/checkout/checkout.route';
import { staffRouter } from '@/modules/staff/staff.route';
import { trialsRouter } from '@/modules/trial/trial.route';

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
apiRouter.use('/categories', categoriesRouter);
apiRouter.use('/products', productsRouter);
apiRouter.use('/addresses', addressRouter);
apiRouter.use('/cart', cartRouter);
apiRouter.use('/checkout', checkoutRouter);
apiRouter.use('/orders', ordersRouter);
apiRouter.use('/trials', trialsRouter);
apiRouter.use('/staff', staffRouter);
apiRouter.use('/admin', adminRouter);
