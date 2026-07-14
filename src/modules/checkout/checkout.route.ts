import { Router } from 'express';

import { authenticate } from '@/middleware/auth';
import { validate } from '@/middleware/validate';
import * as controller from './checkout.controller';
import { checkoutSchema, orderListQuerySchema, orderParamsSchema } from './checkout.schema';

/** POST /checkout — place the active cart as an order. Auth required. */
export const checkoutRouter = Router();
checkoutRouter.use(authenticate);
checkoutRouter.post('/', validate(checkoutSchema), controller.checkout);

/** /orders — the signed-in user's orders. Auth required. */
export const ordersRouter = Router();
ordersRouter.use(authenticate);
ordersRouter.get('/', validate(orderListQuerySchema, 'query'), controller.listOrders);
ordersRouter.get('/:id', validate(orderParamsSchema, 'params'), controller.getOrder);
ordersRouter.post('/:id/cancel', validate(orderParamsSchema, 'params'), controller.cancelOrder);
// DEV-only: stand in for the PhonePe capture webhook until phase 4c.
ordersRouter.post('/:id/confirm-dev', validate(orderParamsSchema, 'params'), controller.confirmOrderDev);
