import { Router } from 'express';

import { authenticate } from '@/middleware/auth';
import { requireRole } from '@/middleware/requireRole';
import { validate } from '@/middleware/validate';
import * as controller from './admin.controller';
import {
  adminCatalogQuerySchema,
  adminOrdersQuerySchema,
  adminStaffQuerySchema,
  createProductSchema,
  createStaffSchema,
} from './admin.schema';

/** /admin — back-office management APIs. ADMIN only. */
export const adminRouter = Router();
adminRouter.use(authenticate, requireRole('ADMIN'));

adminRouter.get('/overview', controller.overview);
adminRouter.get('/staff', validate(adminStaffQuerySchema, 'query'), controller.listStaff);
adminRouter.post('/staff', validate(createStaffSchema), controller.createStaff);
adminRouter.get('/catalog', validate(adminCatalogQuerySchema, 'query'), controller.listCatalog);
adminRouter.post('/products', validate(createProductSchema), controller.createProduct);
adminRouter.get('/orders', validate(adminOrdersQuerySchema, 'query'), controller.listOrders);
