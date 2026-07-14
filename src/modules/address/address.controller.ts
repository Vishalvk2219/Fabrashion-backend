import type { RequestHandler } from 'express';

import { UnauthorizedError } from '@/lib/errors';
import { addressService } from './address.service';
import type { AddressParams, CreateAddressInput, UpdateAddressInput } from './address.schema';

const userId = (req: Parameters<RequestHandler>[0]): string => {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
};

export const list: RequestHandler = async (req, res) => {
  res.status(200).json(await addressService.list(userId(req)));
};

export const create: RequestHandler = async (req, res) => {
  res.status(201).json(await addressService.create(userId(req), req.body as CreateAddressInput));
};

export const update: RequestHandler = async (req, res) => {
  const { id } = req.params as unknown as AddressParams;
  res.status(200).json(await addressService.update(userId(req), id, req.body as UpdateAddressInput));
};

export const remove: RequestHandler = async (req, res) => {
  const { id } = req.params as unknown as AddressParams;
  res.status(200).json(await addressService.remove(userId(req), id));
};
