import type { RequestHandler } from 'express';

import { UnauthorizedError } from '@/lib/errors';
import { cartService } from './cart.service';
import type { AddItemInput, ItemParams, UpdateItemInput } from './cart.schema';

const userId = (req: Parameters<RequestHandler>[0]): string => {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
};

export const getCart: RequestHandler = async (req, res) => {
  res.status(200).json(await cartService.getCart(userId(req)));
};

export const addItem: RequestHandler = async (req, res) => {
  res.status(200).json(await cartService.addItem(userId(req), req.body as AddItemInput));
};

export const updateItem: RequestHandler = async (req, res) => {
  const { itemId } = req.params as unknown as ItemParams;
  const { quantity } = req.body as UpdateItemInput;
  res.status(200).json(await cartService.setItemQty(userId(req), itemId, quantity));
};

export const removeItem: RequestHandler = async (req, res) => {
  const { itemId } = req.params as unknown as ItemParams;
  res.status(200).json(await cartService.removeItem(userId(req), itemId));
};
