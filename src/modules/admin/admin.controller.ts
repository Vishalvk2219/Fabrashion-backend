import type { RequestHandler } from 'express';

import { adminService } from './admin.service';
import type {
  AdminCatalogQuery,
  AdminOrdersQuery,
  AdminStaffQuery,
  CreateProductInput,
  CreateStaffInput,
} from './admin.schema';

export const overview: RequestHandler = async (_req, res) => {
  res.status(200).json(await adminService.overview());
};

export const listStaff: RequestHandler = async (req, res) => {
  const { page, limit } = req.query as unknown as AdminStaffQuery;
  res.status(200).json(await adminService.listStaff(page, limit));
};

export const createStaff: RequestHandler = async (req, res) => {
  res.status(201).json(await adminService.createStaff(req.body as CreateStaffInput));
};

export const listCatalog: RequestHandler = async (req, res) => {
  const { q, page, limit } = req.query as unknown as AdminCatalogQuery;
  res.status(200).json(await adminService.listCatalog(q, page, limit));
};

export const createProduct: RequestHandler = async (req, res) => {
  res.status(201).json(await adminService.createProduct(req.body as CreateProductInput));
};

export const listOrders: RequestHandler = async (req, res) => {
  res.status(200).json(await adminService.listOrders(req.query as unknown as AdminOrdersQuery));
};
