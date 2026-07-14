import { Router } from 'express';

import { readLimiter } from '@/middleware/rateLimit';
import { validate } from '@/middleware/validate';
import * as controller from './catalog.controller';
import { productListQuerySchema, productParamsSchema } from './catalog.schema';

/** GET /categories */
export const categoriesRouter = Router();
categoriesRouter.get('/', readLimiter, controller.getCategories);

/** GET /products, /products/:id, /products/:id/availability — all public reads. */
export const productsRouter = Router();
productsRouter.get('/', readLimiter, validate(productListQuerySchema, 'query'), controller.listProducts);
productsRouter.get('/:id', readLimiter, validate(productParamsSchema, 'params'), controller.getProduct);
productsRouter.get(
  '/:id/availability',
  readLimiter,
  validate(productParamsSchema, 'params'),
  controller.getAvailability,
);
