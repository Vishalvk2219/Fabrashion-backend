import { Router } from 'express';

import { authenticate } from '@/middleware/auth';
import { validate } from '@/middleware/validate';
import * as controller from './address.controller';
import { addressParamsSchema, createAddressSchema, updateAddressSchema } from './address.schema';

/** Saved shipping addresses for the signed-in user. Auth required. */
export const addressRouter = Router();
addressRouter.use(authenticate);

addressRouter.get('/', controller.list);
addressRouter.post('/', validate(createAddressSchema), controller.create);
addressRouter.patch(
  '/:id',
  validate(addressParamsSchema, 'params'),
  validate(updateAddressSchema),
  controller.update,
);
addressRouter.delete('/:id', validate(addressParamsSchema, 'params'), controller.remove);
