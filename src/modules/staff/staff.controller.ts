import type { RequestHandler } from 'express';

import { UnauthorizedError } from '@/lib/errors';
import { staffService } from './staff.service';
import type {
  AdjustInventoryInput,
  OrderParams,
  StaffInventoryQuery,
  StaffOrdersQuery,
  VariantParams,
} from './staff.schema';

const userId = (req: Parameters<RequestHandler>[0]): string => {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
};

export const summary: RequestHandler = async (req, res) => {
  res.status(200).json(await staffService.summary(userId(req)));
};

export const listInventory: RequestHandler = async (req, res) => {
  const { q, page, limit } = req.query as unknown as StaffInventoryQuery;
  res.status(200).json(await staffService.listInventory(userId(req), q, page, limit));
};

export const adjustInventory: RequestHandler = async (req, res) => {
  const { variantId } = req.params as unknown as VariantParams;
  const input = req.body as AdjustInventoryInput;
  res.status(200).json(await staffService.adjustInventory(userId(req), variantId, input));
};

export const listOrders: RequestHandler = async (req, res) => {
  const query = req.query as unknown as StaffOrdersQuery;
  res.status(200).json(await staffService.listOrders(userId(req), query));
};

export const advanceOrder: RequestHandler = async (req, res) => {
  const { id } = req.params as unknown as OrderParams;
  res.status(200).json(await staffService.advanceOrder(userId(req), id));
};

export const listTrials: RequestHandler = async (req, res) => {
  const { page, limit } = req.query as unknown as StaffInventoryQuery;
  res.status(200).json(await staffService.listTrials(userId(req), page, limit));
};

export const advanceTrial: RequestHandler = async (req, res) => {
  const { id } = req.params as unknown as OrderParams;
  res.status(200).json(await staffService.advanceTrial(userId(req), id));
};
