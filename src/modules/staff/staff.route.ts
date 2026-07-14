import { Router } from 'express';

import { authenticate } from '@/middleware/auth';
import { requireRole } from '@/middleware/requireRole';
import { validate } from '@/middleware/validate';
import * as controller from './staff.controller';
import {
  adjustInventorySchema,
  orderParamsSchema,
  staffInventoryQuerySchema,
  staffOrdersQuerySchema,
  staffTrialsQuerySchema,
  variantParamsSchema,
} from './staff.schema';

/** /staff — store-ops APIs for the back-office shell. STAFF or ADMIN only. */
export const staffRouter = Router();
staffRouter.use(authenticate, requireRole('STAFF', 'ADMIN'));

staffRouter.get('/summary', controller.summary);
staffRouter.get('/inventory', validate(staffInventoryQuerySchema, 'query'), controller.listInventory);
staffRouter.patch(
  '/inventory/:variantId',
  validate(variantParamsSchema, 'params'),
  validate(adjustInventorySchema),
  controller.adjustInventory,
);
staffRouter.get('/orders', validate(staffOrdersQuerySchema, 'query'), controller.listOrders);
staffRouter.post('/orders/:id/advance', validate(orderParamsSchema, 'params'), controller.advanceOrder);
staffRouter.get('/trials', validate(staffTrialsQuerySchema, 'query'), controller.listTrials);
staffRouter.post('/trials/:id/advance', validate(orderParamsSchema, 'params'), controller.advanceTrial);
