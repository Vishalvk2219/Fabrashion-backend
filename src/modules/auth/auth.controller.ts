import type { RequestHandler } from 'express';

import { UnauthorizedError } from '@/lib/errors';
import { authService } from './auth.service';
import type { OtpRequestInput, OtpVerifyInput, RefreshInput } from './auth.schema';

// Bodies are already Zod-validated by `validate(...)` middleware.
// Express 5 forwards rejected promises to the central errorHandler.

export const requestOtp: RequestHandler = async (req, res) => {
  const { phone } = req.body as OtpRequestInput;
  const result = await authService.requestOtp(phone);
  res.status(200).json(result);
};

export const verifyOtp: RequestHandler = async (req, res) => {
  const { phone, code } = req.body as OtpVerifyInput;
  const result = await authService.verifyOtp(phone, code);
  res.status(200).json(result);
};

export const refresh: RequestHandler = async (req, res) => {
  const { refreshToken } = req.body as RefreshInput;
  const result = await authService.refresh(refreshToken);
  res.status(200).json(result);
};

export const logout: RequestHandler = async (req, res) => {
  const { refreshToken } = req.body as RefreshInput;
  await authService.logout(refreshToken);
  res.status(204).send();
};

export const me: RequestHandler = async (req, res) => {
  if (!req.user) throw new UnauthorizedError();
  const user = await authService.me(req.user.id);
  res.status(200).json(user);
};
