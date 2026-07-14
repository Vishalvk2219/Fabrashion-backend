import { Router } from 'express';

import { authenticate } from '@/middleware/auth';
import { validate } from '@/middleware/validate';
import * as controller from './cart.controller';
import { addItemSchema, itemParamsSchema, updateItemSchema } from './cart.schema';

/** All cart routes require auth; the cart always belongs to the token's user. */
export const cartRouter = Router();
cartRouter.use(authenticate);

cartRouter.get('/', controller.getCart);
cartRouter.post('/items', validate(addItemSchema), controller.addItem);
cartRouter.patch(
  '/items/:itemId',
  validate(itemParamsSchema, 'params'),
  validate(updateItemSchema),
  controller.updateItem,
);
cartRouter.delete('/items/:itemId', validate(itemParamsSchema, 'params'), controller.removeItem);
