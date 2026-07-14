import type { RequestHandler } from 'express';

import { catalogService } from './catalog.service';
import type { ProductListQuery, ProductParams } from './catalog.schema';

// Query/params are Zod-validated + coerced by `validate(...)` before these run.

export const getCategories: RequestHandler = async (_req, res) => {
  res.status(200).json(await catalogService.getCategories());
};

export const listProducts: RequestHandler = async (req, res) => {
  const query = req.query as unknown as ProductListQuery;
  res.status(200).json(await catalogService.listProducts(query));
};

export const getProduct: RequestHandler = async (req, res) => {
  const { id } = req.params as unknown as ProductParams;
  res.status(200).json(await catalogService.getProduct(id));
};

export const getAvailability: RequestHandler = async (req, res) => {
  const { id } = req.params as unknown as ProductParams;
  res.status(200).json(await catalogService.getAvailability(id));
};
