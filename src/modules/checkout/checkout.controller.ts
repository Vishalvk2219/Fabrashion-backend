import type { RequestHandler } from 'express';

import { env } from '@/config/env';
import { NotFoundError, UnauthorizedError } from '@/lib/errors';
import { checkoutService } from './checkout.service';
import type { CheckoutInput, OrderListQuery, OrderParams } from './checkout.schema';

const userId = (req: Parameters<RequestHandler>[0]): string => {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
};

export const checkout: RequestHandler = async (req, res) => {
  const { addressId } = req.body as CheckoutInput;
  res.status(201).json(await checkoutService.checkout(userId(req), addressId));
};

export const listOrders: RequestHandler = async (req, res) => {
  const { page, limit } = req.query as unknown as OrderListQuery;
  res.status(200).json(await checkoutService.listOrders(userId(req), page, limit));
};

export const getOrder: RequestHandler = async (req, res) => {
  const { id } = req.params as unknown as OrderParams;
  res.status(200).json(await checkoutService.getOrder(userId(req), id));
};

export const cancelOrder: RequestHandler = async (req, res) => {
  const { id } = req.params as unknown as OrderParams;
  res.status(200).json(await checkoutService.cancelOrder(userId(req), id));
};

/**
 * DEV-only stand-in for the PhonePe capture webhook: marks the caller's own PENDING order PAID via
 * the same idempotent `markOrderPaid`. Disabled in production (returns 404).
 */
export const confirmOrderDev: RequestHandler = async (req, res) => {
  if (env.isProd) throw new NotFoundError();
  const { id } = req.params as unknown as OrderParams;
  await checkoutService.getOrder(userId(req), id); // ownership check (404/403)
  res.status(200).json(await checkoutService.markOrderPaid(id));
};
